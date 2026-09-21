/*
 * THE POSTING WINDOW, AND THE FACT THAT IT REVERSES A RECORDED DECISION.
 *
 * "There is no time-of-day posting window" was mate's call on 2026-08-21: the
 * audience spans timezones, so holding for a good hour only delays. He
 * reversed it on 2026-09-21 — "i think better morning is better", "the
 * morning giving us the best coverage" — on the arithmetic rather than on any
 * measurement: 07:00-11:00 Brisbane is 17:00-21:00 in New York, and at two
 * posts a day the slot matters in a way it did not at six.
 *
 * What these pin: the window is real, it is escapable, it applies to the
 * PUBLISHER and to what the dashboard promises, and the hours live in one
 * place so a held item cannot unlock outside the hours the pace will allow.
 */
const test = require('node:test');
const assert = require('node:assert');

const pace = require('../scripts/lib/pace');

// Brisbane is UTC+10 all year; no daylight saving to reason about.
const bne = (h, m = 0) => new Date(Date.parse('2026-09-22T00:00:00Z') + (h - 10) * 3600000 + m * 60000);
const hhmm = (iso) => new Intl.DateTimeFormat('en-GB',
  { timeZone: 'Australia/Brisbane', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

test('the default window is the morning he asked for', () => {
  assert.deepStrictEqual(pace.DEFAULTS.window, { from: 7, to: 11 });
});

test('inside the window a post may go, outside it may not', () => {
  for (const h of [7, 8, 9, 10]) {
    assert.equal(pace.whyNotNow([], {}, bne(h)), null, `${h}:00 is inside and was refused`);
  }
  for (const h of [0, 5, 6, 11, 12, 18, 23]) {
    assert.match(pace.whyNotNow([], {}, bne(h)) || '', /outside the 7:00-11:00 window/,
      `${h}:00 is outside and was allowed`);
  }
});

/*
 * END EXCLUSIVE. 11:00 being in or out is the kind of thing that gets decided
 * by accident, so it is decided here: the window is 07:00:00 to 10:59:59.
 */
test('the start is inclusive and the end is exclusive', () => {
  assert.equal(pace.whyNotNow([], {}, bne(7, 0)), null, '07:00 exactly must be allowed');
  assert.equal(pace.whyNotNow([], {}, bne(10, 59)), null, '10:59 must be allowed');
  assert.match(pace.whyNotNow([], {}, bne(11, 0)) || '', /outside/, '11:00 exactly must not be');
});

test('the next slot is the next morning, at the top of the hour', () => {
  assert.equal(hhmm(pace.nextSlot([], {}, bne(15, 23))), '07:00', 'afternoon waits for tomorrow');
  assert.equal(hhmm(pace.nextSlot([], {}, bne(5, 40))), '07:00', 'before dawn waits a couple of hours');
  assert.equal(hhmm(pace.nextSlot([], {}, bne(9, 12))), '09:12', 'inside the window it is now');
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
