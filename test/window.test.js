/*
 * THE POSTING WINDOW, AND THE FACT THAT IT REVERSES A RECORDED DECISION.
 *
 * "There is no time-of-day posting window" was mate's call on 2026-08-21: the
 * audience spans timezones, so holding for a good hour only delays. He
 * reversed it on 2026-09-21 — "i think better morning is better", "the
 * morning giving us the best coverage" — on the arithmetic rather than on any
 * measurement: 07:00-11:00 Brisbane is 17:00-21:00 in New York, and at one
 * post a day the slot matters in a way it did not at six.
 *
 * WITHIN the window the day's opening SLIDES, and that is the half of this
 * file to read first. At one post a day the gap jitter can never bind — the
 * cap refuses a second post before the gap is consulted — so without a
 * sliding opening every post would land at 07:05 Brisbane for ever, which is
 * the fingerprint he asked us to stop leaving on the same day he set the cap.
 *
 * What these pin: the window is real, it is escapable, it applies to the
 * PUBLISHER and to what the dashboard promises, the hours live in one place
 * so a held item cannot unlock outside the hours the pace will allow, and the
 * opening is a jitter rather than a slower metronome.
 */
const test = require('node:test');
const assert = require('node:assert');

const pace = require('../scripts/lib/pace');

// Every instant below is on this Brisbane day, so this is the opening these
// cases have to reason about. Read it rather than hardcoding a minute: it is
// hashed, and a literal here would be a fixture nobody could re-derive.
const DAY = '2026-09-22';
const OPEN = pace.openingFor(DAY);            // minutes after 07:00

