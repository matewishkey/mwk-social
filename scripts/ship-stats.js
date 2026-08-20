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

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

// No IPv6 route on this box and the dashboard hostnames resolve AAAA-first, so
// undici's 250 ms Happy Eyeballs window expires before it falls back to IPv4.
net.setDefaultAutoSelectFamilyAttemptTimeout(1000);

const { cli } = require('./lib/api');
const platforms = require('./lib/platforms');
const pace = require('./lib/pace');
const voice = require('./lib/voice');
const events = require('./lib/events');

const DEFAULT_DAYS = 45;

const ledgerPath = () => process.env.MWK_MIRROR_LEDGER ||
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'mwk-social', 'mirror-ledger.json');

const load = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};

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
  return { flows: platforms.flows(), mirrorTargets: platforms.MIRROR_TARGETS,
    source: platforms.SOURCE_PLATFORM };
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
    episodeMixRatio: cfg.firstComment.episodeMixRatio,
    // The blurb goes at the bottom of every YouTube description. While it is
    // still a paraphrase rather than his own words, auto-fill stays paused —
    // the page reads this flag and says so out loud.
    blurbChosen: !/PENDING/.test(cfg.youtubeDescription._showBlurb || ''),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const days = Number(argv[argv.indexOf('--days') + 1]) || DEFAULT_DAYS;

  const base = process.env.MWK_LOG_URL;
  const token = process.env.MWK_LOG_TOKEN;
  if (!base || !token) {
    console.error('MWK_LOG_URL and MWK_LOG_TOKEN must be set (td-sops apps/mwk-social.enc.env)');
    process.exit(2);
  }
  const origin = new URL(base).origin;

  const [rows, folk] = await Promise.all([daily(days), followers()]);
  const ledger = load(ledgerPath(), {});
  const snapshots = {
    platforms: platformSnapshot(),
    voice: voiceSnapshot(),
    pace: pace.status(ledger, {}, new Date(), events.read()),
  };

  if (dryRun) {
    console.log(`would ship ${rows.length} daily row(s) and ${folk.length} follower count(s) to ${origin}`);
    console.log(`  pace: ${snapshots.pace.today}/${snapshots.pace.perDay} today, next ${snapshots.pace.nextAt || '—'}`);
    console.log(`  blurb chosen: ${snapshots.voice && snapshots.voice.blurbChosen}`);
    return;
  }

  const post = async (path_, body) => {
    const res = await fetch(`${origin}${path_}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${path_} → ${res.status}: ${text.slice(0, 200)}`);
    return text;
  };

  const m = await post('/metrics', { daily: rows, followers: folk });
  const s = await post('/events', { source: os.hostname(), events: [], snapshots });
  console.log(`shipped ${rows.length} daily row(s), ${folk.length} follower count(s) — ${m.slice(0, 80)}`);
  console.log(`shipped the platform table, the voice and the pace — ${s.slice(0, 80)}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
