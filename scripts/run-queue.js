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
const platforms = require('./lib/platforms');
const mediaLib = require('./lib/media');
const { publish } = require('./post');
const reshare = require('./lib/reshare');

const cacheDir = () => process.env.MWK_MEDIA_CACHE ||
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'mwk-social', 'media');

const load = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};

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
 * LinkedIn is the exception: there are two accounts and only ONE of them may be
 * posted to natively. The playbook is company page first, then a quote-reshare
 * from the personal account — never a native post to personal — because the
 * point is to move engagement onto the page, and a native personal post moves
 * none. Without this filter "linkedin" would resolve to both and do the wrong
 * thing silently.
 */
function accountsFor(want) {
  const { cli } = require('./lib/api');
  const all = (cli(['accounts:list']).accounts || []).filter((a) => a.isActive !== false);
  const chosen = want.length ? all.filter((a) => want.includes(a.platform)) : all;
  const { company } = reshare.linkedinAccounts();
  return chosen
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
  const failed = outcome.filter((o) => o.status !== 'published' && !o.url);
  if (!anyLive) {
    return { anyLive, result: { status: 'failed', result: outcome, note: 'no platform reported a live post' } };
  }
  return {
    anyLive,
    result: {
      status: 'posted',
      result: outcome,
      note: failed.length
        ? `live, but ${failed.map((f) => f.platform).join(', ')} failed — re-queue by hand if you want them`
        : null,
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const scheduled = argv.includes('--scheduled');
  const ignorePace = argv.includes('--now');

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

    const want = item.platforms || [];
    // Which cut a platform should get. With only one available, everyone gets it.
    const cutFor = (platform) => {
      if (!wide) return tall;
      if (!tall) return wide;
      return platforms.get(platform).landscapeOk ? wide : tall;
    };

    const usable = accountsFor(want).filter((a) => {
      const cut = cutFor(a.platform);
      // Instagram will not take a post without media, and a text-only item aimed
      // at "wherever it fits" should quietly skip it rather than fail the lot.
      if (a.platform === 'instagram' && !cut) return false;
      if (cut && cut.probe) {
        // Check before Zernio does: a duration or aspect a platform will not
        // take costs the post otherwise, and the item is already claimed by
        // then. check() returns the reasons, empty when it is fine.
        const problems = mediaLib.check(a.platform, cut.probe);
        if (problems.length) {
          console.log(`skip  ${a.platform} — ${problems.join('; ')}`);
          return false;
        }
      }
      return true;
    });
    if (!usable.length) throw new Error('no account can take this post');

    // Group by the cut each platform gets: one publish per distinct video.
    const groups = new Map();
    for (const a of usable) {
      const cut = cutFor(a.platform);
      const key = cut ? cut.file : '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }

    if (dryRun) {
      for (const [file, accts] of groups) {
        console.log(`would post to ${accts.map((a) => a.platform).join(', ')}`
          + (file ? ` with ${path.basename(file)}` : ' with no media'));
      }
      await call('/queue/result', { id: item.id, status: 'queued', note: 'dry run' }, api);
      return;
    }

    // One group failing must not abandon the groups behind it, and — far worse —
    // must not unwind the ones in front of it. Each is caught where it happens
    // so a failure is a recorded outcome rather than an exception that reaches
    // the requeue below.
    const outcome = [];
    for (const [file, accts] of groups) {
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
          accounts: accts.map((a) => a.id),
          all: false,
          media: file ? [file] : [],
          title: null,
          firstComment: item.firstComment,
          comment: item.commentText || null,
          topics: item.topics || [],
          commentVariant: null,
          tiktokPrivacy: 'PUBLIC_TO_EVERYONE',
          draft: false, schedule: null, wait: true, dryRun: false,
        });
        for (const p of result.platforms || []) {
          outcome.push({ platform: p.platform, status: p.status,
            url: p.platformPostUrl || null, error: p.errorMessage || null });
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

    // The event is what makes a queued post count against the shared daily cap.
    events.emit('queue.posted', {
      message: `posted "${item.body.replace(/\s+/g, ' ').slice(0, 60)}"`,
      level: anyLive ? 'info' : 'error',
      url: (outcome.find((o) => o.url) || {}).url || null,
      dedupeKey: `queue.posted|${item.id}`,
      data: { queueId: item.id, platforms: outcome },
    });

    // LinkedIn: the company page has it, now share it as him — but only if he
    // wrote the words. A reshare that fails must not fail the post, which is
    // already live and correct.
    const li = outcome.find((o) => o.platform === 'linkedin' && o.url);
    // reshare === false means "do not"; anything else reposts, with his words
    // on top only if he wrote some.
    if (li && item.reshare !== false) {
      // Every personal account, not just the first. There are two now, and the
      // second was invisible to this until the list became a list.
      //
      // reshareAll() catches each account for itself, so this try only covers
      // the account LOOKUP failing — but it still has to be here: the post is
      // already live, and a repost that cannot happen must never turn a
      // published item into a failed one.
      let shared = [];
      try { shared = await reshare.reshareAll(li.url, item.reshareText); }
      catch (err) {
        shared = [];
        console.error(`could not read the LinkedIn accounts, so nothing was reposted: ${err.message}`);
        events.emit('linkedin.reshare-failed', { message: err.message, level: 'warn',
          platform: 'linkedin', dedupeKey: `linkedin.reshare-failed|${item.id}|lookup` });
      }
      for (const r of shared) {
        if (r.ok) {
          console.log(`reposted from ${r.account}${item.reshareText ? ' with your words' : ' (plain repost)'}`);
          events.emit('linkedin.reshared', { message: `quote-reshared from ${r.account}`,
            platform: 'linkedin', url: li.url, dedupeKey: `linkedin.reshared|${item.id}|${r.account}` });
        } else {
          console.error(`reshare from ${r.account} failed (the post itself is fine): ${r.error}`);
          events.emit('linkedin.reshare-failed', { message: `${r.account}: ${r.error}`, level: 'warn',
            platform: 'linkedin', dedupeKey: `linkedin.reshare-failed|${item.id}|${r.account}` });
        }
      }
    }

    // Facebook cannot post to a personal timeline through any API, so a live FB
    // post becomes a link to click rather than a thing we pretend we did.
    for (const o of outcome) {
      if (o.platform === 'facebook' && o.url && platforms.get('facebook').reshare === 'manual') {
        await call('/actions', {
          kind: 'fb-personal-share', platform: 'facebook', url: o.url,
          label: 'Share this to your personal timeline',
          dedupeKey: `fb-personal-share|${item.id}`,
        }, api).catch(() => {});
      }
    }
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
