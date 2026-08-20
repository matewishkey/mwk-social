#!/usr/bin/env node
/*
 * Mirror new reels from Facebook to the platforms Restream doesn't reach.
 *
 * Restream publishes every new reel to Facebook, LinkedIn, YouTube and Twitch.
 * Instagram, TikTok, Threads and X get nothing unless someone does it by hand —
 * which is what this closes.
 *
 * Read-only until --apply exists. Two modes today:
 *
 *   --plan   what is missing, and when each one would go out. Touches nothing.
 *   --seed   write the ledger from what is already live, so the first real run
 *            starts from today's truth instead of reposting seven weeks of it.
 *
 * The whole design hangs off one incident: on 2026-08-19 a clip went to TikTok
 * twice, once by hand and once from here. lib/matcher.js is the answer to that,
 * and it fails closed — anything it cannot see clearly is not published.
 *
 * Ledger (outside the repo):
 *   ~/.local/state/mwk-social/mirror-ledger.json   (MWK_MIRROR_LEDGER overrides)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { cli } = require('./lib/api');
const platforms = require('./lib/platforms');
const matcher = require('./lib/matcher');
const events = require('./lib/events');

const TARGETS = platforms.MIRROR_TARGETS;
const SOURCE = platforms.SOURCE_PLATFORM;

// Posting window and pace. The owner asked for "a few a day, spread over days";
// these are the knobs that means.
const DEFAULTS = { perDay: 3, startHour: 9, endHour: 21, minGapMinutes: 90 };

function ledgerPath() {
  return process.env.MWK_MIRROR_LEDGER ||
    path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
      'mwk-social', 'mirror-ledger.json');
}

const loadLedger = () => {
  try { return JSON.parse(fs.readFileSync(ledgerPath(), 'utf8')); } catch { return { version: 1, clips: {} }; }
};

function saveLedger(ledger) {
  const p = ledgerPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(ledger, null, 2) + '\n');
}

function parseArgs(argv) {
  const opts = { mode: null, days: 7, perDay: DEFAULTS.perDay, json: false, dryRun: false, limit: 100 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plan') opts.mode = 'plan';
    else if (a === '--seed') opts.mode = 'seed';
    else if (a === '--json') opts.json = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--days') opts.days = Number(argv[++i]);
    else if (a === '--per-day') opts.perDay = Number(argv[++i]);
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else { console.error(`unknown option: ${a}`); usage(); process.exit(2); }
  }
  if (!opts.mode) { usage(); process.exit(2); }
  if (!Number.isFinite(opts.perDay) || opts.perDay < 1) { console.error('--per-day must be >= 1'); process.exit(2); }
  return opts;
}

function usage() {
  console.log('usage: mirror.js --plan [--days N] [--per-day N] [--json]');
  console.log('       mirror.js --seed [--dry-run]');
  console.log('');
  console.log('  --plan   show what is missing on each platform and when it would go out');
  console.log('  --seed   record what is already live, so nothing already posted is posted again');
}

// posts:list carries a pipeline post the instant it publishes; analytics:posts
// lags minutes behind but is the only place a post made in the apps ever shows
// up. Neither is complete on its own.
function fetchUniverse(limit) {
  const rows = [];
  const seen = new Set();
  const errors = {};

  const take = (res) => {
    for (const post of res.posts || []) {
      for (const pf of post.platforms || []) {
        if (pf.status !== 'published' || !pf.platformPostId) continue;
        const key = `${pf.platform}:${pf.platformPostId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const video = (post.mediaItems || []).find((m) => m && m.type === 'video');
        const accountId = typeof pf.accountId === 'object' && pf.accountId ? pf.accountId._id : pf.accountId;
        rows.push({
          key,
          platform: pf.platform,
          platformPostId: pf.platformPostId,
          accountId,
          publishedAt: pf.publishedAt || post.publishedAt || post.scheduledFor || null,
          content: post.content || '',
          url: pf.platformPostUrl || post.platformPostUrl || '',
          mediaType: post.mediaType || (video ? 'video' : null),
          mediaUrl: (video && video.url) || null,
          // Instagram alone reports this, and not on every post.
          durationSec: (pf.analytics && pf.analytics.videoDurationSeconds) ||
                       (post.analytics && post.analytics.videoDurationSeconds) || null,
        });
      }
    }
  };

  try { take(cli(['posts:list', '--status', 'published', '--limit', String(limit)])); }
  catch (err) { for (const p of [SOURCE, ...TARGETS]) errors[p] = err.message; }

  for (const platform of [SOURCE, ...TARGETS]) {
    try { take(cli(['analytics:posts', '--platform', platform, '--limit', String(limit)])); }
    catch (err) { errors[platform] = err.message; }
  }

  // A reel is a Facebook video post. Image and text posts on the page are not
  // reels and are not mirrored.
  const sources = rows
    .filter((r) => r.platform === SOURCE && r.mediaType === 'video')
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));

  const index = {};
  for (const platform of TARGETS) index[platform] = rows.filter((r) => r.platform === platform);

  return { rows, sources, index, errors };
}

/** Classify every clip against every target. Pure once the universe is fetched. */
function assess(universe, ledger) {
  return universe.sources.map((source) => {
    const clipId = `${SOURCE}:${source.platformPostId}`;
    const recorded = (ledger.clips[clipId] || {}).targets || {};
    const targets = {};
    for (const platform of TARGETS) {
      const live = matcher.classify(source, universe.index[platform], {
        platform,
        indexError: universe.errors[platform],
      });
      // The ledger is the second half of the evidence, and the only half that
      // covers a platform we cannot enumerate. Whichever says "already there"
      // wins — the two can only ever disagree in the safe direction.
      const known = recorded[platform];
      const settled = known && (known.status === 'posted' || known.status === 'skipped');
      targets[platform] = {
        verdict: settled ? 'duplicate' : live.verdict,
        confidence: settled ? 'ledger' : live.confidence,
        score: live.score,
        signals: live.signals,
        reason: settled ? (known.note || 'recorded in the ledger') : live.reason,
        evidence: (live.match && live.match.platformPostId) || (known && known.evidence) || null,
        url: (live.match && live.match.url) || (known && known.url) || null,
      };
    }
    return { clipId, source, targets };
  });
}

