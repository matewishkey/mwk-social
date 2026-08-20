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
 *   --media  fetch and probe every reel's video, and say whether each target
 *            platform would accept it. Downloads, publishes nothing.
 *   --seed   write the ledger from what is already live, so the first real run
 *            starts from today's truth instead of reposting seven weeks of it.
 *   --apply  actually publish. One at a time by default, and it re-checks
 *            every clip against the live platform immediately before posting.
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

const { api, cli } = require('./lib/api');
const platforms = require('./lib/platforms');
const matcher = require('./lib/matcher');
const media = require('./lib/media');
const captions = require('./lib/captions');
const voice = require('./lib/voice');
const { topicsFor } = require('./lib/topic-tags');
const events = require('./lib/events');

const TARGETS = platforms.MIRROR_TARGETS;
const SOURCE = platforms.SOURCE_PLATFORM;

// YouTube is neither source nor target — Restream already posts there — but it
// is read anyway, because it is the standing copy of every clip and therefore
// the fallback when Facebook's signed URL has expired.
const FALLBACK = 'youtube';
const READ = [SOURCE, ...TARGETS, FALLBACK];

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
  // --apply defaults to a single post. Publishing is the one thing here that
  // cannot be undone on every platform, so more than one has to be asked for.
  const opts = { mode: null, days: 7, perDay: DEFAULTS.perDay, json: false, dryRun: false,
    limit: 100, apply: 1, platforms: TARGETS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plan') opts.mode = 'plan';
    else if (a === '--seed') opts.mode = 'seed';
    else if (a === '--media') opts.mode = 'media';
    else if (a === '--apply') opts.mode = 'apply';
    else if (a === '--platforms') opts.platforms = argv[++i].split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--json') opts.json = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--days') opts.days = Number(argv[++i]);
    else if (a === '--per-day') opts.perDay = Number(argv[++i]);
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--count') opts.apply = Number(argv[++i]);
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else { console.error(`unknown option: ${a}`); usage(); process.exit(2); }
  }
  if (!opts.mode) { usage(); process.exit(2); }
  if (!Number.isFinite(opts.perDay) || opts.perDay < 1) { console.error('--per-day must be >= 1'); process.exit(2); }
  const bad = opts.platforms.filter((p) => !TARGETS.includes(p));
  if (bad.length) { console.error(`not a mirror target: ${bad.join(', ')} (have: ${TARGETS.join(', ')})`); process.exit(2); }
  return opts;
}

function usage() {
  console.log('usage: mirror.js --plan [--days N] [--per-day N] [--json]');
  console.log('       mirror.js --media');
  console.log('       mirror.js --seed [--dry-run]');
  console.log('       mirror.js --apply [--platforms p1,p2] [--count N] [--dry-run]');
  console.log('');
  console.log('  --plan   show what is missing on each platform and when it would go out');
  console.log('  --media  fetch and probe each reel, and check it against every target');
  console.log('  --seed   record what is already live, so nothing already posted is posted again');
  console.log('  --apply  publish the next N missing posts (default 1)');
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
  catch (err) { for (const p of READ) errors[p] = err.message; }

  for (const platform of READ) {
    try { take(cli(['analytics:posts', '--platform', platform, '--limit', String(limit)])); }
    catch (err) { errors[platform] = err.message; }
  }

  // A reel is a Facebook video post. Image and text posts on the page are not
  // reels and are not mirrored.
  const sources = rows
    .filter((r) => r.platform === SOURCE && r.mediaType === 'video')
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));

  const index = {};
  for (const platform of [...TARGETS, FALLBACK]) index[platform] = rows.filter((r) => r.platform === platform);

  return { rows, sources, index, errors };
}

/**
 * The YouTube copy of a reel, for when Facebook's signed URL has expired.
 * Same matcher as the dedupe, so "this is the same clip" means one thing here.
 */
