#!/usr/bin/env node
/*
 * Take one thing off the dashboard queue and post it — if now is a good moment.
 *
 * The pace lives here, not in the Worker. The queue is a to-do list; this is
 * the only thing that decides WHEN, and it shares lib/pace.js with the mirror
 * so five things queued at once go out over hours rather than in a minute.
 *
 * Claiming is a conditional UPDATE at the far end, so two overlapping runs
 * cannot both take the same item. The claim happens BEFORE the publish, for the
 * same reason the mirror writes its ledger first: a publish that times out has
 * not necessarily failed, and an unclaimed item would be posted twice.
 *
 * Usage:
 *   scripts/run-queue.js                # honour the pace, post at most one
 *   scripts/run-queue.js --scheduled    # same, and say nothing when it is not time
 *   scripts/run-queue.js --dry-run      # claim nothing, print what would go
 *   scripts/run-queue.js --now          # ignore the window (still one at a time)
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
const { publish } = require('./post');

const ledgerPath = () => process.env.MWK_MIRROR_LEDGER ||
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'mwk-social', 'mirror-ledger.json');

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
 * Pull the queued media down to disk. Through curl rather than fetch for the
 * same reason the mirror does: this box has no IPv6 route, the CDN hostnames
 * resolve AAAA-first, and undici's 250 ms Happy Eyeballs window expires before
 * it falls back — which looks exactly like an expired URL.
 */
function fetchMedia(url, token) {
  const { execFileSync } = require('child_process');
  fs.mkdirSync(cacheDir(), { recursive: true });
  const name = `queue-${Buffer.from(url).toString('base64url').slice(-24)}`;
  const out = path.join(cacheDir(), name);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  execFileSync('curl', ['-4', '-sSfL', '--max-time', '600',
    '-H', `Authorization: Bearer ${token}`, '-o', out, url], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error('media downloaded as empty');
  return out;
}

/** Which accounts an item should go to. */
function accountsFor(want) {
  const { cli } = require('./lib/api');
  const all = (cli(['accounts:list']).accounts || []).filter((a) => a.isActive !== false);
  const chosen = want.length ? all.filter((a) => want.includes(a.platform)) : all;
  return chosen.map((a) => ({ id: a._id || a.id, platform: a.platform }));
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const scheduled = argv.includes('--scheduled');
  const ignoreWindow = argv.includes('--now');

  const api = endpoint();

  if (!ignoreWindow) {
    const why = pace.whyNotNow(load(ledgerPath(), {}), {}, new Date(), events.read());
    if (why) { console.log(`not this run — ${why}`); return; }
  }

  const claimed = await call('/queue/claim', {}, api);
  if (!claimed.item) { if (!scheduled) console.log('nothing queued'); return; }
  const item = claimed.item;
  console.log(`claimed ${item.id} — ${item.body.replace(/\s+/g, ' ').slice(0, 60)}`);

  // From here on the item is ours. Anything that goes wrong must either put it
  // back or mark it failed, or it sits 'claimed' forever with nobody looking.
  try {
    let media = [];
    if (item.mediaUrl) media = [fetchMedia(item.mediaUrl, api.token)];

    const want = item.platforms || [];
    // Instagram will not take a post without media, and a text-only item aimed
    // at "wherever it fits" should quietly skip it rather than fail the lot.
    const usable = accountsFor(want).filter((a) => {
      if (a.platform === 'instagram' && !media.length) return false;
      return true;
    });
    if (!usable.length) throw new Error('no account can take this post');

    if (dryRun) {
      console.log(`would post to ${usable.map((a) => a.platform).join(', ')}${media.length ? ' with media' : ''}`);
      await call('/queue/result', { id: item.id, status: 'queued', note: 'dry run' }, api);
      return;
    }

    const result = await publish({
      text: item.body,
      accounts: usable.map((a) => a.id),
      all: false,
      media,
      title: null,
      firstComment: item.firstComment,
      topics: [],
      commentVariant: null,
      tiktokPrivacy: 'PUBLIC_TO_EVERYONE',
      draft: false, schedule: null, wait: true, dryRun: false,
    });

    const outcome = (result.platforms || []).map((p) => ({
      platform: p.platform, status: p.status, url: p.platformPostUrl || null,
      error: p.errorMessage || null,
    }));
    const anyLive = outcome.some((o) => o.status === 'published' || o.url);

    await call('/queue/result', {
      id: item.id, status: anyLive ? 'posted' : 'failed', result: outcome,
      note: anyLive ? null : 'no platform reported a live post',
    }, api);

    // The event is what makes a queued post count against the shared daily cap.
    events.emit('queue.posted', {
      message: `posted "${item.body.replace(/\s+/g, ' ').slice(0, 60)}"`,
      level: anyLive ? 'info' : 'error',
      url: (outcome.find((o) => o.url) || {}).url || null,
      dedupeKey: `queue.posted|${item.id}`,
      data: { queueId: item.id, platforms: outcome },
    });

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
    // Put it back rather than burn it: a bad media URL or a platform having a
    // moment should not cost the post. A genuine failure shows on the page.
    await call('/queue/result', { id: item.id, status: 'queued', note: err.message.slice(0, 200) }, api)
      .catch(() => {});
    events.emit('queue.failed', { message: err.message, level: 'error',
      dedupeKey: `queue.failed|${item.id}|${Date.now()}`, data: { queueId: item.id } });
    throw err;
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
