/*
 * The pace. Load-bearing twice over now: the mirror and the queue both ask it
 * whether they may post, and it is the only thing standing between "queue five
 * things" and five posts landing in one minute.
 *
 * Every case here is in Brisbane time against a UTC box, because that gap is
 * where the bug was: unqualified, a 09:00-21:00 window puts the entire posting
 * day overnight for the audience.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const pace = require('../scripts/lib/pace.js');

const CFG = { perDay: 6, startHour: 9, endHour: 21, minGapMinutes: 90, tz: 'Australia/Brisbane' };
const at = (iso) => new Date(iso);
const ledgerWith = (...isos) => ({ clips: { c1: { targets:
  Object.fromEntries(isos.map((s, i) => [`p${i}`, { note: 'mirrored', at: s }])) } } });

test('the window is the audience\'s, not the box\'s', () => {
  // 23:30 UTC is 09:30 Brisbane — inside the window, though it looks like night here.
  assert.equal(pace.whyNotNow({}, CFG, at('2026-08-20T23:30:00Z')), null);
  // 09:00 UTC is 19:00 Brisbane — also inside.
  assert.equal(pace.whyNotNow({}, CFG, at('2026-08-20T09:00:00Z')), null);
  // 21:00 UTC is 07:00 Brisbane — outside, and this is the case that was wrong.
  assert.match(pace.whyNotNow({}, CFG, at('2026-08-20T21:00:00Z')), /outside the 9:00-21:00 window/);
});

test('the daily cap counts the audience\'s day', () => {
  // Six posts across one Brisbane day (2026-08-21), spanning a UTC midnight.
  const six = ['2026-08-20T23:10:00Z', '2026-08-21T01:00:00Z', '2026-08-21T03:00:00Z',
    '2026-08-21T05:00:00Z', '2026-08-21T07:00:00Z', '2026-08-21T09:00:00Z'];
  const why = pace.whyNotNow(ledgerWith(...six), CFG, at('2026-08-21T10:40:00Z'));
  assert.match(why, /6 already went out today/);
});

test('the minimum gap is what stops five queued things landing at once', () => {
  const l = ledgerWith('2026-08-20T23:30:00Z');
  assert.match(pace.whyNotNow(l, CFG, at('2026-08-20T23:35:00Z')), /only 5 min since the last one/);
  assert.equal(pace.whyNotNow(l, CFG, at('2026-08-21T01:05:00Z')), null);
});

// The mirror writes the ledger; the queue writes the event log. Neither can see
// the other's work, so a shared budget has to read both or it is not shared.
test('a queued post counts against the mirror\'s day, and the other way round', () => {
  const events = [{ kind: 'queue.posted', ts: '2026-08-20T23:30:00Z' }];
  assert.match(pace.whyNotNow({}, CFG, at('2026-08-20T23:40:00Z'), events),
    /only 10 min since the last one/);

  const l = ledgerWith('2026-08-20T23:30:00Z');
  const status = pace.status(l, CFG, at('2026-08-21T02:00:00Z'), events);
  assert.equal(status.today, 2, 'one mirrored and one queued is two for the day');
});

test('the next slot skips a closed window rather than proposing the middle of the night', () => {
  // 22:00 UTC = 08:00 Brisbane, an hour before the window opens.
  const next = pace.nextSlot({}, CFG, at('2026-08-20T22:00:00Z'));
  assert.equal(pace.zoned(new Date(next), CFG.tz).hour, 9);
});

test('a full day pushes the next slot into the next one', () => {
  const six = ['2026-08-20T23:10:00Z', '2026-08-21T01:00:00Z', '2026-08-21T03:00:00Z',
    '2026-08-21T05:00:00Z', '2026-08-21T07:00:00Z', '2026-08-21T09:00:00Z'];
  const next = pace.nextSlot(ledgerWith(...six), CFG, at('2026-08-21T10:00:00Z'));
  const z = pace.zoned(new Date(next), CFG.tz);
  assert.equal(z.day, '2026-08-22');
  assert.ok(z.hour >= 9 && z.hour <= 21, `expected a daytime slot, got ${z.hour}:00`);
});

test('nextSlot terminates even when nothing will ever be allowed', () => {
  // A cap of zero can never be satisfied; it must return null, not spin.
  assert.equal(pace.nextSlot({}, { ...CFG, perDay: 0 }, at('2026-08-20T23:00:00Z')), null);
});