function youtubeIdFor(source, universe) {
  const v = matcher.classify(source, universe.index[FALLBACK] || [], {
    platform: FALLBACK,
    indexError: universe.errors[FALLBACK],
  });
  return v.verdict === 'duplicate' ? v.match.platformPostId : null;
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
      // Never overwrite a settled outcome — but `failed` and `inflight` are not
      // outcomes, they are unfinished business. A publish whose call timed out
      // while the post went out regardless lands exactly there, and seeding is
      // where the live platform gets to correct the record.
      const unsettled = !already || ['pending', 'failed', 'inflight'].includes(already.status);
      if (!unsettled) continue;
      if (already && already.status !== 'pending' && v.verdict !== 'duplicate') continue;

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

/*
 * Fetch every reel and say whether each target would take it. Read-only in the
 * sense that matters — it publishes nothing — but it does download, which is
 * the point: the media has to be in hand before a publish, not at the moment of
 * one, because by then the signed URL may already be dead.
 */
function reportMedia(assessment, universe) {
  let ok = 0; let failed = 0;
  for (const clip of assessment) {
    const label = clip.source.content.replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 42);
    const youtubeId = youtubeIdFor(clip.source, universe);
    let got;
    try {
      got = media.resolve(clip.clipId, { url: clip.source.mediaUrl, youtubeId });
    } catch (err) {
      failed++;
      events.emit('media.failed', { message: err.message, level: 'error', clipId: clip.clipId });
      console.log(`  FAIL  ${label}`);
      console.log(`        ${err.message}${youtubeId ? '' : ' (no YouTube copy found either)'}`);
      continue;
    }
    ok++;
    const p = got.probe;
    const mb = (p.bytes / 1048576).toFixed(1);
    console.log(`  ok    ${label}`);
    console.log(`        via ${got.via.padEnd(8)} ${p.width}x${p.height} (${p.aspect})  ${p.durationSec}s  ${mb} MB  ${p.codec}${p.hasAudio ? '' : '  NO AUDIO'}`);
    for (const platform of TARGETS) {
      const problems = media.check(platform, p);
      if (problems.length) console.log(`        ${platform}: ${problems.join('; ')}`);
    }
    events.emit('media.resolved', { message: `${got.via}: ${p.width}x${p.height} ${p.durationSec}s`,
      clipId: clip.clipId, dedupeKey: `media.resolved|${clip.clipId}`,
      data: { via: got.via, ...p, youtubeId } });
  }
  console.log('');
  console.log(`${ok} resolved, ${failed} could not be`);
  console.log(`cached in ${media.CACHE}`);
}

/*
 * TikTok's settings are the one genuine special case in the API: they go in
 * `tiktokSettings` at the TOP LEVEL of the request, not in platformSpecificData
 * (docs.zernio.com/platforms/tiktok says so outright). That matters more than it
 * sounds — platformSpecificData silently stores any key you send it, so putting
 * them there would echo back in the response and look accepted while the post
 * went out with none of them applied.
 *
 * All six flags are `required: true` with `default: false` in creator-info, so
 * every one is stated here rather than left to a default.
 */
const TIKTOK_SETTINGS = {
  privacy_level: 'PUBLIC_TO_EVERYONE',
  allow_comment: true,
  allow_duet: true,
  allow_stitch: true,
  content_preview_confirmed: true,
  express_consent_given: true,
  commercialContentType: 'none',
  video_made_with_ai: false,
};

/*
 * Account IDs are resolved live from accounts:list rather than kept in a config
 * file — this repo is public, and an ID that lives in exactly one place cannot
 * go stale. An ambiguous platform is an error, not a guess.
 */
function accountsByPlatform() {
  const all = cli(['accounts:list']).accounts || [];
  const out = {};
  for (const a of all.filter((x) => x.isActive !== false)) {
    (out[a.platform] ||= []).push({ id: a._id || a.id, name: a.username || a.name || '' });
  }
  return out;
}

function accountFor(byPlatform, platform) {
  const found = byPlatform[platform] || [];
  if (!found.length) throw new Error(`no active ${platform} account is connected`);
  if (found.length > 1) {
    throw new Error(`${found.length} ${platform} accounts connected (${found.map((a) => a.name).join(', ')}) — ambiguous, refusing to guess`);
  }
  return found[0];
}

/*
 * The tags describing this clip, from the transcript work the comment watcher
 * already paid for. Same clip, same subjects — transcribing it a second time
 * would cost money to learn what is already on disk.
 */
async function topicTagsFor(youtubeId) {
  if (!youtubeId) return [];
  try {
    const topics = await topicsFor(`youtube:${youtubeId}`, {});
    return (topics && topics.tags) || [];
  } catch {
    return [];
  }
}

// "Not yet" is not "broken". A clip waiting its turn behind the deletable
// platforms must stay `pending` — recording it as `failed` would read as a
// defect in the next --plan and in the dashboard.
class NotYet extends Error {}

