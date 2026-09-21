/*
 * THE DAILY CAP IS HIS NUMBER, NOT A TUNING KNOB.
 *
 * It was six until 2026-09-21, when the Pinterest backfill put EIGHT pins out
 * in a single day — every one of them legal under the cap and the ninety
 * minute gap, and the whole day reading as a machine emptying a list. He set
 * it to two and said "only override this one if i say so".
 *
 * ⚠ IT SPENT AN HOUR AT ONE, ON A MISREADING WORTH RECORDING. "I want to
 * focus one short per a day instead of overdo it" is about what HE shoots,
 * not about what the queue releases; asked directly, he answered "the two
 * limit is good, no worries about that". His production rate and the
 * publisher's cap are different numbers and only the second one lives here.
 *
 * So this file pins the DEFAULT, which is the thing a caller cannot see. The
 * rest of the pace tests pass their own fixture on purpose: they are about the
 * shape of the rules, and a fixture that happens to match the default hides
 * the day somebody changes it.
 */
const test = require('node:test');
const assert = require('node:assert');

const pace = require('../scripts/lib/pace');

test('the default cap is two a day, and changing it is his call', () => {
  assert.equal(pace.DEFAULTS.perDay, 2,
    'the cap is mate\'s number (2026-09-21) — he has to ask before this moves');
});

test('a third post is refused on the default config', () => {
  const day = (iso) => ({ kind: 'queue.posted', ts: iso });
  // Two Brisbane-day posts, far enough apart that only the CAP can refuse.
  // All three instants are INSIDE the 07:00-11:00 Brisbane window, so the cap
  // is the only thing that can refuse: 21:10Z and 23:00Z are 07:10 and 09:00
  // on the 21st, and 00:30Z is 10:30 the same Brisbane day. The cap is also
  // checked BEFORE the window, so the day's sliding opening cannot stand in
  // for it and make this pass for the wrong reason.
  const two = [day('2026-09-20T21:10:00Z'), day('2026-09-20T23:00:00Z')];
  const why = pace.whyNotNow(two, {}, new Date('2026-09-21T00:30:00Z'));
  assert.match(why, /2 already went out today/);
});

test('two still get through, or the cap would be one', () => {
  // 21:10Z is 07:10 Brisbane on the 21st; 00:30Z is 10:30 the same day. The
  // opening never lands in the last hour of the window, so 10:30 is always
  // past it and the gap is long since served — nothing left to refuse.
  const one = [{ kind: 'queue.posted', ts: '2026-09-20T21:10:00Z' }];
  assert.equal(pace.whyNotNow(one, {}, new Date('2026-09-21T00:30:00Z')), null);
});
