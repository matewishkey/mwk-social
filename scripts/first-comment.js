#!/usr/bin/env node
/*
 * Post the standard first comment on anything published that hasn't got one yet.
 *
 * Two paths put the comment out, both composing it from config/voice.json:
 *   - posts published through the pipeline carry it natively (scripts/post.js
 *     sends platformSpecificData.firstComment, Zernio posts it within seconds);
 *   - YouTube LIVE STREAMS, which are started straight on the platform and so
 *     never reach posts:list, are caught here once Zernio's external sync
 *     notices them (~90 min). See sources() for why that is YouTube alone.
 * The duplicate guard is what lets the two coexist: a post that already carries
 * the CTA link is left alone whichever path put it there. A post made by hand
 * anywhere ELSE is still a one-off, handled by hand.
 *
 * Instagram, Facebook, LinkedIn and YouTube. TikTok has no comments API.
 *
 * Usage:
 *   scripts/first-comment.js                # last 48h, posts for real
 *   scripts/first-comment.js --dry-run      # show what it would comment on
 *   scripts/first-comment.js --seed         # mark everything in window as done, comment on nothing
 *   scripts/first-comment.js --hours 12
 *   scripts/first-comment.js --all          # every post the API still lists
 *   scripts/first-comment.js --platforms linkedin,youtube
 *   scripts/first-comment.js --message "..." | MWK_FIRST_COMMENT=...
 *
 * State (which posts are done) lives outside the repo:
 *   ~/.local/state/mwk-social/first-comments.json   (MWK_COMMENT_STATE overrides)
 */
'use strict';

const health = require('./lib/health');

const { topicsFor } = require('./lib/topic-tags');
const { getComments, replyToPost, cli: zernio } = require('./lib/api');
const voice = require('./lib/voice');
const events = require('./lib/events');
const platformTable = require('./lib/platforms');
const { youtubeProbe } = require('./lib/media');

// Anything already carrying this string counts as "first comment done" —
// including the one Zernio itself posted at publish time. It and the wording,
// tags and caps all come from config/voice.json.
// Any known marker counts as "already ours" — see config/voice.json markers[].
// Matching only the newest one would re-comment on every post written before it.
const carriesCta = voice.carriesCta;
const shortlink = require('./lib/shortlink');

// YouTube takes a while to auto-caption a fresh upload — hours for a long live
// stream — and a comment cannot be edited once posted. So a recent video with no
// transcript yet is left alone and retried next run; past this age it gets the
// plain CTA. Waiting costs nothing for content that captions quickly: the grace
// is only an upper bound, and the next hourly run picks it up the moment it can.
const CAPTION_GRACE_HOURS = Number(process.env.MWK_CAPTION_GRACE_HOURS || 24);

/*
 * A 403 ON THE COMMENT READ IS NOT ALWAYS PERMANENT, AND TREATING IT AS SUCH
 * COST TWO LIVE STREAMS THEIR CTA (found 2026-09-13). YouTube closes the
 * comments endpoint WHILE A STREAM IS LIVE — live chat is the surface then —
 * so the 10:00 run on a stream that ended at 10:18 saw a 403, wrote it down as
 * closed for ever, and eleven hours later the comments were open with nothing
 * under either video. Same shape as the nine streams sources() exists to fix.
 *
 * So a 403 is recorded with a retryUntil rather than for good, and the hourly
 * run tries again until the post is this old. Past it the entry stays without
 * one and is permanent: a private video or comments switched off never opens.
 * Keep it UNDER the collection window (--hours, 48 by default) or the retry
 * comes due after the post has already fallen out of the sweep.
 */
const COMMENTS_403_RETRY_HOURS = Number(process.env.MWK_COMMENTS_403_RETRY_HOURS || 24);

/*
 * Say so in the log when the comment had to give something up to fit. Silence
 * would make "the quote went out" and "the quote was dropped for length"
 * indistinguishable, and the second one is worth knowing about a platform.
 */
const shortened = (composed) => {
  const gave = [composed.fellBack && 'the quote', composed.droppedTags && 'the tags'].filter(Boolean);
  return gave.length ? ` — gave up ${gave.join(' and ')} to fit` : '';
};

