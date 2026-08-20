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

test('the pace and the window are respected', () => {
  const plan = mirror.schedule(mirror.assess(universe, EMPTY_LEDGER), OPTS, FROM);
  const byDay = {};
  for (const item of plan) (byDay[item.at.slice(0, 10)] ||= []).push(item.at);
  for (const [day, times] of Object.entries(byDay)) {
    assert.ok(times.length <= OPTS.perDay, `${day} has ${times.length} posts`);
    const sorted = [...times].sort();
    for (let i = 1; i < sorted.length; i++) {
      const gap = (Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / 60000;
      assert.ok(gap >= mirror.DEFAULTS.minGapMinutes, `${day}: ${gap} minutes between posts`);
    }
    for (const t of times) {
      const hour = new Date(t).getHours();
      assert.ok(hour >= mirror.DEFAULTS.startHour && hour <= mirror.DEFAULTS.endHour, `${t} is outside the window`);
    }
  }
  assert.ok(Object.keys(byDay).every((d) => d > FROM.toISOString().slice(0, 10)),
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
