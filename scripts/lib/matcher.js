/*
 * "Is this clip already on that platform?" — the question the mirror must get
 * right before every publish.
 *
 * It exists because of one incident: on 2026-08-19 a clip went to TikTok twice,
 * once by hand at 10:59 and once from here at 20:29. Instagram cannot be deleted
 * through any API, so the same mistake there would be permanent. Every choice
 * below is shaped by that asymmetry — a false duplicate costs one missed mirror,
 * visible in the next --plan; a false new costs a post that cannot be taken back.
 *
 * WHAT WE ACTUALLY HAVE TO WORK WITH
 *
 * Measured across the whole corpus (58 posts, 7 platforms):
 *   - the caption survives copying between platforms verbatim, every time;
 *   - videoDurationSeconds is populated on Instagram alone, and only on 3 of 9;
 *   - TikTok and X report url:null / platform_withheld, so no byte or duration
 *     comparison is possible there at all.
 *
 * So the caption is not one signal among several — it is the only cross-platform
 * signal that exists. It scores decisively on its own, and the rest of the table
 * is corroboration and contradiction around it. Building a balanced multi-signal
 * score out of fields that are mostly null would look rigorous and be theatre.
 */
'use strict';

const { normalizeKey, prefixMatch } = require('./captions');
const platforms = require('./platforms');

// A caption shorter than this normalises to something too generic to match on —
// "Do not try at work:)" is 14 characters and would collide with anything.
const MIN_KEY_CHARS = 32;
const KEY_CHARS = 64;

const NEAR_MS = 6 * 3600 * 1000;
const LATE_MS = 21 * 24 * 3600 * 1000;

const WEIGHTS = {
  caption: 0.80,           // decisive alone
  timeNear: 0.15,          // within 6h either way: same clip going out everywhere
  timeLate: 0.05,          // up to 21d after: a legitimate late mirror
  timeStale: -0.10,        // long before the source: weak doubt, never a veto
  durationMatch: 0.20,
  durationMismatch: -0.35, // enough to pull a caption match down into review
};

const DUPLICATE_AT = 0.80;
const REVIEW_AT = 0.45;

const keyOf = (text) => normalizeKey(text || '', KEY_CHARS);
const keyable = (text) => keyOf(text).length >= MIN_KEY_CHARS;

/**
 * Score one candidate against the source clip.
 * @returns {{score: number, signals: string[]}}
 */
function scoreCandidate(source, candidate) {
  const signals = [];
  let score = 0;

  const a = keyOf(source.content);
  const b = keyOf(candidate.content);
  if (prefixMatch(a, b, MIN_KEY_CHARS)) {
    score += WEIGHTS.caption;
    signals.push(`caption(${Math.min(a.length, b.length)})`);
  }

  const dt = Date.parse(candidate.publishedAt) - Date.parse(source.publishedAt);
  if (Number.isFinite(dt)) {
    if (Math.abs(dt) <= NEAR_MS) { score += WEIGHTS.timeNear; signals.push('time:near'); }
    else if (dt > 0 && dt <= LATE_MS) { score += WEIGHTS.timeLate; signals.push('time:late'); }
    else if (dt < 0) { score += WEIGHTS.timeStale; signals.push('time:predates'); }
  }

  // Currently inert: Facebook's analytics carry no duration, so "both known" is
  // never true today. It goes live once the media probe in the publish path
  // fills in the source duration — kept because that is a real signal, not to
  // pad the table.
  if (Number.isFinite(source.durationSec) && Number.isFinite(candidate.durationSec)) {
    if (Math.abs(source.durationSec - candidate.durationSec) <= 1) {
      score += WEIGHTS.durationMatch; signals.push('duration:match');
    } else {
      score += WEIGHTS.durationMismatch; signals.push('duration:differs');
    }
  }

  return { score: Number(score.toFixed(3)), signals };
}

/**
 * Decide whether `source` already exists on `platform`.
 *
 * @param {object} source      {content, publishedAt, durationSec?}
 * @param {object[]} candidates  every post we can see on that platform
 * @param {object} opts        {platform, indexError?: string}
 * @returns {{verdict: 'duplicate'|'review'|'none'|'unknown', score, match, signals, confidence, reason}}
 *
 * `unknown` and `review` both mean DO NOT PUBLISH. They differ in what to do
 * about it: unknown is a gap in what we can see, review is a conflict in what
 * we can see.
 */
function classify(source, candidates = [], opts = {}) {
  const platform = opts.platform;
  const cfg = platforms.get(platform);

  if (opts.indexError) {
    return { verdict: 'unknown', score: 0, match: null, signals: [], confidence: 'none',
      reason: `could not read ${platform}: ${opts.indexError}` };
  }
  if (!keyable(source.content)) {
    return { verdict: 'unknown', score: 0, match: null, signals: [], confidence: 'none',
      reason: 'source caption too short to match on — nothing to compare' };
  }

  let best = { score: 0, signals: [], match: null };
  for (const c of candidates) {
    const s = scoreCandidate(source, c);
    if (s.score > best.score) best = { ...s, match: c };
  }

  if (best.score >= DUPLICATE_AT) {
    return { ...best, verdict: 'duplicate', confidence: 'strong', reason: 'already there' };
  }
  if (best.score >= REVIEW_AT) {
    return { ...best, verdict: 'review', confidence: 'partial',
      reason: 'signals disagree — a human decides this one' };
  }

  // Nothing found. How much that is worth depends on whether the platform can
  // be enumerated at all: Threads never appears in analytics:posts, so absence
  // there only proves *we* have not mirrored it, not that nothing is there.
  // Our own ledger covers exactly that case, and Threads posts can be deleted,
  // so this publishes — but it says out loud that the check was weak.
  const weak = cfg.verifiable === 'none';
  return { ...best, verdict: 'none', confidence: weak ? 'weak' : 'strong',
    reason: weak ? `${platform} cannot be enumerated — absence is not proof` : 'not found' };
}

const publishable = (v) => v.verdict === 'none';

module.exports = { classify, scoreCandidate, keyOf, keyable, publishable,
  MIN_KEY_CHARS, KEY_CHARS, WEIGHTS, DUPLICATE_AT, REVIEW_AT };
