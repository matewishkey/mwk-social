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
  const snapshots = {
    platforms: platformSnapshot(),
    voice: voiceSnapshot(),
    pace: pace.status(events.read()),
  };

  if (dryRun) {
    console.log(`would ship ${rows.length} daily row(s) and ${folk.length} follower count(s) to ${origin}`);
    console.log(`  pace: ${snapshots.pace.today}/${snapshots.pace.perDay} today, next ${snapshots.pace.nextAt || '—'}`);
    console.log(`  blurb chosen: ${snapshots.voice && snapshots.voice.blurbChosen}`);
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

main().catch((err) => { console.error(err.message); process.exit(1); });
