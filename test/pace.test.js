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

const CFG = { perDay: 6, minGapMinutes: 90, tz: 'Australia/Brisbane' };
const at = (iso) => new Date(iso);
const sent = (...isos) => isos.map((ts) => ({ kind: 'queue.posted', ts }));

test('the hour of the day never refuses a post', () => {
  // 21:00 UTC is 07:00 Brisbane and 23:00 UTC is 09:00 — early morning and
  // small hours somewhere, and neither is a reason to hold a post back.
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
  assert.equal(pace.whyNotNow(one, CFG, at('2026-08-21T01:05:00Z')), null);
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
