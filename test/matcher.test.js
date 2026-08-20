/*
 * The gate on the mirror: it must reproduce known history exactly.
 *
 * The fixture is the live corpus as of 2026-08-20 — 58 published posts across
 * seven platforms, captured straight from posts:list and analytics:posts. Every
 * expectation below was verified by hand against the platforms themselves, so a
 * failure here means the matcher changed its mind about something real.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const matcher = require('../scripts/lib/matcher');
const platforms = require('../scripts/lib/platforms');

const CORPUS = require('./fixtures/corpus.json');
const TARGETS = platforms.MIRROR_TARGETS;

const on = (p) => CORPUS.filter((x) => x.platform === p);
const fb = (idPart) => {
  const hit = CORPUS.filter((x) => x.platform === 'facebook' && x.platformPostId.includes(idPart));
  assert.equal(hit.length, 1, `fixture should hold exactly one facebook post matching ${idPart}`);
  return hit[0];
};

// The mirror universe: Facebook video posts. Image and text posts are not reels
// and are not mirrored, which is why there are seven of these and eighteen
// Facebook posts in total.
const REELS = {
  debugging:      fb('_122105076'),   // 08-05  "When debugging do not call your brother"
  aiKnows:        fb('_122105786'),   // 08-07  "AI knows when it's wrong!"
  uniqueObs:      fb('_122106667'),   // 08-10  "Your unique observations matter!"
  guinness:       fb('_122106914'),   // 08-11  "Ever wondered how a Guinness World Record"
  eightyPercent:  fb('_122108481'),   // 08-18  "Ever thought 80% is good enough"
  promptsBeat:    fb('_122108663'),   // 08-18  "Ever wondered why prompts beat websites"
  secretExposed:  fb('_122108823'),   // 08-19  "Ever had a secret exposed?"
};

// Verified against the live platforms. 'duplicate' = a copy is there already,
// 'none' = it is genuinely missing and is part of the backlog.
const EXPECTED = {
  debugging:     { instagram: 'duplicate', tiktok: 'none',      twitter: 'none',      threads: 'none' },
  aiKnows:       { instagram: 'duplicate', tiktok: 'none',      twitter: 'none',      threads: 'none' },
  uniqueObs:     { instagram: 'duplicate', tiktok: 'none',      twitter: 'none',      threads: 'none' },
  guinness:      { instagram: 'none',      tiktok: 'none',      twitter: 'none',      threads: 'none' },
  eightyPercent: { instagram: 'none',      tiktok: 'none',      twitter: 'duplicate', threads: 'none' },
  promptsBeat:   { instagram: 'none',      tiktok: 'none',      twitter: 'duplicate', threads: 'none' },
  secretExposed: { instagram: 'duplicate', tiktok: 'duplicate', twitter: 'duplicate', threads: 'duplicate' },
};

test('the fixture is the corpus we think it is', () => {
  assert.equal(CORPUS.length, 58);
  const reels = CORPUS.filter((x) => x.platform === 'facebook' && x.mediaType === 'video');
  assert.equal(reels.length, 7, 'seven Facebook reels make up the mirror universe');
  assert.deepEqual(new Set(reels.map((r) => r.platformPostId)),
    new Set(Object.values(REELS).map((r) => r.platformPostId)));
});

test('the matcher reproduces known history exactly', () => {
  const wrong = [];
  for (const [name, source] of Object.entries(REELS)) {
    for (const platform of TARGETS) {
      const got = matcher.classify(source, on(platform), { platform }).verdict;
      const want = EXPECTED[name][platform];
      if (got !== want) wrong.push(`${name} → ${platform}: got ${got}, expected ${want}`);
    }
  }
  assert.deepEqual(wrong, [], wrong.join('\n'));
});

test('the backlog is 19 platform-posts across 6 clips', () => {
  let missing = 0;
  const clips = new Set();
  for (const [name, source] of Object.entries(REELS)) {
    for (const platform of TARGETS) {
      if (matcher.classify(source, on(platform), { platform }).verdict === 'none') {
        missing++;
        clips.add(name);
      }
    }
  }
  assert.equal(missing, 19);
  assert.equal(clips.size, 6);
});

// The incident this whole module exists for. The manual TikTok went up at 10:59
// and the Facebook source at 11:00 — the copy PREDATES its own source by a
// minute, so any rule that penalises "published before the source" without a
// tolerance window would have posted the duplicate all over again.
test('the 2026-08-19 TikTok duplicate is caught, including the one posted first', () => {
  const source = REELS.secretExposed;
  const manual = CORPUS.find((x) => x.platformPostId === '7675695745185484053');
  const ours = CORPUS.find((x) => x.platformPostId === '7675842521515314448');
  assert.ok(manual && ours);
  assert.ok(Date.parse(manual.publishedAt) < Date.parse(source.publishedAt),
    'the manual TikTok really does predate the Facebook source');

  for (const candidate of [manual, ours]) {
    const { score } = matcher.scoreCandidate(source, candidate);
    assert.ok(score >= matcher.DUPLICATE_AT, `${candidate.platformPostId} scored ${score}`);
  }
  assert.equal(matcher.classify(source, [manual], { platform: 'tiktok' }).verdict, 'duplicate');
});

test('a caption too short to match on is unknown, never publishable', () => {
  const shortOne = CORPUS.find((x) => x.content === 'Do not try at work:)');
  assert.ok(shortOne);
  const v = matcher.classify(shortOne, on('instagram'), { platform: 'instagram' });
  assert.equal(v.verdict, 'unknown');
  assert.equal(matcher.publishable(v), false);
});

test('an empty caption is unknown, never publishable', () => {
  const blank = CORPUS.find((x) => x.platform === 'facebook' && x.content === '');
  assert.ok(blank);
  assert.equal(matcher.classify(blank, on('tiktok'), { platform: 'tiktok' }).verdict, 'unknown');
});

test('a failed index read is unknown, not "nothing found"', () => {
  const v = matcher.classify(REELS.guinness, [], { platform: 'tiktok', indexError: 'HTTP 500' });
  assert.equal(v.verdict, 'unknown');
  assert.match(v.reason, /HTTP 500/);
  assert.equal(matcher.publishable(v), false);
});

test('absence on Threads is publishable but flagged weak', () => {
  const v = matcher.classify(REELS.guinness, on('threads'), { platform: 'threads' });
  assert.equal(v.verdict, 'none');
  assert.equal(v.confidence, 'weak');
  const ig = matcher.classify(REELS.guinness, on('instagram'), { platform: 'instagram' });
  assert.equal(ig.confidence, 'strong');
});

test('a caption match with a contradicting duration lands in review, not published', () => {
  const source = { ...REELS.secretExposed, durationSec: 10 };
  const candidate = { ...CORPUS.find((x) => x.platformPostId === '18146814235536540'), durationSec: 47 };
  const v = matcher.classify(source, [candidate], { platform: 'instagram' });
  assert.equal(v.verdict, 'review');
  assert.equal(matcher.publishable(v), false);
});

test('two unrelated clips never look like each other', () => {
  const pairs = [];
  const reels = Object.values(REELS);
  for (const a of reels) {
    for (const b of reels) {
      if (a.platformPostId === b.platformPostId) continue;
      const { score } = matcher.scoreCandidate(a, b);
      if (score >= matcher.REVIEW_AT) pairs.push(`${a.platformPostId} ~ ${b.platformPostId} = ${score}`);
    }
  }
  assert.deepEqual(pairs, [], pairs.join('\n'));
});
