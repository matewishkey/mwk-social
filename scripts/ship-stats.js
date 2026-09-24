#!/usr/bin/env node
/*
 * Ship the slow-moving half of the dashboard: analytics, follower counts, the
 * platform table and the pace.
 *
 * Separate from ship-events.js and on a much slower timer, because these come
 * from Zernio rather than off the disk. Asking for a month of analytics every
 * two minutes would spend the API budget on numbers that move once a day.
 *
 * Daily metrics are UPSERTED at the far end rather than ignored: a day's numbers
 * keep moving for a while after it ends, so the newest read wins. They are also
 * banked in a table rather than shipped as a snapshot — Zernio keeps roughly
 * twelve months per account, and that is the one thing here which cannot be
 * backfilled once the window rolls.
 *
 * Usage:
 *   scripts/ship-stats.js
 *   scripts/ship-stats.js --dry-run
 *   scripts/ship-stats.js --days 90
 */
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { cli } = require('./lib/api');
const { endpoint, call } = require('./lib/dashboard');
const { flags } = require('./lib/args');
const health = require('./lib/health');
const platforms = require('./lib/platforms');
const pace = require('./lib/pace');
const voice = require('./lib/voice');
const events = require('./lib/events');

const DEFAULT_DAYS = 45;

const iso = (d) => d.toISOString().slice(0, 10);

/**
 * analytics:daily, flattened to one row per (date, platform).
 *
 * Through the CLI rather than lib/api: the REST route behind `analytics:daily`
 * is not /v1/analytics/daily — that path answers with the marketing site's HTML,
 * which parses as "not JSON" rather than as a 404. The CLI knows the real one.
 */
async function daily(days) {
  const from = iso(new Date(Date.now() - days * 86400_000));
  const res = cli(['analytics:daily', '--from', from, '--to', iso(new Date())]);
  const rows = [];
  for (const d of res.dailyData || []) {
    for (const [platform, m] of Object.entries(d.platformMetrics || {})) {
      rows.push({
        date: d.date, platform,
        post_count: m.postCount ?? 0, impressions: m.impressions ?? 0, reach: m.reach ?? 0,
        views: m.views ?? 0, likes: m.likes ?? 0, comments: m.comments ?? 0,
        shares: m.shares ?? 0, saves: m.saves ?? 0, clicks: m.clicks ?? 0,
      });
    }
  }
  return rows;
}

/*
 * THE LATEST POSTS, ONE ROW PER POST (2026-09-24). "How is the last post
 * doing" was the question asked most and the page could not answer it: every
 * table here is per DAY, and a day can hold two posts and a live stream.
 *
 * One post goes out as several Zernio posts (one per caption group), so they
 * are joined back on the first line — the title line, which every platform
 * carries whichever way its caption was composed — within one Brisbane day.
 * A LinkedIn repost has no content of its own and is left out: it is the same
 * post seen again, and folding it in would count it twice.
 * Shipped as a snapshot, not a table: Zernio holds the lifetime number, so
 * the newest read is the whole truth and there is nothing to bank.
 */