// Brisbane is UTC+10 all year; no daylight saving to reason about.
const bne = (h, m = 0) => new Date(Date.parse('2026-09-22T00:00:00Z') + (h - 10) * 3600000 + m * 60000);
const hhmm = (iso) => new Intl.DateTimeFormat('en-GB',
  { timeZone: 'Australia/Brisbane', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

test('the default window is the morning he asked for', () => {
  assert.deepStrictEqual(pace.DEFAULTS.window, { from: 7, to: 11 });
});

test('inside the window a post may go, outside it may not', () => {
  for (const m of [OPEN, OPEN + 1, 239]) {
    assert.equal(pace.whyNotNow([], {}, bne(7, m)), null,
      `07:00+${m} is inside, past today's opening, and was refused`);
  }
  for (const h of [0, 5, 6, 11, 12, 18, 23]) {
    assert.match(pace.whyNotNow([], {}, bne(h)) || '', /outside the 7:00-11:00 window/,
      `${h}:00 is outside and was allowed`);
  }
});

/*
 * The two refusals are different sentences on purpose: at 07:10 "outside the
 * window" would be a lie, and the useful thing to read is which minute today
 * actually opens at.
 */
test('inside the window but before the opening is its own refusal', () => {
  if (!OPEN) return;                          // this day happens to open at 07:00
  const why = pace.whyNotNow([], {}, bne(7, OPEN - 1)) || '';
  assert.doesNotMatch(why, /outside/, 'it is inside the window, an hour of the day is not wrong');
  assert.match(why, /today opens at/, `got ${why}`);
});

/*
 * END EXCLUSIVE. 11:00 being in or out is the kind of thing that gets decided
 * by accident, so it is decided here: the window is 07:00:00 to 10:59:59.
 */
test('the start is inclusive and the end is exclusive', () => {
  // 07:00 may still be waiting on the day's own opening, so the claim here is
  // only that the WINDOW has begun — that refusal must not say "outside".
  assert.doesNotMatch(pace.whyNotNow([], {}, bne(7, 0)) || '', /outside/,
    '07:00 exactly is inside the window');
  // The opening never lands in the last hour, so 10:59 is always allowed.
  assert.equal(pace.whyNotNow([], {}, bne(10, 59)), null, '10:59 must be allowed');
  assert.match(pace.whyNotNow([], {}, bne(11, 0)) || '', /outside/, '11:00 exactly must not be');
});

const opening = (day) => {
  const m = 7 * 60 + pace.openingFor(day);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

test('the next slot is the next opening, not the top of the window', () => {
  assert.equal(hhmm(pace.nextSlot([], {}, bne(15, 23))), opening('2026-09-23'),
    'afternoon waits for tomorrow, and tomorrow has its own opening');
  assert.equal(hhmm(pace.nextSlot([], {}, bne(5, 40))), opening(DAY),
    'before dawn waits for today\'s opening, not for 07:00');
  const late = bne(7, Math.max(OPEN, 1) + 30);
  assert.equal(hhmm(pace.nextSlot([], {}, late)), hhmm(late.toISOString()),
    'past the opening it is now');
});

/*
 * THE POINT OF THE WHOLE MECHANISM. Without this the answer above is 07:00
 * every day and the test still passes.
 */
test('consecutive days do not open at the same minute', () => {
  const week = ['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25',
    '2026-09-26', '2026-09-27', '2026-09-28'];
  assert.equal(new Set(week.map((d) => pace.openingFor(d))).size, week.length,
    `a week of openings collapsed: ${week.map((d) => pace.openingFor(d)).join(', ')}`);
});

test('the opening is the same answer at every tick of the same day', () => {
  const first = pace.openingFor(DAY);
  for (let i = 0; i < 50; i += 1) assert.equal(pace.openingFor(DAY), first, 're-rolled between ticks');
});

/*
 * A year, because seven days could pass by luck. The band is 0..180: the
 * window is four hours and the opening always leaves the last one free, so a
 * post that opens at the latest still has an hour of five-minute ticks to
 * publish in.
 */
test('the opening spreads over the window and never eats the last hour', () => {
  const seen = new Set();
  for (let i = 0; i < 365; i += 1) {
    const day = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    const v = pace.openingFor(day);
    assert.ok(v >= 0 && v <= 180, `${day} opened at 07:00+${v}, inside the last hour`);
    seen.add(v);
  }
  assert.ok(seen.size > 120, `only ${seen.size} distinct openings in a year — the hash is not spreading`);
  assert.equal(Math.min(...seen), 0);
  assert.equal(Math.max(...seen), 180);
});

test('no window means no opening to wait for', () => {
  assert.equal(pace.openingFor(DAY, { window: null }), 0);
});

/*
 * nextSlot and whyNotNow must agree, or the dashboard promises a time the
 * publisher then refuses. That has happened before with the gap jitter.
 */
test('the instant the page promises is one the publisher accepts', () => {
  for (const start of [bne(2), bne(6, 30), bne(11, 5), bne(15), bne(22, 45)]) {
    const slot = pace.nextSlot([], {}, start);
    assert.equal(pace.whyNotNow([], {}, new Date(slot)), null,
      `promised ${hhmm(slot)} from ${hhmm(start.toISOString())} and would refuse it`);
  }
});

test('it can be switched off without a deploy, and then every hour is fine', () => {
  assert.equal(pace.parseWindow('off'), null);
  assert.equal(pace.parseWindow(''), null);
  assert.equal(pace.parseWindow('11-7'), null, 'a backwards window is a typo, not a wrap-around');
  assert.equal(pace.parseWindow('7-25'), null, 'there is no 25th hour');
  assert.deepStrictEqual(pace.parseWindow('9-17'), { from: 9, to: 17 });
  assert.deepStrictEqual(pace.parseWindow(' 7 - 11 '), { from: 7, to: 11 });
  assert.equal(pace.whyNotNow([], { window: null }, bne(23)), null);
});

/*
 * A typo in MWK_WINDOW must not stop the queue. Refusing to parse gives null,
 * which is "no window" — the old behaviour — rather than a throw that would
 * take the publisher down at the next tick.
 */
test('an unparseable window is no window, never a crash', () => {
  assert.doesNotThrow(() => pace.parseWindow('seven to eleven'));
  assert.equal(pace.parseWindow('seven to eleven'), null);
});

test('status carries the window, so the dashboard cannot describe a different one', () => {
  assert.deepStrictEqual(pace.status([], {}, bne(9)).window, { from: 7, to: 11 });
});
