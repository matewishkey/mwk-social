/*
 * The scheduler. Small, but it decides the order in which irreversible things
 * happen, so it is worth pinning down.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const mirror = require('../scripts/mirror');
const matcher = require('../scripts/lib/matcher');
const platforms = require('../scripts/lib/platforms');

const CORPUS = require('./fixtures/corpus.json');
const TARGETS = platforms.MIRROR_TARGETS;

const universe = {
  sources: CORPUS
    .filter((x) => x.platform === 'facebook' && x.mediaType === 'video')
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))),
  index: Object.fromEntries(TARGETS.map((p) => [p, CORPUS.filter((x) => x.platform === p)])),
  errors: {},
};

const EMPTY_LEDGER = { version: 1, clips: {} };
const OPTS = { days: 7, perDay: 3 };
const FROM = new Date('2026-08-20T03:00:00Z');

test('the plan covers exactly the backlog the matcher found', () => {
  const plan = mirror.schedule(mirror.assess(universe, EMPTY_LEDGER), OPTS, FROM);
  assert.equal(plan.length, 19);
  assert.equal(new Set(plan.map((p) => p.clipId)).size, 6);
  assert.ok(plan.every((p) => p.at), 'seven days is enough room for all of them');
});

test('newest clip first', () => {
  const plan = mirror.schedule(mirror.assess(universe, EMPTY_LEDGER), OPTS, FROM);
  const order = [...new Set(plan.map((p) => p.clipId))];
  const dateOf = (id) => universe.sources.find((s) => id.endsWith(s.platformPostId)).publishedAt;
  for (let i = 1; i < order.length; i++) {
    assert.ok(dateOf(order[i - 1]) > dateOf(order[i]), `${order[i - 1]} should precede ${order[i]}`);
  }
});

// Instagram cannot be deleted or edited through any API, so it is never the
// first thing tried on a clip — the deletable platforms prove the media and the
// caption first.
test('instagram is last on every clip it appears in', () => {
  const plan = mirror.schedule(mirror.assess(universe, EMPTY_LEDGER), OPTS, FROM);
  for (const clipId of new Set(plan.map((p) => p.clipId))) {
    const forClip = plan.filter((p) => p.clipId === clipId);
    const ig = forClip.findIndex((p) => p.platform === 'instagram');
    if (ig === -1) continue;
    assert.equal(ig, forClip.length - 1, `instagram is not last on ${clipId}`);
    assert.ok(forClip.length >= 2, 'instagram is never the only attempt on a clip');
  }
});

// Days and hours are the AUDIENCE's, not the box's. This machine runs on UTC,
// where an unqualified 09:00-21:00 window would land entirely overnight in
// Brisbane, so every assertion here goes through mirror.zoned().
test('the pace and the window are respected, in the audience timezone', () => {
  const plan = mirror.schedule(mirror.assess(universe, EMPTY_LEDGER), OPTS, FROM);
  const byDay = {};
  for (const item of plan) (byDay[mirror.zoned(new Date(item.at)).day] ||= []).push(item.at);
  for (const [day, times] of Object.entries(byDay)) {
    assert.ok(times.length <= OPTS.perDay, `${day} has ${times.length} posts`);
    const sorted = [...times].sort();
    for (let i = 1; i < sorted.length; i++) {
      const gap = (Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / 60000;
      assert.ok(gap >= mirror.DEFAULTS.minGapMinutes, `${day}: ${gap} minutes between posts`);
    }
    for (const t of times) {
      const { hour } = mirror.zoned(new Date(t));
      assert.ok(hour >= mirror.DEFAULTS.startHour && hour <= mirror.DEFAULTS.endHour,
        `${t} is ${hour}:00 in ${mirror.TZ}, outside the window`);
    }
  }
  assert.ok(Object.keys(byDay).every((d) => d > mirror.zoned(FROM).day),
    'nothing is scheduled for today — a run must not fire the moment it is planned');
});

test('a ledger entry marked posted keeps that clip off the queue', () => {
  const clipId = `facebook:${universe.sources[1].platformPostId}`;
  const ledger = { version: 1, clips: { [clipId]: { targets: Object.fromEntries(
    TARGETS.map((p) => [p, { status: 'posted', note: 'done by hand' }])) } } };
  const plan = mirror.schedule(mirror.assess(universe, ledger), OPTS, FROM);
  assert.ok(!plan.some((p) => p.clipId === clipId));
});

test('a platform that could not be read is dropped from the plan, not published to', () => {
  const broken = { ...universe, errors: { tiktok: 'HTTP 500' } };
  const assessment = mirror.assess(broken, EMPTY_LEDGER);
  const plan = mirror.schedule(assessment, OPTS, FROM);
  assert.ok(!plan.some((p) => p.platform === 'tiktok'));
  assert.ok(assessment.every((c) => c.targets.tiktok.verdict === 'unknown'));
  // and the platforms that did read are unaffected
  assert.ok(plan.some((p) => p.platform === 'threads'));
});

/*
 * The pace. The unit fires hourly and this is what says no most of the time —
 * "a few a day, spread over days" is a rule in the script, not a cron cadence,
 * so a manual run obeys it too.
 */