const POSTS_SHOWN = 10;
function latestPosts(res) {
  const day = (t) => new Date(new Date(t).getTime() + 10 * 3600_000).toISOString().slice(0, 10);
  const groups = new Map();
  for (const p of res.posts || []) {
    // TikTok hands its caption back as ONE line, tags and credit attached, so
    // the title is cut at the first tag or mention and matched on its start.
    const title = String(p.content || '').split('\n')[0].split(/\s[#@]/)[0].trim();
    if (!title || !p.publishedAt) continue;
    const key = `${day(p.publishedAt)}|${title.toLowerCase().slice(0, 40)}`;
    if (!groups.has(key)) groups.set(key, { title, publishedAt: p.publishedAt, platforms: [] });
    const g = groups.get(key);
    if (p.publishedAt < g.publishedAt) g.publishedAt = p.publishedAt;
    if (title.length < g.title.length) g.title = title;
    for (const pf of (p.platforms && p.platforms.length ? p.platforms : [p])) {
      const a = pf.analytics || p.analytics || {};
      g.platforms.push({
        platform: pf.platform || p.platform, url: pf.platformPostUrl || p.platformPostUrl || null,
        views: a.views || 0, impressions: a.impressions || 0,
        likes: a.likes || 0, comments: a.comments || 0, shares: a.shares || 0, saves: a.saves || 0,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, POSTS_SHOWN);
}

/*
 * WHICH FORMAT A POST WAS (2026-09-24, mate: "I do not see any stats about
 * reels shorts etc... for youtube for example"). Every table was per platform,
 * so a Short and an hour-long live stream were one YouTube number.
 *
 * Facebook and Instagram say it in the URL (/reel/); the rest carry mediaType.
 * YOUTUBE SAYS NOTHING: every video comes back as /watch, Short or live alike,
 * with an empty media url. So yt-dlp is asked once per video — shape, length,
 * live_status — and the answer is kept on disk, because a video's format never
 * changes. The job has a 5-minute ceiling (install-timers.sh), so at most
 * PROBES_PER_RUN new videos are asked about per run, inside PROBE_BUDGET_MS;
 * the rest read "unknown" until a later run gets to them. A failed probe is
 * not cached, so it is asked again rather than frozen as unknown.
 */
const FORMAT_CACHE = path.join(process.env.MWK_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'mwk-social'), 'yt-formats.json');
const PROBES_PER_RUN = 10;
const PROBE_BUDGET_MS = 90_000;

function youtubeFormats(ids) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(FORMAT_CACHE, 'utf8')); } catch { /* first run */ }
  const started = Date.now();
  let asked = 0;
  for (const id of ids) {
    if (cache[id] || asked >= PROBES_PER_RUN || Date.now() - started > PROBE_BUDGET_MS) continue;
    asked += 1;
    try {
      const raw = execFileSync('yt-dlp', ['-q', '--no-warnings', '--print',
        '%(width)s %(height)s %(duration)s %(live_status)s', '--', `https://www.youtube.com/watch?v=${id}`],
      { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n')[0];
      const [w, h, dur, live] = raw.split(/\s+/);
      const width = Number(w); const height = Number(h); const durationSec = Number(dur);
      if (/^(was_live|is_live|post_live|is_upcoming)$/.test(live)) cache[id] = 'live';
      else if (width > 0 && height > 0 && Number.isFinite(durationSec)) {
        cache[id] = platforms.isShort({ aspect: width / height, durationSec }) ? 'short' : 'video';
      }
    } catch { /* not cached: asked again next run */ }
  }
  try { fs.mkdirSync(path.dirname(FORMAT_CACHE), { recursive: true }); fs.writeFileSync(FORMAT_CACHE, JSON.stringify(cache)); } catch { /* read-only is survivable */ }
  return cache;
}

const ytId = (url) => { try { return new URL(url).searchParams.get('v'); } catch { return null; } };

function formatOf(platform, url, mediaType, yt) {
  if (platform === 'youtube') return yt[ytId(url)] || 'unknown';
  if ((platform === 'facebook' || platform === 'instagram') && /\/reel\//.test(url || '')) return 'reel';
  return mediaType || 'unknown';
}

/*
 * Every post of the last FORMAT_DAYS days, by platform and format: how many,
 * what they were seen by, and the best one. Paged, because a month is more
 * than one page of analytics:posts.
 */
const FORMAT_DAYS = 30;
function allRecentPosts(days) {
  // A plain date: `--from` answers "Invalid ISO date" to a full timestamp.
  const from = iso(new Date(Date.now() - days * 86400_000));
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const res = cli(['analytics:posts', '--from', from, '--limit', '100', '--page', String(page)]);
    out.push(...(res.posts || []));
    if (!res.pagination || page >= (res.pagination.pages || 1)) break;
  }
  return { posts: out };
}

function formatTable(res) {
  const rows = [];
  for (const p of res.posts || []) for (const pf of (p.platforms && p.platforms.length ? p.platforms : [p])) {
    rows.push({ p, pf, platform: pf.platform || p.platform, url: pf.platformPostUrl || p.platformPostUrl || '' });
  }
  const yt = youtubeFormats([...new Set(rows.filter((r) => r.platform === 'youtube').map((r) => ytId(r.url)).filter(Boolean))]);
  const groups = new Map();
  for (const r of rows) {
    const a = r.pf.analytics || r.p.analytics || {};
    const format = formatOf(r.platform, r.url, r.p.mediaType, yt);
    const key = `${r.platform}|${format}`;
    const g = groups.get(key) || { platform: r.platform, format, posts: 0, views: 0, impressions: 0,
      likes: 0, comments: 0, shares: 0, saves: 0, best: null };
    const seen = a.views || a.impressions || 0;
    g.posts += 1;
    for (const k of ['views', 'impressions', 'likes', 'comments', 'shares', 'saves']) g[k] += a[k] || 0;
    if (!g.best || seen > g.best.seen) {
      g.best = { seen, url: r.url || null,
        title: String(r.p.content || '').split('\n')[0].split(/\s[#@]/)[0].trim().slice(0, 80) || null };
    }
    groups.set(key, g);
  }
  return { days: FORMAT_DAYS, rows: [...groups.values()] };
}

async function followers() {
  const res = cli(['accounts:follower-stats']);
  const day = iso(new Date());
  return (res.accounts || []).map((a) => ({
    day, accountId: a._id, platform: a.platform,
    username: a.username, followers: a.currentFollowers ?? null,
  }));
}

/**
 * What the workflow page renders. Shipped rather than duplicated in the Worker,
 * so the page and the publish path read the same table.
 */
function platformSnapshot() {
  return { flows: platforms.flows() };
}

/** The public half of voice.json — what we say, never how it is composed. */
function voiceSnapshot() {
  const cfg = voice.config ? voice.config() : null;
  if (!cfg) return null;
  return {
    marker: cfg.marker,
    always: cfg.tags.always,
    caps: cfg.tags.caps,
    maxTopic: cfg.tags.maxTopic,
    variants: (cfg.firstComment.plain || []).length + (cfg.firstComment.episode || []).length,
    plainVariants: (cfg.firstComment.plain || []).length,
    episodeVariants: (cfg.firstComment.episode || []).length,
    shortLinkHost: (cfg.shortLink && cfg.shortLink.enabled) ? cfg.shortLink.host : null,
    blockedCount: (cfg.tags.blocked || []).length,
    episodeMixRatio: cfg.firstComment.episodeMixRatio,
    // The blurb goes at the bottom of every YouTube description. While it is
    // still a paraphrase rather than his own words, auto-fill stays paused —
    // the page reads this flag and says so out loud.
    blurbChosen: !/PENDING/.test(cfg.youtubeDescription._showBlurb || ''),
  };
}

async function main() {
  const opt = flags(process.argv.slice(2), {
    '--dry-run': { key: 'dryRun' }, '--days': { key: 'days', value: true },
  });
  const { dryRun } = opt;
  const days = opt.days === null ? DEFAULT_DAYS : Number(opt.days);
  if (!Number.isInteger(days) || days < 1) throw new Error(`--days wants a whole number of days, got ${opt.days}`);
  const { origin } = endpoint();

  const [rows, folk] = await Promise.all([daily(days), followers()]);
  // One read serves both the latest-posts card and the format table.
  const recent = allRecentPosts(FORMAT_DAYS);
  const snapshots = {
    posts: latestPosts(recent),
    formats: formatTable(recent),
    platforms: platformSnapshot(),
    voice: voiceSnapshot(),
    pace: pace.status(events.read()),
  };

  if (dryRun) {
    console.log(`would ship ${rows.length} daily row(s) and ${folk.length} follower count(s) to ${origin}`);
    console.log(`  pace: ${snapshots.pace.today}/${snapshots.pace.perDay} today, next ${snapshots.pace.nextAt || '—'}`);
    console.log(`  blurb chosen: ${snapshots.voice && snapshots.voice.blurbChosen}`);
    for (const f of snapshots.formats.rows) {
      console.log(`  format ${f.platform}/${f.format}: ${f.posts} post(s), best ${f.best && f.best.seen}`);
    }
    for (const p of snapshots.posts) {
      console.log(`  post ${p.publishedAt.slice(0, 16)} ${p.title.slice(0, 50)} — ${p.platforms.map((x) => `${x.platform} ${x.views || x.impressions}`).join(', ')}`);
    }
    return;
  }

  const post = (route, body) => call(route, body, { parse: false });

  const m = await post('/metrics', { daily: rows, followers: folk });
  const s = await post('/events', { source: os.hostname(), events: [], snapshots });
  console.log(`shipped ${rows.length} daily row(s), ${folk.length} follower count(s) — ${m.slice(0, 80)}`);
  console.log(`shipped the platform table, the voice and the pace — ${s.slice(0, 80)}`);

  /*
   * Every account can still post — read once an hour, since this job already
   * talks to Zernio. `warning` is routine (tokens refresh lazily); the alert
   * is `needsReconnect` or `error`, which is a token he has to click through
   * a reconnect for, and which otherwise shows up as one platform silently
   * missing from every post until somebody reads the queue table.
   */
  try {
    const { accounts = [] } = cli(['accounts:health']);
    const broken = accounts.filter((a) => a.needsReconnect || a.status === 'error');
    const message = broken.length
      ? `reconnect: ${broken.map((a) => `${a.platform} (${a.displayName || a.username || a.accountId})`).join(', ')}`
      : `${accounts.length} accounts can post`;
    health.ping('accounts', { ok: !broken.length, message });
    if (broken.length) console.error(message);
  } catch (err) {
    health.ping('accounts', { ok: false, message: `accounts:health failed: ${err.message}`.slice(0, 200) });
  }
}

// The pure halves, for the tests; the job itself only runs as a script.
module.exports = { latestPosts, formatOf, ytId };

if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });
