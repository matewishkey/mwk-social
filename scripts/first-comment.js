#!/usr/bin/env node
/*
 * Post the standard first comment on anything published that hasn't got one yet.
 *
 * Two paths put the comment out, both composing it from config/voice.json:
 *   - posts published through the pipeline carry it natively (scripts/post.js
 *     sends platformSpecificData.firstComment, Zernio posts it within seconds);
 *   - everything else — phone-app posts, live-event videos, anything created
 *     straight on the platform — is caught here, once Zernio's external-post
 *     sync notices it (~90 min).
 * The duplicate guard is what lets the two coexist: a post that already carries
 * the CTA link is left alone whichever path put it there.
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

const { execFileSync } = require('child_process');

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
 * Only what we published. Everything goes out through this pipeline now, so
 * posts:list is the whole universe — and it carries a post the moment it
 * publishes, where analytics:posts lags minutes behind.
 *
 * This used to also sweep analytics:posts per platform, which was the only
 * place posts written in the apps ever showed up. That net is gone with the
 * thing it was catching: a post made outside this pipeline is now a one-off,
 * handled by hand rather than by an hourly scan of every platform.
 */
function sources(opts) {
  return [zernio(['posts:list', '--status', 'published', '--limit', String(opts.limit)])];
}

function collectPosts(opts) {
  const seen = new Set();
  const found = [];
  const cutoff = opts.all ? 0 : Date.now() - opts.hours * 3600 * 1000;

  for (const res of sources(opts)) {
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
  return found.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
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
  const posts = collectPosts(opts);
  const pending = posts.filter((p) => !state[p.key]);
  console.log(`[${stamp}] ${posts.length} post(s) in window across ${opts.platforms.join(', ')}, ${pending.length} without a recorded first comment`);

  if (opts.seed) {
    for (const target of pending) {
      state[target.key] = { commentedAt: null, note: 'seeded, not commented', url: target.url };
      console.log(`seed  ${target.key} — marked done without commenting (${target.url})`);
    }
    saveState(state);
    return;
  }

  let failures = 0;
  for (const target of pending) {
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
        state[target.key] = { commentedAt: null, note: 'comments unavailable (403)', url: target.url };
        saveState(state);
        events.emit('comment.skipped', { message: 'comments closed on this post', level: 'warn',
          platform: target.platform, postKey: target.key, url: target.url, accountId: target.accountId,
          dedupeKey: `comment.skipped|${target.key}`, data: { reason: 'comments-closed-403' } });
        console.log(`skip  ${target.key} — comments closed on this post (${target.url})`);
        continue;
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
      // and the click could name a post but never a placement. There is no
      // clip id to give — this watcher only ever sees a published post, never
      // the queue item behind it — so post_key stays the only join.
      const showUrl = (override || !live) ? null : await shortlink.mint({
        platform: target.platform, postKey: target.key, label: target.url || null,
        campaign: 'clip', medium: 'comment',
      });
      const composed = override
        ? { text: override, variant: 'override', index: -1 }
        : voice.firstComment(target.key, {
            platform: target.platform,
            topicTags,
            showUrl,
            linkLive: live,
            // A caption that already carries the tags must not get them again
            // underneath. On Instagram both would spend the 5-cap twice, since
            // it counts caption and comments together.
            noTags: platformTable.get(target.platform).hashtagsInCaption !== 0,
            avoidIndex: state.__lastVariant?.[target.platform] ?? -1,
          });
      const body = composed.text;

      if (opts.dryRun) {
        console.log(`DRY   ${target.key} — would comment [${composed.variant}/${composed.index}] (${target.url})`);
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
      console.log(`post  ${target.key} — commented [${composed.variant}/${composed.index}] (${target.url})`);
    } catch (err) {
      failures++;
      events.emit('comment.failed', { message: err.message, level: 'error', platform: target.platform,
        postKey: target.key, url: target.url, dedupeKey: `comment.failed|${target.key}` });
      console.error(`FAIL  ${target.key} — ${err.message}`);
    }
  }

  events.finishRun({ inWindow: posts.length, pending: pending.length, failures });

  const hc = process.env.MWK_COMMENT_HC_URL; // optional Healthchecks.io ping
  if (hc && !opts.dryRun) {
    try { execFileSync('curl', ['-fsS', '-m', '10', '-o', '/dev/null', failures ? `${hc}/fail` : hc]); } catch { /* never fail the run on the ping */ }
  }

  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