/*
 * Slot the missing posts into the next few days.
 *
 * Newest clip first, and within a clip in reversibility order: Threads, X and
 * TikTok can all be deleted if a caption comes out wrong, Instagram cannot. So
 * Instagram is only ever attempted on a clip whose other three have already
 * gone out cleanly.
 */
function schedule(assessment, opts, from = new Date()) {
  const queue = [];
  for (const clip of assessment) {
    for (const platform of TARGETS) {
      if (clip.targets[platform].verdict === 'none') {
        queue.push({ clipId: clip.clipId, platform, source: clip.source });
      }
    }
  }

  const slots = [];
  const span = DEFAULTS.endHour - DEFAULTS.startHour;
  const step = opts.perDay > 1 ? span / (opts.perDay - 1) : 0;
  for (let day = 0; slots.length < queue.length && day < opts.days; day++) {
    for (let i = 0; i < opts.perDay && slots.length < queue.length; i++) {
      const at = new Date(from);
      at.setDate(at.getDate() + day + 1);           // start tomorrow, never mid-run
      at.setHours(DEFAULTS.startHour + Math.round(step * i), 0, 0, 0);
      slots.push(at);
    }
  }

  return queue.map((item, i) => ({ ...item, at: slots[i] ? slots[i].toISOString() : null }));
}

const VERDICT_MARK = { duplicate: '·', none: 'x', review: '?', unknown: '?' };

