#!/usr/bin/env node
/*
 * Ship the local event log to the Cloudflare dashboard.
 *
 * Runs every two minutes. Two rules make it safe to leave unattended:
 *
 *   1. The cursor advances only on a 2xx. Anything else — a 500, a timeout, the
 *      box offline — leaves it where it was and the same events go again next
 *      run. Duplicates cost nothing: the sink is INSERT OR IGNORE on a stable
 *      ULID, so a replayed batch is free.
 *   2. It sends an EMPTY batch when there is nothing to say, at least every 15
 *      minutes. Without that heartbeat "nothing happened" and "the box is off"
 *      are the same picture on the dashboard, which is the one thing a status
 *      page must never do.
 *
 *
 * Usage:
 *   scripts/ship-events.js
 *   scripts/ship-events.js --dry-run
 *   scripts/ship-events.js --all        # ignore the cursor, ship everything
 *
 * Config comes from the environment (td-sops apps/mwk-social.enc.env):
 *   MWK_LOG_URL     https://ingest.matewishkey.com/events
 *   MWK_LOG_TOKEN   bearer token
 */
'use strict';

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

// This box has no IPv6 route and both dashboard hostnames resolve AAAA-first,
// so undici's default 250 ms Happy Eyeballs window expires before it falls back
// to IPv4 and every request fails as ETIMEDOUT. Widening the window is the fix;
// see docs/playbook.md, where the same thing bit the media downloads.
net.setDefaultAutoSelectFamilyAttemptTimeout(1000);

const events = require('./lib/events');

const HEARTBEAT_MS = 15 * 60 * 1000;
const BATCH = 500;

const statePath = () => process.env.MWK_SHIP_CURSOR ||
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'mwk-social', 'ship-cursor.json');

const load = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};

function save(cursor) {
  const p = statePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cursor, null, 2) + '\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const all = argv.includes('--all');

  const url = process.env.MWK_LOG_URL;
  const token = process.env.MWK_LOG_TOKEN;
  if (!url || !token) {
    console.error('MWK_LOG_URL and MWK_LOG_TOKEN must be set (td-sops apps/mwk-social.enc.env)');
    process.exit(2);
  }

  const cursor = load(statePath(), { lastId: null, lastSentAt: null });
  const since = all ? null : cursor.lastId;

  // ULIDs sort chronologically, which is the whole reason the log uses them:
  // "everything after the last one I shipped" is a string comparison.
  const pending = events.read().filter((e) => !since || e.id > since).slice(0, BATCH);

  const quietFor = cursor.lastSentAt ? Date.now() - Date.parse(cursor.lastSentAt) : Infinity;
  if (!pending.length && quietFor < HEARTBEAT_MS) {
    console.log(`nothing new, and the last heartbeat was ${Math.round(quietFor / 60000)} min ago`);
    return;
  }

  const body = { source: os.hostname(), events: pending, snapshots: {} };

  if (dryRun) {
    console.log(`would ship ${pending.length} event(s) to ${url}`);
    if (pending.length) console.log(`  ${pending[0].id} … ${pending[pending.length - 1].id}`);
    return;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) {
    // Cursor untouched on purpose. The next run re-sends, and the sink ignores
    // anything it already has.
    console.error(`ingest returned ${res.status}: ${text.slice(0, 200)}`);
    process.exit(1);
  }

  save({
    lastId: pending.length ? pending[pending.length - 1].id : cursor.lastId,
    lastSentAt: new Date().toISOString(),
  });
  console.log(`shipped ${pending.length} event(s) — ${text.slice(0, 120)}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