const OPTS3 = { perDay: 3 };
const ledgerWith = (times) => ({ version: 1, clips: { c: { targets: Object.fromEntries(
  times.map((at, i) => [`p${i}`, { status: 'posted', note: 'mirrored', at }])) } } });

// Written with explicit +10:00 offsets so the assertions mean the same thing
// whatever timezone the box running them is set to.
const bne = (s) => new Date(`${s}+10:00`);

test('nothing goes out before 09:00 or after 21:00 where the audience is', () => {
  assert.match(mirror.whyNotNow(ledgerWith([]), OPTS3, bne('2026-08-21T08:59:00')), /window/);
  assert.match(mirror.whyNotNow(ledgerWith([]), OPTS3, bne('2026-08-21T22:00:00')), /window/);
  assert.equal(mirror.whyNotNow(ledgerWith([]), OPTS3, bne('2026-08-21T09:00:00')), null);
  assert.equal(mirror.whyNotNow(ledgerWith([]), OPTS3, bne('2026-08-21T21:00:00')), null);
});

// The box is on UTC, so 23:00 UTC is already tomorrow morning in Brisbane. If
// the day boundary came from the box the cap would reset twelve hours early.
test('a day is the audience calendar day, not the box one', () => {
  assert.equal(mirror.zoned(new Date('2026-08-20T23:30:00Z')).day, '2026-08-21');
  assert.equal(mirror.zoned(new Date('2026-08-20T13:30:00Z')).day, '2026-08-20');
});

test('the daily cap counts today only', () => {
  const three = ['2026-08-21T09:00:00+10:00', '2026-08-21T12:00:00+10:00', '2026-08-21T15:00:00+10:00'];
  assert.match(mirror.whyNotNow(ledgerWith(three), OPTS3, bne('2026-08-21T18:00:00')), /already went out today/);
  // the same three, seen from the next day, are no longer in the way
  assert.equal(mirror.whyNotNow(ledgerWith(three), OPTS3, bne('2026-08-22T09:00:00')), null);
});

test('the minimum gap is respected', () => {
  const recent = ledgerWith(['2026-08-21T12:00:00+10:00']);
  assert.match(mirror.whyNotNow(recent, OPTS3, bne('2026-08-21T13:00:00')), /only 60 min/);
  assert.equal(mirror.whyNotNow(recent, OPTS3, bne('2026-08-21T13:30:00')), null);
});

test('seeded entries are not mistaken for posts we made', () => {
  // A seeded "posted" has no `at` and note "already live before the mirror ran".
  // Counting those would make every day look full from the first run.
  const seeded = { version: 1, clips: { c: { targets: {
    a: { status: 'posted', at: null, note: 'already live before the mirror ran' },
    b: { status: 'posted', at: null, note: 'already live before the mirror ran' },
    d: { status: 'posted', at: null, note: 'already live before the mirror ran' },
  } } } };
  assert.equal(mirror.whyNotNow(seeded, OPTS3, bne('2026-08-21T10:00:00')), null);
});
