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
 *   2. It sends an EMPTY batch when there is nothing to say, at least every 10
 *      minutes. Without that heartbeat "nothing happened" and "the box is off"
 *      are the same picture on the dashboard, which is the one thing a status
 *      page must never do.
 *
 *      TEN, not fifteen. The dashboard calls the box stale at fifteen
 *      (HEARTBEAT_STALE_MS in web/src/pages/overview.js), and this used to
 *      write at fifteen as well — so on a quiet box the beat always landed
 *      just AFTER the page had already given up on it, and the tile flickered
 *      red for a minute or two every quarter hour on a perfectly healthy box.
 *      The writer's period has to be comfortably under the reader's patience.
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

const fs = require('fs');
const os = require('os');
const path = require('path');

const events = require('./lib/events');
const health = require('./lib/health');
const { endpoint, call } = require('./lib/dashboard');
const { flags } = require('./lib/args');

const HEARTBEAT_MS = 10 * 60 * 1000;   // under the dashboard's 15-min stale mark, on purpose
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
  const { dryRun, all } = flags(process.argv.slice(2), {
    '--dry-run': { key: 'dryRun' }, '--all': { key: 'all' },
  });
  const { url } = endpoint();

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

  let text;
  try {
    text = await call(url, body, { parse: false });
  } catch (err) {
    // Cursor untouched on purpose. The next run re-sends, and the sink ignores
    // anything it already has.
    console.error(`ingest failed: ${err.message}`);
    process.exit(1);
  }

  save({
    lastId: pending.length ? pending[pending.length - 1].id : cursor.lastId,
    lastSentAt: new Date().toISOString(),
  });
  // The dead-man heartbeat: this runs every two minutes and sends an empty
  // batch when idle, so its silence means the box, not the pipeline, is off.
  health.ping('heartbeat', { message: `shipped ${pending.length}` });
  console.log(`shipped ${pending.length} event(s) — ${text.slice(0, 120)}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