/*
 * A FAILURE ON ONE RUN AND A FAILURE THAT IS STUCK LOOK IDENTICAL FROM HERE,
 * AND ONLY ONE OF THEM WANTS A HUMAN (#36, filed 2026-08-26 and earned twice
 * since). A Zernio 500 on a comment READ on 2026-08-26 turned the unit red for
 * an hour over a comment that was already on the post; the over-length Threads
 * body on 2026-09-18 was genuinely stuck and looked exactly the same in
 * `systemctl --user list-timers`. So a post carries its own consecutive-run
 * count and the unit goes red only once one of them reaches STUCK_RUNS — by
 * which time "the next run fixes it" has been disproved three times.
 *
 * A SOURCE failure is deliberately not softened this way: a sweep that could
 * not read one of its sources missed posts it never saw, so it stays loud on
 * the first run (the 2026-09-15 rule, and the nine-streams bug underneath it).
 */
const STUCK_RUNS = Number(process.env.MWK_COMMENT_STUCK_RUNS || 3);

/**
 * Is this state entry still owed another look?
 *
 * ⚠ ANY ENTRY CARRYING retryUntil, EXPIRED OR NOT. It read "only while the
 * window is in the future", and that dropped E010 without a word (2026-09-19):
 * the 403 from while the stream was live was filed with a 24h window; on every
 * later run the read SUCCEEDED, so the loop walked past the 403 branch to the
 * transcript wait and `continue`d without touching state; the moment the window
 * lapsed this filter read the stale note as a post closed for good. Zero
 * comments on the video, no GONE line, nothing in the journal — the exact
 * shape of the nine-streams bug, one layer down.
 *
 * An expired window is re-examined and the LOOP decides: still 403 → the
 * permanent note (written without retryUntil) and it drops out here next run;
 * open → the stale note is cleared where the door is found open.
 */
const isRetryable = (entry) => Boolean(entry && Object.hasOwn(entry, 'retryUntil'));

// TikTok is absent because its API exposes no comments at all. X is absent for
// a different reason and the distinction has been got wrong twice: it HAS a
// comments API since 2026-08-22, but its CTA ships with the post as a thread
// reply, so a watcher comment would be the same link twice under one tweet.
// platforms.commentWatched() is the single definition and a test pins this list
// against it — do not edit one without the other.
const ALL_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'youtube', 'threads'];

function parseArgs(argv) {
  const opts = { hours: 48, all: false, dryRun: false, seed: false, noTopics: false, message: null, limit: 50, platforms: ALL_PLATFORMS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--seed') opts.seed = true;
    else if (a === '--no-topics') opts.noTopics = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--hours') opts.hours = Number(argv[++i]);
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--message') opts.message = argv[++i];   // bypasses rotation entirely
    else if (a === '--platforms') opts.platforms = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else { console.error(`unknown option: ${a}`); usage(); process.exit(2); }
  }
  if (!Number.isFinite(opts.hours) || opts.hours <= 0) { console.error('--hours must be a positive number'); process.exit(2); }
  const bad = opts.platforms.filter((p) => !ALL_PLATFORMS.includes(p));
  if (bad.length) { console.error(`unsupported platform(s): ${bad.join(', ')} (have: ${ALL_PLATFORMS.join(', ')})`); process.exit(2); }
  return opts;
}

function usage() {
  console.log('usage: first-comment.js [--dry-run] [--seed] [--all] [--hours N] [--limit N]');
  console.log('                        [--no-topics]  (skip transcription, plain CTA only)');
  console.log('                        [--platforms p1,p2] [--message TEXT]');
}

// Shared with run-queue.js, which writes a suppression entry here when a post
// is queued with the first comment switched off. Without that the flag held for
// about an hour and then this watcher filled the "gap" back in.
const commentState = require('./lib/comment-state');
const loadState = commentState.load;
const saveState = commentState.save;

// Stories can't be commented on and expire anyway.
const isStory = (post, pf) =>
  /\/stories\//.test(pf.platformPostUrl || post.platformPostUrl || '') ||
  (post.platformSpecificData && post.platformSpecificData.contentType === 'story');

