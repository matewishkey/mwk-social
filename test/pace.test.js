/*
 * The pace. It is the only thing standing between "queue five things" and five
 * posts landing in one minute, and now the only thing deciding when anything
 * goes out at all.
 *
 * There is no time-of-day window any more (2026-08-21) — the first case here
 * pins that, because it used to be the opposite. What is still zoned is the
 * DAY: every case runs Brisbane time against a UTC box, because counting UTC
 * days would reset the cap twelve hours early for the audience.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const pace = require('../scripts/lib/pace.js');

// A fixture, deliberately not the default: these tests are about the shape of
// the rules, and pinning the live cap is test/daily-cap.test.js's job.
//
// `window: null` is part of that isolation. These cases are about VOLUME — the
// cap and the gap — and leaving the live 07:00-11:00 window in would have them
// fail for a reason none of them is testing. The window has its own file.
const CFG = { perDay: 6, minGapMinutes: 90, tz: 'Australia/Brisbane', window: null };
const at = (iso) => new Date(iso);
const sent = (...isos) => isos.map((ts) => ({ kind: 'queue.posted', ts }));

/*
 * THIS TEST USED TO ASSERT THE OPPOSITE, and the reversal is the point.
 * Until 2026-09-21 it read "the hour of the day never refuses a post" (mate,
 * 2026-08-21). He reversed it: 07:00-11:00 Brisbane is 17:00-21:00 New York.
 * With the window switched off the old behaviour is still exactly right, which
 * is what this now pins — every hour is fine when nothing says otherwise.
 */
test('with no window, the hour of the day never refuses a post', () => {
  for (const iso of ['2026-08-20T21:00:00Z', '2026-08-20T15:00:00Z',
    '2026-08-20T23:30:00Z', '2026-08-20T09:00:00Z']) {
    assert.equal(pace.whyNotNow([], CFG, at(iso)), null, `${iso} should be fine`);
  }
});

test('the daily cap counts the audience\'s day', () => {
  // Six posts across one Brisbane day (2026-08-21), spanning a UTC midnight.
  const six = sent('2026-08-20T23:10:00Z', '2026-08-21T01:00:00Z', '2026-08-21T03:00:00Z',
    '2026-08-21T05:00:00Z', '2026-08-21T07:00:00Z', '2026-08-21T09:00:00Z');
  assert.match(pace.whyNotNow(six, CFG, at('2026-08-21T10:40:00Z')), /6 already went out today/);
});

test('the minimum gap is what stops five queued things landing at once', () => {
  const one = sent('2026-08-20T23:30:00Z');
  assert.match(pace.whyNotNow(one, CFG, at('2026-08-20T23:35:00Z')), /only 5 min since the last one/);
  // The gap alone, with the jitter switched off: 95 minutes clears 90.
  assert.equal(pace.whyNotNow(one, { ...CFG, jitterMinutes: 0 }, at('2026-08-21T01:05:00Z')), null);
});

/*
 * And with the jitter on, which is the default since 2026-09-21. A constant 90
 * put every post exactly 95 minutes after the last one; the extra is hashed off
 * the last post's timestamp so it holds still between ticks. test/jitter.test.js
 * pins the mechanism — this pins that the DEFAULT config carries it.
 */
test('the default gap is jittered, not a constant 90', () => {
  const last = '2026-08-20T23:30:00Z';
  const one = sent(last);
  const extra = pace.jitterFor(last, pace.DEFAULTS.jitterMinutes);
  assert.ok(extra > 0, 'this fixture needs a seed that actually jitters');
  assert.match(pace.whyNotNow(one, CFG, at(new Date(Date.parse(last) + (90 + extra - 1) * 60000).toISOString())),
    /min of jitter on this one/);
  assert.equal(pace.whyNotNow(one, CFG, at(new Date(Date.parse(last) + (90 + extra + 1) * 60000).toISOString())), null);
});

// Only queue.posted counts. The log carries plenty else — comments, failures,
// heartbeats — and counting those would refuse a slot that is genuinely free.
test('only a publish counts against the day', () => {
  const noise = [
    { kind: 'comment.posted', ts: '2026-08-20T23:30:00Z' },
    { kind: 'queue.failed', ts: '2026-08-20T23:31:00Z' },
    { kind: 'run.started', ts: '2026-08-20T23:32:00Z' },
  ];
  assert.equal(pace.whyNotNow(noise, CFG, at('2026-08-20T23:40:00Z')), null);
  assert.equal(pace.status(noise, CFG, at('2026-08-20T23:40:00Z')).today, 0);
});

test('status counts the day and names the next slot', () => {
  const two = sent('2026-08-20T23:10:00Z', '2026-08-21T01:00:00Z');
  const s = pace.status(two, CFG, at('2026-08-21T02:00:00Z'));
  assert.equal(s.today, 2);
  assert.equal(s.perDay, 6);
  assert.ok(s.nextAt, 'a next slot should be named');
});

test('with room today, the next slot is now', () => {
  // 22:00 UTC = 08:00 Brisbane. Nothing sent, nothing to wait for.
  const now = at('2026-08-20T22:00:00Z');
  assert.equal(pace.nextSlot([], CFG, now), now.toISOString());
});

test('a full day pushes the next slot into the next one', () => {
  const six = sent('2026-08-20T23:10:00Z', '2026-08-21T01:00:00Z', '2026-08-21T03:00:00Z',
    '2026-08-21T05:00:00Z', '2026-08-21T07:00:00Z', '2026-08-21T09:00:00Z');
  const next = pace.nextSlot(six, CFG, at('2026-08-21T10:00:00Z'));
  const z = pace.zoned(new Date(next), CFG.tz);
  assert.equal(z.day, '2026-08-22');
});

test('nextSlot terminates even when nothing will ever be allowed', () => {
  // A cap of zero can never be satisfied; it must return null, not spin.
  assert.equal(pace.nextSlot([], { ...CFG, perDay: 0 }, at('2026-08-20T23:00:00Z')), null);
});
