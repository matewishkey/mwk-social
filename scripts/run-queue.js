#!/usr/bin/env node
/*
 * Take one thing off the dashboard queue and post it — if now is a good moment.
 *
 * The pace lives here, not in the Worker. The queue is a to-do list; this is
 * the only thing that decides WHEN, so five things queued at once go out over
 * hours rather than in a minute.
 *
 * Claiming is a conditional UPDATE at the far end, so two overlapping runs
 * cannot both take the same item. The claim happens BEFORE the publish, and that
 * order is the point: a publish that times out has not necessarily failed, and
 * an unclaimed item would be posted twice.
 *
 * Usage:
 *   scripts/run-queue.js                # honour the pace, post at most one
 *   scripts/run-queue.js --scheduled    # same, and say nothing when it is not time
 *   scripts/run-queue.js --dry-run      # claim nothing, print what would go
 *   scripts/run-queue.js --now          # ignore the pace (still one at a time)
 */
'use strict';

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

net.setDefaultAutoSelectFamilyAttemptTimeout(1000);

const pace = require('./lib/pace');
const events = require('./lib/events');
const health = require('./lib/health');
const platforms = require('./lib/platforms');
const cover = require('./lib/cover');
const mediaLib = require('./lib/media');
const { publish } = require('./post');
const reshare = require('./lib/reshare');
const commentState = require('./lib/comment-state');

const cacheDir = () => process.env.MWK_MEDIA_CACHE ||
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'mwk-social', 'media');

function endpoint() {
  const url = process.env.MWK_LOG_URL;
  const token = process.env.MWK_LOG_TOKEN;
  if (!url || !token) throw new Error('MWK_LOG_URL and MWK_LOG_TOKEN must be set (td-sops apps/mwk-social.enc.env)');
  return { origin: new URL(url).origin, token };
}