function printPlan(assessment, plan, universe, opts) {
  // Emoji are two terminal columns wide and slicing one in half prints a
  // replacement character, so the table drops them. Display only — the matcher
  // works on the full caption.
  const label = (s) => (s.content
    .replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, '')
    .replace(/\s+/g, ' ').trim().slice(0, 42) || '(no caption)');

  console.log(`${universe.sources.length} reel(s) on ${SOURCE}, mirroring to ${TARGETS.join(', ')}`);
  for (const [p, msg] of Object.entries(universe.errors)) {
    console.log(`  ! ${p} could not be read (${msg}) — nothing will be published there`);
  }
  console.log('');
  console.log(`  ${'clip'.padEnd(44)} ${TARGETS.map((t) => t.slice(0, 9).padEnd(9)).join(' ')}`);
  for (const clip of assessment) {
    const cells = TARGETS.map((t) => {
      const v = clip.targets[t];
      const mark = VERDICT_MARK[v.verdict];
      return `${mark} ${v.verdict.slice(0, 7)}`.padEnd(9);
    });
    console.log(`  ${label(clip.source).padEnd(44)} ${cells.join(' ')}`);
  }
  console.log('');
  console.log('  · already there    x missing    ? not published — needs a look');

  const stuck = [];
  for (const clip of assessment) {
    for (const t of TARGETS) {
      const v = clip.targets[t];
      if (v.verdict === 'review' || v.verdict === 'unknown') {
        stuck.push(`  ${t.padEnd(10)} ${label(clip.source)} — ${v.reason}`);
      }
    }
  }
  if (stuck.length) {
    console.log('');
    console.log(`held back (${stuck.length}):`);
    console.log([...new Set(stuck)].join('\n'));
  }

  console.log('');
  if (!plan.length) {
    console.log('nothing to mirror — every reel is on every platform');
    return;
  }
  const clips = new Set(plan.map((p) => p.clipId));
  console.log(`${plan.length} post(s) across ${clips.size} clip(s), ${opts.perDay}/day from tomorrow:`);
  let lastDay = '';
  for (const item of plan) {
    if (!item.at) { console.log(`  (past --days ${opts.days})  ${item.platform.padEnd(10)} ${label(item.source)}`); continue; }
    const day = item.at.slice(0, 10);
    if (day !== lastDay) { console.log(`  ${day}`); lastDay = day; }
    const weak = assessment.find((c) => c.clipId === item.clipId).targets[item.platform].confidence === 'weak';
    console.log(`    ${item.at.slice(11, 16)}  ${item.platform.padEnd(10)} ${label(item.source)}${weak ? '   (unverifiable — ledger only)' : ''}`);
  }
}

/*
 * Seeding is what stops the first real run reposting seven weeks of history. It
 * writes down what the matcher can already see, so "already there" survives a
 * platform later becoming unreadable — and so Threads, which can never be
 * enumerated, has a record at all.
 */
function seed(assessment, ledger, opts) {
  const stamp = new Date().toISOString();
  let posted = 0; let pending = 0; let blocked = 0;

  for (const clip of assessment) {
    const entry = ledger.clips[clip.clipId] || {
      publishedAt: clip.source.publishedAt,
      url: clip.source.url,
      caption: clip.source.content.replace(/\s+/g, ' ').trim().slice(0, 120),
      targets: {},
    };
    for (const platform of TARGETS) {
      const v = clip.targets[platform];
      const already = entry.targets[platform];
      if (already && already.status !== 'pending') continue;   // never overwrite a real outcome

      if (v.verdict === 'duplicate') {
        entry.targets[platform] = { status: 'posted', at: null, seededAt: stamp,
          note: 'already live before the mirror ran', evidence: v.evidence, url: v.url };
        posted++;
      } else if (v.verdict === 'none') {
        entry.targets[platform] = { status: 'pending', seededAt: stamp, confidence: v.confidence };
        pending++;
      } else {
        entry.targets[platform] = { status: 'blocked', seededAt: stamp, note: v.reason };
        blocked++;
      }
    }
    ledger.clips[clip.clipId] = entry;
  }

  console.log(`${posted} already live, ${pending} queued, ${blocked} held back`);
  if (opts.dryRun) {
    console.log(`dry run — ${ledgerPath()} not written`);
    return;
  }
  saveLedger(ledger);
  console.log(`wrote ${ledgerPath()}`);
  events.emit('mirror.seeded', { message: `seeded ${posted} posted, ${pending} pending, ${blocked} blocked`,
    data: { posted, pending, blocked } });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  events.initRun({ source: 'mirror' });

  const universe = fetchUniverse(opts.limit);
  const ledger = loadLedger();
  const assessment = assess(universe, ledger);
  const plan = schedule(assessment, opts);

  if (opts.json) {
    console.log(JSON.stringify({ assessment, plan, errors: universe.errors }, null, 2));
  } else if (opts.mode === 'plan') {
    printPlan(assessment, plan, universe, opts);
  }
  if (opts.mode === 'seed') seed(assessment, ledger, opts);

  events.finishRun({ reels: universe.sources.length, queued: plan.length });
}

if (require.main === module) main();

module.exports = { assess, schedule, fetchUniverse, loadLedger, ledgerPath, DEFAULTS };