function setTarget(ledger, clipId, platform, value) {
  const clip = ledger.clips[clipId] ||= { targets: {} };
  clip.targets[platform] = { ...(clip.targets[platform] || {}), ...value };
  saveLedger(ledger);
}

/** Publish one clip to one platform. Everything that can go wrong is checked first. */
async function publishOne(item, clip, universe, ledger, byPlatform, opts) {
  const { platform, clipId } = item;
  const cfg = platforms.get(platform);
  const account = accountFor(byPlatform, platform);

  // Last look before anything irreversible. The index was read at the top of
  // this run, minutes ago at most, and the verdict is re-read rather than
  // remembered — the plan and the publish must not be able to disagree.
  const verdict = clip.targets[platform];
  if (verdict.verdict !== 'none') throw new Error(`verdict is ${verdict.verdict}, not publishable`);

  // Instagram is the only platform nothing can delete or edit, so it is never
  // the first attempt on a clip: the deletable ones prove the media and the
  // caption first. The schedule already orders it last — this makes it a rule
  // rather than a consequence of the ordering, because a --platforms run skips
  // straight past that ordering.
  if (!cfg.deletable) {
    const unproven = TARGETS.filter((t) => t !== platform && clip.targets[t].verdict === 'none');
    if (unproven.length) {
      throw new NotYet(`${unproven.join(', ')} not done on this clip yet — ${platform} cannot be undone, so it goes last`);
    }
  }

  const youtubeId = youtubeIdFor(clip.source, universe);
  const got = media.resolve(clipId, { url: clip.source.mediaUrl, youtubeId });
  const problems = media.check(platform, got.probe);
  if (problems.length) throw new Error(`media unsuitable: ${problems.join('; ')}`);

  if (platform === 'tiktok') {
    const info = cli(['accounts:tiktok-creator-info', account.id, '--mediaType', 'video']);
    if (!info.creator || info.creator.canPostMore !== true) throw new Error('TikTok says canPostMore is false — daily cap reached');
    const max = info.postingLimits && info.postingLimits.maxVideoDurationSec;
    if (max && got.probe.durationSec > max) throw new Error(`${got.probe.durationSec}s over TikTok's live limit of ${max}s`);
  }

  const parsed = captions.parseSource(clip.source.content);
  const topicTags = await topicTagsFor(youtubeId);
  const { text, warnings } = captions.compose(platform, {
    body: parsed.body, sourceTags: parsed.hashtags, topicTags,
  });
  for (const w of warnings) console.log(`      note: ${w}`);

  const body = { content: text, publishNow: true };
  const entry = { platform, accountId: account.id };
  if (cfg.supportsFirstComment) {
    entry.platformSpecificData = {
      firstComment: voice.firstComment(`${clipId}:${platform}`, {
        platform, topicTags, avoidIndex: ledger.__lastVariant?.[platform] ?? -1,
      }).text,
    };
  }
  body.platforms = [entry];
  if (platform === 'tiktok') body.tiktokSettings = TIKTOK_SETTINGS;

  console.log(`      caption: ${text.replace(/\n+/g, ' | ').slice(0, 160)}`);
  if (entry.platformSpecificData) {
    console.log(`      comment: ${entry.platformSpecificData.firstComment.replace(/\n+/g, ' | ').slice(0, 160)}`);
  }
  console.log(`      media:   ${got.via} ${got.probe.width}x${got.probe.height} ${got.probe.durationSec}s`);

  if (opts.dryRun) { console.log('      DRY RUN — nothing posted'); return null; }

  // Uploaded only now, after every check has passed: an upload is the first
  // thing in this sequence that leaves a trace on Zernio's side.
  const uploaded = cli(['media:upload', got.path]);
  if (!uploaded.url) throw new Error('media:upload returned no url');
  body.mediaItems = [{ type: 'video', url: uploaded.url }];

  // Written BEFORE the request, never after. A process killed between the POST
  // and its response must not look like "never posted" on the next run.
  setTarget(ledger, clipId, platform, { status: 'inflight', at: new Date().toISOString(), accountId: account.id });

  // A timeout here means UNKNOWN, not failed. Zernio carries on processing after
  // our request gives up, and the very first live mirror proved it: the call
  // timed out at 60s and the post was live on Threads regardless. Recording that
  // as a failure would have left a real post with the ledger denying it.
  let post;
  try {
    ({ post } = await api('POST', '/posts', { body, timeout: 240000 }));
  } catch (err) {
    const landed = await findPublished(platform, text);
    if (!landed) throw err;
    console.log(`      (the publish call gave up — ${err.message} — but the post landed)`);
    return landed;
  }

  const results = await waitFor(post._id);
  const result = results.find((r) => r.platform === platform) || {};
  if (result.status !== 'published') {
    const landed = await findPublished(platform, text);
    if (landed) return landed;
    throw new Error(result.errorMessage || `finished as ${result.status || 'unknown'}`);
  }
  return { zernioId: post._id, url: result.platformPostUrl || '', platformPostId: result.platformPostId || null };
}