async function call(path_, body, { origin, token }) {
  const res = await fetch(`${origin}${path_}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path_} → ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/*
 * Pull the queued media down to disk. Through curl rather than fetch, for the
 * reason lib/media.js spells out: this box has no IPv6 route, the CDN hostnames
 * resolve AAAA-first, and undici's 250 ms Happy Eyeballs window expires before
 * it falls back — which looks exactly like an expired URL.
 */
const EXT = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

function fetchMedia(url, token, mediaType) {
  const { execFileSync } = require('child_process');
  fs.mkdirSync(cacheDir(), { recursive: true });
  // The extension is load-bearing: `zernio media:upload` infers the content
  // type from it and rejects a file without one outright. Same shape of trap as
  // yt-dlp appending its own — the file downloads fine and the upload fails.
  const ext = EXT[mediaType] || path.extname(new URL(url).pathname) || '.mp4';
  const name = `queue-${Buffer.from(url).toString('base64url').slice(-24)}${ext}`;
  const out = path.join(cacheDir(), name);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  execFileSync('curl', ['-4', '-sSfL', '--max-time', '600',
    '-H', `Authorization: Bearer ${token}`, '-o', out, url], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error('media downloaded as empty');
  return out;
}

/**
 * Which accounts an item should go to.
 *
 * LinkedIn is the exception: there are three accounts and only ONE of them is
 * posted to natively — the others repost it (lib/reshare.js says which and
 * why). It was the company page until 2026-09-14; it is his own profile now,
 * because that is where the brand voice is grammatical and where the followers
 * are. Without this filter "linkedin" would resolve to all three and post the
 * same thing three times, silently.
 */
function accountsFor(want) {
  const { cli } = require('./lib/api');
  const all = (cli(['accounts:list']).accounts || []).filter((a) => a.isActive !== false);
  const chosen = want.length ? all.filter((a) => want.includes(a.platform)) : all;
  const { native: company } = reshare.linkedinAccounts();
  return chosen
    // An account on a platform this pipeline has never described is skipped, not
    // fatal — connecting one in Zernio must not stop the posts to everywhere
    // else. See platforms.known(); a Reddit connection did exactly that.
    .filter((a) => {
      if (platforms.known(a.platform)) return true;
      console.log(`skip  ${a.platform} — not in the platform table, nothing describes how to post there`);
      return false;
    })
    .filter((a) => a.platform !== 'linkedin' || !company || (a._id || a.id) === (company._id || company.id))
    .map((a) => ({ id: a._id || a.id, platform: a.platform }));
}

/**
 * What the run concluded, from what each platform actually did.
 *
 * THE RULE THIS COST US (2026-08-21): an item that has put something live is
 * never queued again. X's media upload failed, the exception unwound past four
 * platforms that had already published, the item went back to 'queued', and the
 * next tick posted the whole thing again — three times over on TikTok, Facebook
 * and LinkedIn before it was stopped by hand. Two of those TikToks could not be
 * deleted at all, because TikTok has no delete API.
 *
 * So a partial failure is 'posted' with the failures recorded, never a retry.
 * Re-queueing is a decision for a human looking at what is already up.
 */
function verdict(outcome) {
  const anyLive = outcome.some((o) => o.status === 'published' || o.url);
  const isLive = (o) => o.status === 'published' || o.url;
  // 'failed' is the platform saying so. Anything else that is not live — a
  // request that timed out at our end, a platform still 'processing' when we
  // stopped waiting — is UNKNOWN: Zernio may be publishing it right now. An
  // unknown is never a failure, because a failure is what gets re-queued, and
  // a re-queue of something that did go out is the duplicate this function
  // exists to prevent (2026-08-21, three copies on TikTok, two undeletable).
  const failed = outcome.filter((o) => !isLive(o) && o.status === 'failed');
  const unknown = outcome.filter((o) => !isLive(o) && o.status !== 'failed');
  if (!anyLive && !unknown.length) {
    return { anyLive, result: { status: 'failed', result: outcome, note: 'no platform reported a live post' } };
  }
  const parts = [];
  if (failed.length) parts.push(`${failed.map((f) => f.platform).join(', ')} failed — re-queue by hand if you want them`);
  if (unknown.length) parts.push(`${unknown.map((u) => u.platform).join(', ')} unknown (timed out or still processing) — look on the platform before doing anything`);
  return {
    anyLive,
    result: {
      status: 'posted',
      result: outcome,
      note: parts.length ? `${anyLive ? 'live, but ' : 'nothing confirmed: '}${parts.join('; ')}` : null,
    },
  };
}

/** The header comment, verbatim — it is the usage text and the only copy of it. */
function usage() {
  const src = fs.readFileSync(__filename, 'utf8');
  const header = src.slice(src.indexOf('/*'), src.indexOf('*/'));
  return header.replace(/^\/\*\n?/, '').replace(/^ ?\* ?/gm, '').trimEnd();
}

/*
 * STRICT, BECAUSE THIS IS THE ONE SCRIPT THAT PUBLISHES. It used to read its
 * three flags with `includes()` and ignore everything else, so `--help`,
 * `--dryrun`, `--dry_run` and `--dry-runn` were all a live publish — and on
 * 2026-08-27 `--help` claimed a queued item and posted it to Instagram, Threads
 * and X while somebody was looking up the flag list (#37). Instagram and TikTok
 * cannot be deleted through the API, so a wrong publish there is permanent.
 * queue-add.js and post.js refuse one too; yt-description, ship-events and
 * ship-stats still read their flags with bare argv.includes().
 */
const FLAGS = { '--dry-run': 'dryRun', '--scheduled': 'scheduled', '--now': 'ignorePace', '--help': 'help', '-h': 'help' };
function parseArgs(argv) {
  const opts = { dryRun: false, scheduled: false, ignorePace: false, help: false };
  for (const a of argv) {
    if (!(a in FLAGS)) {
      throw new Error(`unknown argument: ${a}\n\n${usage()}`);
    }
    opts[FLAGS[a]] = true;
  }
  return opts;
}

async function main() {
  const { dryRun, scheduled, ignorePace, help } = parseArgs(process.argv.slice(2));
  if (help) { console.log(usage()); return; }

  const api = endpoint();

  if (!ignorePace) {
    const why = pace.whyNotNow(events.read());
    // --scheduled is the timer, which now asks nine times an hour. It says
    // nothing when the answer is "not yet", exactly as the flag has always
    // claimed; by hand it explains itself.
    if (why) { if (!scheduled) console.log(`not this run — ${why}`); return; }
  }

  const claimed = await call('/queue/claim', {}, api);
  if (!claimed.item) { if (!scheduled) console.log('nothing queued'); return; }
  const item = claimed.item;
  console.log(`claimed ${item.id} — ${item.body.replace(/\s+/g, ' ').slice(0, 60)}`);

  // From here on the item is ours. Anything that goes wrong must either put it
  // back or mark it failed, or it sits 'claimed' forever with nobody looking.
  //
  // Outside the try on purpose: the catch has to know whether anything reached a
  // platform before it decides between putting the item back and letting it lie.
  let anyLive = false;
  try {
    /*
     * One video per post is a hard limit on every platform, so a vertical cut
     * and a landscape cut can never ride together. When both are given the run
     * splits: vertical surfaces get the reel, the rest get the wide one, as
     * separate posts. Given only one, everything gets that one.
     */
    const load = (url, type) => {
      if (!url) return null;
      const file = fetchMedia(url, api.token, type);
      let probe = null;
      try { probe = mediaLib.probe(file); } catch { probe = null; }
      return { file, probe };
    };
    const tall = load(item.mediaUrl, item.mediaType);
    const wide = load(item.mediaWideUrl, item.mediaType);
    // The rest of a GALLERY, which rides with `tall` in one post. Stills only:
    // platforms.galleryFor() collapses a set with a video in it back to one
    // item rather than half-publishing a mixed post.
    const extra = (item.mediaExtraUrls || []).map((u) => load(u, item.mediaType)).filter(Boolean);

    const want = item.platforms || [];
    // Which cut a platform should get. With only one available, everyone gets it.
    const cutFor = (platform) => {
      if (!wide) return tall;
      if (!tall) return wide;
      return platforms.get(platform).landscapeOk ? wide : tall;
    };
    /*
     * What a platform actually publishes: its cut, plus as much of the gallery
     * as it will take. A gallery only ever rides with `tall` — the wide cut is
     * the OTHER video, not another page of the same post.
     */
    const setFor = (platform) => {
      const cut = cutFor(platform);
      if (!cut) return [];
      if (!extra.length || cut !== tall) return [cut];
      return platforms.galleryFor(platform, [cut, ...extra]);
    };

    const usable = accountsFor(want).filter((a) => {
      const cut = cutFor(a.platform);
      // Instagram will not take a post without media, and a text-only item aimed
      // at "wherever it fits" should quietly skip it rather than fail the lot.
      if (a.platform === 'instagram' && !cut) return false;
      // EVERY image in the set, not just the first. Checking the cut alone was
      // right while a post carried one file and became a hole the moment a
      // gallery could ride with it: a second image outside the platform's
      // aspect range would have reached Zernio unchecked, with the item already
      // claimed. A platform is dropped whole and told why, never quietly sent a
      // shortened gallery — a silent 5-of-6 is worse than a named skip.
      for (const m of setFor(a.platform)) {
        if (!m.probe) continue;
        // Check before Zernio does: a duration or aspect a platform will not
        // take costs the post otherwise. check() returns the reasons, empty
        // when it is fine.
        const problems = mediaLib.check(a.platform, m.probe);
        if (problems.length) {
          console.log(`skip  ${a.platform} — ${path.basename(m.file)}: ${problems.join('; ')}`);
          return false;
        }
      }
      return true;
    });
    if (!usable.length) throw new Error('no account can take this post');

    // Group by the MEDIA SET each platform gets: one publish per distinct set.
    // Keyed on every file in order, not just the first, or X's four-image cap
    // would silently share LinkedIn's request and publish twenty.
    const groups = new Map();
    const setOf = new Map();
    for (const a of usable) {
      const set = setFor(a.platform);
      const key = set.map((m) => m.file).join('\u0000');
      if (!groups.has(key)) { groups.set(key, []); setOf.set(key, set); }
      groups.get(key).push(a);
    }

    if (dryRun) {
      for (const [key, accts] of groups) {
        const set = setOf.get(key);
        console.log(`would post to ${accts.map((a) => a.platform).join(', ')}`
          + (set.length ? ` with ${set.map((m) => path.basename(m.file)).join(', ')}` : ' with no media'));
      }
      // 'released', not 'queued': a dry run is not an attempt, and three of
      // them used to mark the item failed.
      await call('/queue/result', { id: item.id, status: 'released', note: 'dry run' }, api);
      return;
    }

    // One group failing must not abandon the groups behind it, and — far worse —
    // must not unwind the ones in front of it. Each is caught where it happens
    // so a failure is a recorded outcome rather than an exception that reaches
    // the requeue below.
    const outcome = [];
    for (const [key, accts] of groups) {
      const set = setOf.get(key);
      try {
        const result = await publish({
          text: item.body,
          // So each queued post gets its own short codes rather than sharing a
          // generic per-platform one. A retry keys off the item it is retrying,
          // not itself, or the same post's clicks land under two codes.
          postKey: `queue:${item.retryOf || item.id}`,
          // The queue item id, stored on every code this post mints. It is what
          // makes a click answerable back to a VIDEO: queue_item carries the
          // media_key, so click -> link.clip_id -> queue_item.media_key is the
          // whole chain. Before 2026-08-22 clip_id was never set and the only
          // route back was a LIKE on the post_key prefix.
          clipId: item.retryOf || item.id,
          // Platforms where a link in this CLIP's post would be plain text.
          // YouTube turns a vertical under three minutes into a Short, and a
          // url in a Short's description or comment is not clickable — so the
          // CTA names the bio there instead of spending a code nobody can follow.
          linkDead: accts.map((a) => a.platform)
            .filter((pl) => platforms.linkDeadFor(pl, (cutFor(pl) || {}).probe)),
          // Already measured on the way in, so the publisher does not run
          // ffprobe over the same file again. Every account in this group
          // shares one media set by construction, so one probe answers for
          // all of them — it is what decides whether the caption is his title
          // line (a short) or all of his words (anything else).
          probe: (set[0] || {}).probe || null,
          // WHICH FRAME THE PLATFORMS SHOW BEFORE ANYBODY PRESSES PLAY.
          // Every platform that takes one has its own default and they are
          // all wrong for a clip that opens on an empty shot — Instagram's
          // is frame zero. One number here, converted per platform by
          // platforms.coverFor(), clamped to inside this clip.
          coverMs: platforms.coverMsFor((set[0] || {}).probe),
          accounts: accts.map((a) => a.id),
          all: false,
          media: set.map((m) => m.file),
          title: null,
          firstComment: item.firstComment,
          comment: item.commentText || null,
          // Where this post points. Null means the show, which is the default
          // and the only thing mwkshow.com ever stands for.
          link: item.link || null,
          topics: item.topics || [],
          commentVariant: null,
          tiktokPrivacy: 'PUBLIC_TO_EVERYONE',
          draft: false, schedule: null, wait: true, dryRun: false,
        });
        for (const p of result.platforms || []) {
          outcome.push({ platform: p.platform, status: p.status,
            // The PLATFORM's own id, which is the only thing addressable — every
            // inbox: command 404s on the Zernio one, and it is the key the
            // first-comment watcher files a post under.
            postId: p.platformPostId || null,
            url: p.platformPostUrl || null, error: p.errorMessage || null });
        }

        /*
         * YOUTUBE TAKES A PICTURE, NOT A TIMESTAMP, SO ITS COVER IS SET AFTER
         * THE FACT.
         *
         * The other three carry the offset in the publish itself. YouTube has
         * no such field, so the frame is cut, uploaded and pushed through
         * update-metadata once the video exists — and it DOES land on a
         * Short, which is the thing both Zernio's docs and this repo had
         * wrong until it was exercised (lib/cover.js carries the measurement).
         * It changes the 16:9 thumbnail; the vertical cover in the Shorts
         * feed stays YouTube's.
         *
         * Caught on its own: the post is already live, so a cover that fails
         * is a line in the journal, never the item's verdict.
         */
        const coverMs = platforms.coverMsFor((set[0] || {}).probe);
        const coverFile = (set[0] || {}).file;
        for (const o of outcome) {
          const isVideo = !!((set[0] || {}).probe && !set[0].probe.isImage);
          if (!cover.wantsCover(o, { isVideo, coverMs })) continue;
          const yt = accts.find((x) => x.platform === 'youtube');
          if (!yt) continue;
          try {
            await cover.setYoutubeCover({ file: coverFile, ms: coverMs,
              videoId: o.postId, accountId: yt.id });
            console.log(`cover  youtube ${o.postId} — frame at ${coverMs} ms `
              + '(the 16:9 thumbnail; the Shorts feed keeps YouTube\'s own)');
          } catch (err) {
            console.log(`cover  youtube ${o.postId} — not set: ${err.message}`);
          }
        }
      } catch (err) {
        console.error(`${accts.map((a) => a.platform).join('+')} failed: ${err.message}`);
        for (const a of accts) {
          outcome.push({ platform: a.platform, status: 'failed', url: null, error: err.message });
        }
      }
    }
    const call_ = verdict(outcome);
    anyLive = call_.anyLive;
    await call('/queue/result', { id: item.id, ...call_.result }, api);

    /*
     * "No first comment" has to mean it, past the first hour.
     *
     * post.js correctly sends no native comment for this item — and then the
     * hourly watcher read posts:list, found a published post with no CTA in its
     * caption and none in its comments, and posted one. It had no way to tell a
     * deliberate absence from the gap it exists to fill. Recording the decision
     * under the key it looks up is what makes the flag a decision rather than a
     * one-hour delay.
     */
    /*
     * Where this post points, for the watcher. It cannot look a queue item up
     * from a published post, and on Threads it is the only path there is — so
     * without this a `--link` post gets the show under it. Recorded for every
     * platform, because a native first comment can fail and the watcher is
     * what backfills it.
     */
    if (item.link) {
      const noted = commentState.recordLinks(
        outcome.filter((o) => o.postId).map((o) => ({ platform: o.platform, postId: o.postId })),
        item.link);
      if (noted) console.log(`destination recorded on ${noted} post(s) — ${item.link}`);
    }

    if (item.firstComment === false) {
      const suppressed = commentState.suppress(
        outcome.filter((o) => o.postId).map((o) => ({ platform: o.platform, postId: o.postId, url: o.url })),
        `queued with the first comment switched off (${item.id})`);
      if (suppressed) console.log(`first comment suppressed on ${suppressed} post(s) — the watcher will leave them alone`);
    }

    // "Something went out today" — a dead-man with a one-day period, so a
    // week of nothing posting is an email rather than a discovery.
    if (anyLive) health.ping('posted', { message: `posted ${item.id}` });

    // The event is what makes a queued post count against the shared daily cap.
    events.emit('queue.posted', {
      message: `posted "${item.body.replace(/\s+/g, ' ').slice(0, 60)}"`,
      level: anyLive ? 'info' : 'error',
      url: (outcome.find((o) => o.url) || {}).url || null,
      dedupeKey: `queue.posted|${item.id}`,
      data: { queueId: item.id, platforms: outcome },
    });

    // LinkedIn: his profile has it, now the page and the other profile repost
    // it. A reshare that fails must not fail the post, which is already live
    // and correct.
    const li = outcome.find((o) => o.platform === 'linkedin' && o.url);
    // reshare === false means "do not"; anything else reposts, with his words
    // on top only if he wrote some — and only where the account speaks for him.
    if (li && item.reshare !== false) {
      // Every reposting account, not just the first. A second one was invisible
      // to this until the list became a list.
      //
      // reshareAll() catches each account for itself, so this try only covers
      // the account LOOKUP failing — but it still has to be here: the post is
      // already live, and a repost that cannot happen must never turn a
      // published item into a failed one.
      let shared = [];
      try {
        shared = await reshare.reshareAll(li.url, item.reshareText, {
          // So each repost mints its own code against the same clip: the
          // company page and the two personal profiles are three different
          // audiences and "which one earned this click" has to have an answer.
          clipId: item.retryOf || item.id,
          topics: item.topics || [],
          firstComment: item.firstComment !== false,
        });
      }
      catch (err) {
        shared = [];
        console.error(`could not read the LinkedIn accounts, so nothing was reposted: ${err.message}`);
        events.emit('linkedin.reshare-failed', { message: err.message, level: 'warn',
          platform: 'linkedin', dedupeKey: `linkedin.reshare-failed|${item.id}|lookup` });
      }
      for (const r of shared) {
        if (r.ok) {
          const when = r.delayMinutes
            ? `in ${Math.round(r.delayMinutes / 60)}h` : 'now';
          console.log(`repost from ${r.account} — ${when}${item.reshareText && !r.plain ? ', with your words' : ' (plain repost)'}`
            + `${r.cta ? ', with its own tracked CTA' : r.plain ? ', nothing in your voice under their name' : ''}`);
          events.emit('linkedin.reshared', { message: `quote-reshared from ${r.account}`,
            platform: 'linkedin', url: li.url, dedupeKey: `linkedin.reshared|${item.id}|${r.account}` });
        } else {
          console.error(`reshare from ${r.account} failed (the post itself is fine): ${r.error}`);
          events.emit('linkedin.reshare-failed', { message: `${r.account}: ${r.error}`, level: 'warn',
            platform: 'linkedin', dedupeKey: `linkedin.reshare-failed|${item.id}|${r.account}` });
        }
      }
      /*
       * Record the reposts on the item, beside the native post. The watcher
       * files a repost under `linkedin:<its own post id>`, and resolveClipId()
       * in the Worker finds the clip by searching queue_item.result for that
       * id — so a repost that is not written here is a code with no clip
       * behind it (ten of them by 2026-09-20). A scheduled repost has no id
       * yet and is recorded as such; the item's status and note are re-sent
       * unchanged, this only extends the outcome list.
       */
      const reposts = shared.filter((r) => r.ok).map((r) => ({
        platform: 'linkedin', role: 'repost', account: r.account,
        status: r.postId ? 'published' : 'scheduled',
        postId: r.postId || null, url: r.url || null, zernioId: r.id || null, error: null,
      }));
      if (reposts.length) {
        await call('/queue/result', { id: item.id, ...call_.result, result: [...outcome, ...reposts] }, api)
          .catch((err) => console.error(`could not record the reposts on the item (the reposts themselves are fine): ${err.message}`));
      }
    }

    /*
     * There used to be a "share this to your personal Facebook" action filed
     * here for every live Facebook post. Twelve were filed between 21 Aug and
     * 8 Sep and he did none of them, so the "need you" tile read 13 for three
     * weeks and anything real would have landed under twelve stale rows he had
     * learned to scroll past. Removed 2026-09-14. The rule for manual_action
     * from now on: a row is filed only if not doing it costs something.
     */
    console.log(anyLive ? 'posted' : 'nothing went live — marked failed');
  } catch (err) {
    // Put it back rather than burn it — but ONLY if nothing went live. Once a
    // single platform has it, re-queueing means posting it twice, and on TikTok
    // and Instagram the second copy cannot be deleted afterwards.
    await call('/queue/result', anyLive
      ? { id: item.id, status: 'posted', note: `stopped after publishing: ${err.message}`.slice(0, 200) }
      : { id: item.id, status: 'queued', note: err.message.slice(0, 200) }, api)
      .catch(() => {});
    events.emit('queue.failed', { message: err.message, level: 'error',
      dedupeKey: `queue.failed|${item.id}|${Date.now()}`, data: { queueId: item.id } });
    throw err;
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { verdict };