/*
 * Two sources, and the second one is not a leftover.
 *
 * posts:list is the pipeline's own output — it carries a post the moment it
 * publishes, where analytics:posts lags minutes behind. When the Restream
 * mirror was retired the per-platform analytics sweep went with it, on the
 * premise that everything goes out through this pipeline now.
 *
 * THAT PREMISE IS FALSE FOR LIVE STREAMS, AND IT COST NINE OF THEM THEIR CTA
 * (found 2026-08-31). He goes live straight on YouTube — nineteen streams by
 * 31 August — so a live event never reaches posts:list and this watcher could
 * not see one at all. Four of the nine had a good description with the link in
 * it and nothing underneath. A live stream is a recurring shape here, not the
 * "one-off handled by hand" the removal assumed.
 *
 * YOUTUBE ONLY, deliberately. It is where the live events are, and it is the
 * one platform where a link under a long-form video is actually clickable.
 * Sweeping every platform is what the mirror removal was right to delete.
 */
/*
 * THE SECOND SOURCE IS THE OPTIONAL ONE AND IT MUST NOT TAKE THE RUN WITH IT.
 * A transient 503 from the analytics backend exited the whole sweep at
 * 2026-09-15 02:00 UTC, so every Instagram, Facebook, LinkedIn and Threads post
 * in that hour went uncommented over a dependency none of them use. posts:list
 * stays fatal — with no pipeline output there is nothing to do, and a clean exit
 * would be a lie — while this one degrades to "no external YouTube sources this
 * run".
 *
 * IT IS COUNTED AS A FAILURE, which is the whole of what makes the degrade safe.
 * A silent skip here is precisely the shape that cost nine live streams their
 * CTA: the run would report success while the one source that can see a stream
 * never ran, and --hours eventually carries that stream out of the window for
 * good. Failing loudly costs one retry an hour; failing quietly costs a stream.
 */
function sources(opts) {
  const out = [zernio(['posts:list', '--status', 'published', '--limit', String(opts.limit)])];
  let failures = 0;
  if (opts.platforms.includes('youtube')) {
    try {
      out.push(zernio(['analytics:posts', '--platform', 'youtube', '--limit', String(opts.limit)]));
    } catch (err) {
      failures++;
      console.error(`FAIL  external youtube sweep — ${String(err.message).split('\n')[0]}`);
      console.error('      a live stream published this hour is invisible to this run; '
        + 'the pipeline\'s own posts are unaffected and the sweep retries next run');
    }
  }
  return { results: out, failures };
}

