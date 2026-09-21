/*
 * A FIXED CADENCE IS A FINGERPRINT.
 *
 * Measured 2026-09-21 over 42 publishes: the gap between consecutive posts was
 * 95 minutes almost every time (a constant 90-minute minimum plus the five
 * minute timer), and 20 of the 42 landed at :04-:08 past the hour. Separately,
 * every item held with `--at` unlocked at midnight UTC and went out at the
 * first tick after it — 10:05 Brisbane, eleven days running.
 *
 * Two jitters, and they are deliberately DIFFERENT mechanisms:
 *
 *   - the gap is recomputed every five minutes, so it is HASHED off the last
 *     post's timestamp. A fresh Math.random() per tick is the minimum of a
 *     dozen rolls, which is near zero and biased small — the trap these tests
 *     exist to pin.
 *   - an unlock is written once, so it is a real roll, stored on the row.
 */
const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const path = require('node:path');
const pace = require('../scripts/lib/pace');
const { unlockAt, AT_JITTER_MINUTES, parse } = require('../scripts/queue-add.js');

const posted = (iso) => ({ kind: 'queue.posted', ts: iso });

// These cases are about the GAP. The live 07:00-11:00 window would refuse most
// of the instants they walk over, for a reason none of them is testing, so it
// is switched off here and pinned in test/window.test.js instead.
const GAP = { window: null };

test('the gap jitter is the same answer at every tick, for the same last post', () => {
  const last = '2026-09-21T03:18:00.000Z';
  const first = pace.jitterFor(last);
  for (let i = 0; i < 50; i += 1) assert.equal(pace.jitterFor(last), first, 're-rolled between ticks');
});

test('it spreads over the whole 0..60 window rather than clustering', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) seen.add(pace.jitterFor(new Date(1758000000000 + i * 97000).toISOString()));
  assert.equal(Math.min(...seen), 0);
  assert.equal(Math.max(...seen), 60);
  assert.ok(seen.size > 50, `only ${seen.size} distinct delays — the hash is not spreading`);
});

/*
 * The positive control for "deterministic". If the jitter were re-rolled, a
 * publisher asking every five minutes would get through at roughly the minimum
 * gap; hashed, it waits the whole jittered gap however often it asks.
 */
test('asking every five minutes does NOT walk an item out early', () => {
  const last = '2026-09-21T03:18:00.000Z';
  const extra = pace.jitterFor(last);
  const events = [posted(last)];
  const at = (mins) => new Date(Date.parse(last) + mins * 60000);
  for (let m = 0; m < 90 + extra; m += 5) {
    assert.ok(pace.whyNotNow(events, GAP, at(m)), `let through at +${m} min, before 90+${extra}`);
  }
  assert.equal(pace.whyNotNow(events, GAP, at(90 + extra + 1)), null, 'never opens');
});

test('nextSlot promises the same instant the publisher will accept', () => {
  const last = '2026-09-21T03:18:00.000Z';
  const events = [posted(last)];
  const now = new Date(Date.parse(last) + 10 * 60000);
  const slot = new Date(pace.nextSlot(events, GAP, now));
  assert.equal(pace.whyNotNow(events, GAP, new Date(slot.getTime() + 1000)), null,
    'the page would show a time the publisher then refuses');
});

test('the jitter can be switched off, and then the old constant gap is back', () => {
  const last = '2026-09-21T03:18:00.000Z';
  const events = [posted(last)];
  const at = new Date(Date.parse(last) + 91 * 60000);
  assert.equal(pace.whyNotNow(events, { jitterMinutes: 0, window: null }, at), null);
});

test('status reports the jitter, so the dashboard cannot describe a fixed gap', () => {
  assert.equal(pace.status([], {}, new Date()).jitterMinutes, 60);
});

/*
 * An unlock lands somewhere in the posting window, in HIS hours. The old
 * version of this test asserted a UTC date, which was only ever right while
 * the window started at exactly midnight UTC: 07:00 Brisbane is the PREVIOUS
 * day in UTC, so the UTC date is now the wrong question to ask.
 */
test('an unlock lands inside the window, on the right Brisbane day', () => {
  const seen = new Set();
  for (let i = 0; i < AT_JITTER_MINUTES; i += 1) {
    // The MIDDLE of each minute's band. i/span looks equivalent and is not:
    // floating point makes floor((i / span) * span) land on i - 1 for some i,
    // which cost one value out of 240 and read like an off-by-one in the code.
    const iso = unlockAt('2026-09-22', (i + 0.5) / AT_JITTER_MINUTES);
    const z = pace.zoned(new Date(iso), pace.DEFAULTS.tz);
    assert.equal(z.day, '2026-09-22', `${iso} slipped off the day he asked for`);
    assert.ok(z.hour >= pace.DEFAULTS.window.from && z.hour < pace.DEFAULTS.window.to,
      `${iso} is ${z.hour}:00, outside the window`);
    seen.add(iso);
  }
  assert.equal(seen.size, AT_JITTER_MINUTES, 'every minute of the window must be reachable');
});

test('the unlock window is the pace window, not a second copy of the hours', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'queue-add.js'), 'utf8');
  assert.match(src, /pace\.DEFAULTS\.window/,
    'queue-add must read the window from pace, or the two drift apart');
});

test('--at still takes a plain day and stores a timestamp', () => {
  const opt = parse(['--body', 'Chris fixed his own website in an afternoon.', '--at', '2026-09-22']);
  // The window straddles midnight UTC, so assert the BRISBANE day and hour —
  // the UTC date is the 21st for most of the window and proves nothing.
  const z = pace.zoned(new Date(opt.at), pace.DEFAULTS.tz);
  assert.equal(z.day, '2026-09-22', `stored ${opt.at}`);
  assert.ok(z.hour >= 7 && z.hour < 11, `stored ${opt.at}, hour ${z.hour}`);
});

test('--at still refuses a shape that is not a day', () => {
  assert.throws(() => parse(['--body', 'x', '--at', '22-09-2026']), /--at wants YYYY-MM-DD/);
});
