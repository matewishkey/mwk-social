/*
 * Append-only event log — the single source of truth for the dashboard.
 *
 * Every meaningful decision the pipeline makes lands here as one JSON line, and
 * a separate uploader ships them to Cloudflare. Two rules make it safe to put in
 * the hot path of something that posts to the internet:
 *
 *   1. emit() never throws. Telemetry must never cost a post its comment — the
 *      same reasoning as the optional Healthchecks ping it sits next to.
 *   2. One appendFileSync of one line under 8 KB, which is a single atomic
 *      O_APPEND write. Readers that meet a truncated trailing line skip it and
 *      pick it up once the writer has finished.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = process.env.MWK_EVENT_DIR ||
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'mwk-social', 'events');

const MAX_LINE = 8192;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// ULID: millisecond timestamp then randomness, Crockford base32. Lexicographic
// order is chronological order, which is what lets the sink page by id alone.
//
// Monotonic within a millisecond: several events routinely land in the same
// tick, and plain randomness would order them arbitrarily. When the clock has
// not moved we increment the previous random component instead of drawing a new
// one, which is the ULID spec's monotonic variant.
let lastTime = -1;
let lastRand = null;

function ulid(now = Date.now()) {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }

  if (now === lastTime && lastRand) {
    lastRand = lastRand.slice();
    for (let i = lastRand.length - 1; i >= 0; i--) {
      if (lastRand[i] < 31) { lastRand[i]++; break; }
      lastRand[i] = 0;                       // carry
    }
  } else {
    lastRand = Array.from(crypto.randomBytes(16), (b) => b % 32);
    lastTime = now;
  }
  return time + lastRand.map((n) => CROCKFORD[n]).join('');
}

const filePath = (d = new Date()) =>
  path.join(DIR, `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}.ndjson`);

let runId = null;
let source = path.basename(process.argv[1] || 'node');

/** Start a run. Safe to call more than once; the first wins. */
function initRun(opts = {}) {
  if (!runId) {
    runId = ulid();
    if (opts.source) source = opts.source;
    emit('run.started', { message: `${source} started`, data: { argv: process.argv.slice(2) } });
  }
  return runId;
}

function finishRun(counts = {}) {
  emit('run.finished', { message: `${source} finished`, data: counts });
}

/**
 * @param {string} kind    dotted, e.g. "comment.posted"
 * @param {object} fields  message (required), level, clipId, platform, accountId,
 *                         postKey, url, dedupeKey, data
 */
function emit(kind, fields = {}) {
  try {
    const record = {
      id: ulid(),
      dedupe_key: fields.dedupeKey || null,
      ts: new Date().toISOString(),
      run_id: runId,
      source,
      kind,
      level: fields.level || 'info',
      clip_id: fields.clipId || null,
      platform: fields.platform || null,
      account_id: fields.accountId || null,
      post_key: fields.postKey || null,
      url: fields.url || null,
      message: String(fields.message || kind).slice(0, 500),
      data: fields.data === undefined ? null : fields.data,
    };
    let line = JSON.stringify(record);
    if (line.length > MAX_LINE) {                 // truncate the payload, never drop the event
      record.data = { truncated: true };
      line = JSON.stringify(record);
    }
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(filePath(), line.replace(/\n/g, ' ') + '\n');
    return record.id;
  } catch {
    return null;                                  // rule 1
  }
}

/** Read events back, newest last. Skips an unparsable trailing line by design. */
function read({ since = null, limit = Infinity } = {}) {
  const out = [];
  let files;
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.ndjson')).sort(); } catch { return out; }
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (since && rec.ts < since) continue;
      out.push(rec);
    }
  }
  return out.slice(-limit);
}

module.exports = { emit, initRun, finishRun, read, ulid, filePath, DIR };