/**
 * Did the thing we just tried to post actually go out? Asked by exact caption,
 * which we control — we composed it ourselves seconds ago.
 */
async function findPublished(platform, text) {
  const key = captions.normalizeKey(text, 64);
  let res;
  try { res = cli(['posts:list', '--status', 'published', '--limit', '10']); } catch { return null; }
  for (const post of res.posts || []) {
    for (const pf of post.platforms || []) {
      if (pf.platform !== platform || pf.status !== 'published') continue;
      if (captions.normalizeKey(post.content || '', 64) !== key) continue;
      return { zernioId: post._id, url: pf.platformPostUrl || '', platformPostId: pf.platformPostId || null };
    }
  }
  return null;
}

async function waitFor(postId) {
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    let post;
    try { ({ post } = await api('GET', `/posts/${postId}`)); } catch { continue; }
    const list = post.platforms || [];
    if (list.every((p) => p.status === 'published' || p.status === 'failed')) return list;
  }
  return [];
}

async function applyAll(assessment, plan, universe, ledger, opts) {
  const byPlatform = accountsByPlatform();
  const queue = plan.filter((p) => opts.platforms.includes(p.platform)).slice(0, opts.apply);

  if (!queue.length) {
    console.log(`nothing queued for ${opts.platforms.join(', ')}`);
    return;
  }
  console.log(`${queue.length} to publish${opts.dryRun ? ' (dry run)' : ''}, of ${plan.length} queued overall`);

  let done = 0; let failed = 0;
  if (opts.dryRun) console.log('(dry run — the ledger is not written)');
  for (const item of queue) {
    const clip = assessment.find((c) => c.clipId === item.clipId);
    const label = clip.source.content.replace(/\s+/g, ' ').slice(0, 40);
    console.log(`\n  ${item.platform} ← ${label}`);
    try {
      const posted = await publishOne(item, clip, universe, ledger, byPlatform, opts);
      if (!posted) continue;                     // dry run
      setTarget(ledger, item.clipId, item.platform, {
        status: 'posted', at: new Date().toISOString(), note: 'mirrored',
        evidence: posted.platformPostId, url: posted.url, zernioId: posted.zernioId,
      });
      done++;
      events.emit('mirror.posted', { message: `mirrored to ${item.platform}`, platform: item.platform,
        clipId: item.clipId, url: posted.url, dedupeKey: `mirror.posted|${item.clipId}|${item.platform}`,
        data: { zernioId: posted.zernioId } });
      console.log(`      posted: ${posted.url}`);
    } catch (err) {
      if (err instanceof NotYet) {
        console.log(`      held: ${err.message}`);
        continue;                                // stays pending, nothing recorded
      }
      failed++;
      // A dry run must leave no trace, including of its own failures.
      if (!opts.dryRun) {
        setTarget(ledger, item.clipId, item.platform, {
          status: 'failed', at: new Date().toISOString(), note: err.message,
        });
        events.emit('mirror.failed', { message: err.message, level: 'error', platform: item.platform,
          clipId: item.clipId, dedupeKey: `mirror.failed|${item.clipId}|${item.platform}` });
      }
      console.log(`      FAILED: ${err.message}`);
    }
  }
  console.log(`\n${done} posted, ${failed} failed`);
}

async function main() {
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
  if (opts.mode === 'media') reportMedia(assessment, universe);
  if (opts.mode === 'apply') await applyAll(assessment, plan, universe, ledger, opts);

  events.finishRun({ reels: universe.sources.length, queued: plan.length });
}

if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });

module.exports = { assess, schedule, fetchUniverse, youtubeIdFor, loadLedger, ledgerPath, DEFAULTS };