function collectPosts(opts) {
  const seen = new Set();
  const found = [];
  const cutoff = opts.all ? 0 : Date.now() - opts.hours * 3600 * 1000;

  const { results, failures: sourceFailures } = sources(opts);
  for (const res of results) {
    for (const post of res.posts || []) {
      for (const pf of post.platforms || []) {
        if (!opts.platforms.includes(pf.platform)) continue;
        if (pf.status !== 'published') continue;
        if (isStory(post, pf)) continue;
        const publishedAt = Date.parse(pf.publishedAt || post.publishedAt || post.scheduledFor || '');
        if (!Number.isFinite(publishedAt) || publishedAt < cutoff) continue;
        const accountId = typeof pf.accountId === 'object' && pf.accountId ? pf.accountId._id : pf.accountId;
        // Addressable only by the native platform ID — the Zernio _id 404s on
        // every inbox: command.
        if (!pf.platformPostId || !accountId) continue;
        const key = `${pf.platform}:${pf.platformPostId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const video = (post.mediaItems || []).find((m) => m && m.type === 'video');
        found.push({
          key,
          platform: pf.platform,
          postId: pf.platformPostId,
          accountId,
          url: pf.platformPostUrl || post.platformPostUrl || '',
          content: post.content || '',
          videoUrl: (video && video.url) || null,
          isVideo: Boolean(video) || pf.platform === 'youtube',
          publishedAt: new Date(publishedAt).toISOString(),
        });
      }
    }
  }
  return { posts: found.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)), sourceFailures };
}

// Second guard, so a lost state file can't double-comment — and so a post that
// already got the comment natively at publish time is left alone.
async function alreadyCommented(target) {
  const res = await getComments(target.postId, target.accountId);
  return (res.comments || []).some((c) => carriesCta(c.text || c.message || c.content));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const state = loadState();
  const stamp = new Date().toISOString();

  events.initRun({ source: 'first-comment' });
  const { posts, sourceFailures } = collectPosts(opts);
  const pending = posts.filter((p) => !state[p.key] || isRetryable(state[p.key]));
  console.log(`[${stamp}] ${posts.length} post(s) in window across ${opts.platforms.join(', ')}, ${pending.length} without a recorded first comment`);

  if (opts.seed) {
    for (const target of pending) {
      state[target.key] = { commentedAt: null, note: 'seeded, not commented', url: target.url };
      console.log(`seed  ${target.key} — marked done without commenting (${target.url})`);
    }
    saveState(state);
    return;
  }

  // A source that could not be read starts the count, so a run that swept only
  // half of what it should still exits non-zero and still marks the heartbeat.
  let failures = sourceFailures;
  let softFailures = 0;
  const failing = () => (state.__failing = state.__failing || {});
  for (const target of pending) {
    let failed = false;
    try {
      // The link is already in the caption — a comment repeating it is noise.
      if (carriesCta(target.content)) {
        state[target.key] = { commentedAt: null, note: 'link already in the caption', url: target.url };
        saveState(state);
        events.emit('comment.skipped', { message: 'link already in the caption', platform: target.platform,
          postKey: target.key, url: target.url, accountId: target.accountId,
          dedupeKey: `comment.skipped|${target.key}`, data: { reason: 'link-in-caption' } });
        console.log(`skip  ${target.key} — link already in the post itself (${target.url})`);
        continue;
      }

      // A 403 on the read means the platform has comments closed on this post
      // (YouTube does that for private videos) — permanent, so stop retrying it.
      let closed = false;
      let done;
      try {
        done = await alreadyCommented(target);
      } catch (err) {
        if (!/\b403\b/.test(err.message)) throw err;
        closed = true;
      }
      if (closed) {
        const retryUntil = new Date(Date.parse(target.publishedAt) + COMMENTS_403_RETRY_HOURS * 3600 * 1000);
        const again = retryUntil.getTime() > Date.now();
        state[target.key] = { commentedAt: null, note: 'comments unavailable (403)', url: target.url,
          ...(again ? { retryUntil: retryUntil.toISOString() } : {}) };
        saveState(state);
        events.emit('comment.skipped', { message: again ? 'comments closed for now, will try again' : 'comments closed on this post',
          level: 'warn',
          platform: target.platform, postKey: target.key, url: target.url, accountId: target.accountId,
          dedupeKey: `comment.skipped|${target.key}`, data: { reason: 'comments-closed-403', retryUntil: again ? retryUntil.toISOString() : null } });
        console.log(`skip  ${target.key} — comments closed${again ? `, retrying until ${retryUntil.toISOString()}` : ' on this post'} (${target.url})`);
        continue;
      }
      // THE DOOR IS OPEN. If a 403 from an earlier run is still on file (a
      // stream that was live at the time), clear it HERE — before any later
      // `continue` on this post can leave it in place. Left there, its window
      // lapses and isRetryable() reads it as closed for good; that is how E010
      // sat uncommented through nine hourly runs with the comments wide open.
      if (state[target.key] && Object.hasOwn(state[target.key], 'retryUntil')) {
        delete state[target.key];
        saveState(state);
        console.log(`open  ${target.key} — comments have reopened, the earlier 403 is cleared`);
      }
      if (done) {
        state[target.key] = { commentedAt: null, note: 'comment already on the post', url: target.url };
        saveState(state);
        events.emit('comment.skipped', { message: 'first comment already there', platform: target.platform,
          postKey: target.key, url: target.url, accountId: target.accountId,
          dedupeKey: `comment.skipped|${target.key}`, data: { reason: 'already-commented' } });
        console.log(`skip  ${target.key} — first comment already there (${target.url})`);
        continue;
      }
      // Work out what the video was about, and tag it with that. A failure here
      // must never cost the post its comment — fall back to the plain CTA.
      let topicTags = [];
      let summary = '';
      let gotTopics = false;
      if (!opts.noTopics) {
        try {
          const topics = await topicsFor(target.key, {
            videoUrl: target.videoUrl,
            youtubeId: target.platform === 'youtube' ? target.postId : null,
          });
          if (topics) {
            topicTags = topics.tags;
            summary = topics.summary;
            gotTopics = true;
          }
        } catch (err) {
          console.error(`warn  ${target.key} — topic tags unavailable (${err.message}); posting the plain CTA`);
        }
      }

      // Nothing to transcribe yet on a fresh video — come back next run rather
      // than spend the one comment we get on an untagged one.
      const ageHours = (Date.now() - Date.parse(target.publishedAt)) / 3600000;
      if (!opts.noTopics && target.isVideo && !gotTopics && ageHours < CAPTION_GRACE_HOURS) {
        events.emit('comment.deferred', { message: 'no transcript yet', platform: target.platform,
          postKey: target.key, url: target.url, data: { ageHours: Number(ageHours.toFixed(1)) } });
        console.log(`wait  ${target.key} — no transcript yet, ${ageHours.toFixed(1)}h old, retrying next run (${target.url})`);
        continue;
      }
      // Rotated per post so no two consecutive comments read the same, and
      // sometimes quoting a real guest wish from the show's feed.
      const override = opts.message || process.env.MWK_FIRST_COMMENT;

      /*
       * Can a url in THIS comment actually be followed?
       *
       * This watcher was the fourth place a link gets minted and the only one
       * that never learned the rule. Instagram is on its list precisely to
       * catch a native first comment that silently failed — and it would then
       * write a tracked mwkshow.com code into an Instagram comment, where no
       * url is clickable at all. That is the exact mistake fixed in post.js on
       * 2026-08-22 and left standing here.
       *
       * YouTube is the media-dependent one: a vertical video under three
       * minutes is a Short, and a url in a Short's comment is plain text. No
       * probe means no claim, same as linkDeadFor.
       */
      const live = platformTable.linkIsLive(target.platform)
        && !(target.platform === 'youtube'
          && platformTable.linkDeadFor('youtube', youtubeProbe(target.postId)));

      // One code per (platform, post), so a click says which channel and which
      // clip earned it. Idempotent, and null if the dashboard is unreachable —
      // in which case the plain URL goes out and the comment still happens.
      //
      // campaign and medium are part of the MINT KEY, not decoration: without
      // them this path's codes landed with all three attribution columns null
      // and the click could name a post but never a placement.
      //
      // ⚠ "There is no clip id to give" stood here and was WRONG for sixteen
      // codes. This watcher does only see a published post — but run-queue.js
      // writes that post's own id into queue_item.result, and post_key carries
      // the same id, so the Worker resolves the clip itself (resolveClipId in
      // web/src/api.js). Nothing is passed from here on purpose: the lookup
      // belongs next to the dedupe key it feeds.
      const showUrl = (override || !live) ? null : await shortlink.mint({
        platform: target.platform, postKey: target.key, label: target.url || null,
        campaign: 'clip', medium: 'comment',
      });
      // The platform's own cap on a comment, which is NOT its caption cap.
      // Composing past it is what a Threads 502 looks like from here.
      const commentMax = platformTable.get(target.platform).commentMax || null;
      const composed = override
        ? { text: override, variant: 'override', index: -1 }
        : voice.firstComment(target.key, {
            platform: target.platform,
            topicTags,
            showUrl,
            linkLive: live,
            maxLength: commentMax,
            // A caption that already carries the tags must not get them again
            // underneath. On Instagram both would spend the 5-cap twice, since
            // we never spend its 5 twice (defensive; not a stated Instagram rule).
            noTags: platformTable.get(target.platform).hashtagsInCaption !== 0,
            avoidIndex: state.__lastVariant?.[target.platform] ?? -1,
          });
      const body = composed.text;
      // A hand-written --message gets the same measurement and no shortening:
      // they are somebody's exact words, so the honest answer is to refuse.
      if (override && commentMax && body.length > commentMax) {
        throw new Error(`--message is ${body.length} characters and ${target.platform} takes ${commentMax}`);
      }

      if (opts.dryRun) {
        console.log(`DRY   ${target.key} — would comment [${composed.variant}/${composed.index}]` +
          `${commentMax ? ` ${body.length}/${commentMax} chars` : ''}${shortened(composed)} (${target.url})`);
        console.log(`      ${body.replace(/\n+/g, ' | ').slice(0, 150)}`);
        if (summary) console.log(`      about: ${summary}`);
        continue;
      }
      const res = await replyToPost(target.postId, target.accountId, body);
      state[target.key] = {
        commentedAt: new Date().toISOString(),
        commentId: (res.comment && res.comment.id) || res.commentId || null,
        variant: `${composed.variant}/${composed.index}`,
        tags: topicTags,
        url: target.url,
      };
      state.__lastVariant = { ...(state.__lastVariant || {}), [target.platform]: composed.index };
      saveState(state);
      events.emit('comment.posted', { message: `commented [${composed.variant}/${composed.index}]`,
        platform: target.platform, postKey: target.key, url: target.url, accountId: target.accountId,
        dedupeKey: `comment.posted|${target.key}`,
        data: { variant: composed.variant, index: composed.index, tags: topicTags } });
      console.log(`post  ${target.key} — commented [${composed.variant}/${composed.index}]${shortened(composed)} (${target.url})`);
    } catch (err) {
      failed = true;
      softFailures++;
      const before = failing()[target.key];
      const runs = (before ? before.runs : 0) + 1;
      if (!opts.dryRun) {
        failing()[target.key] = { runs, firstAt: before ? before.firstAt : stamp, lastAt: stamp, message: err.message };
        saveState(state);
      }
      const stuck = runs >= STUCK_RUNS;
      if (stuck) failures++;
      events.emit('comment.failed', { message: err.message, level: stuck ? 'error' : 'warn',
        platform: target.platform, postKey: target.key, url: target.url,
        dedupeKey: `comment.failed|${target.key}`, data: { runs, stuckAfter: STUCK_RUNS, stuck } });
      console.error(`FAIL  ${target.key} (${runs}/${STUCK_RUNS}${stuck ? ', stuck' : ', retrying next run'}) — ${err.message}`);
    } finally {
      // A `continue` above skips the rest of the body but not this, which is
      // why the count is cleared here: every path that did not throw is a post
      // that is no longer failing.
      if (!failed && !opts.dryRun && failing()[target.key]) {
        delete state.__failing[target.key];
        saveState(state);
      }
    }
  }

  /*
   * A post that failed its way OUT of the collection window can never be
   * retried by this job — --hours carried it off, the same way it carried off
   * the nine live streams. Report it once, loudly, and drop it: leaving the
   * entry behind would keep the unit red for ever with nothing able to clear
   * it. Only for platforms this run actually swept, or a narrowed
   * `--platforms` run would abandon everything it was not looking at.
   */
  const inPlay = new Set(pending.map((t) => t.key));
  for (const [k, f] of Object.entries(state.__failing || {})) {
    if (inPlay.has(k) || !opts.platforms.includes(k.split(':')[0])) continue;
    if (!opts.dryRun) { delete state.__failing[k]; saveState(state); }
    failures++;
    const window = opts.all ? 'sweep' : `${opts.hours}h window`;
    events.emit('comment.failed', { message: `gave up after ${f.runs} run(s): out of the ${window}`,
      level: 'error', platform: k.split(':')[0], postKey: k,
      dedupeKey: `comment.gaveup|${k}`, data: { runs: f.runs, lastError: f.message } });
    console.error(`GONE  ${k} — failed ${f.runs} run(s) and has left the ${window} (${f.message})`);
  }

  if (softFailures && !failures) {
    console.log(`note  ${softFailures} failure(s) this run, none of them stuck yet — the unit stays green until one reaches ${STUCK_RUNS} runs`);
  }

  events.finishRun({ inWindow: posts.length, pending: pending.length, failures, softFailures });

  // There was a private MWK_COMMENT_HC_URL here, set nowhere for a month. The
  // alerting is lib/health.js now; a comment run with failures marks the
  // heartbeat check failed so the email names it, and the next clean ship-events
  // run clears it.
  // Only a STUCK failure pages: `failures` no longer counts a post that may
  // well be fine on the next run, which is what made this hook worth having.
  if (failures && !opts.dryRun) health.ping('heartbeat', { ok: false, message: `first-comment: ${failures} stuck failure(s)` });

  process.exit(failures ? 1 : 0);
}

// Guarded, like post.js: without it a bare require() of this file PUBLISHES —
// which is exactly how the fix above got exercised on 2026-09-18.
// For the suite. main() only runs under require.main, so requiring this file
// is inert; what is exported is the one pure decision the E010 bug lived in.
module.exports = { isRetryable, ALL_PLATFORMS };

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
