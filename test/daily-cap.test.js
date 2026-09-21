/*
 * THE DAILY CAP IS HIS NUMBER, NOT A TUNING KNOB.
 *
 * It was six until 2026-09-21, when the Pinterest backfill put EIGHT pins out
 * in a single day — every one of them legal under the cap and the ninety
 * minute gap, and the whole day reading as a machine emptying a list. He set
 * it to two and said "only override this one if i say so".
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
  const two = [day('2026-09-20T22:10:00Z'), day('2026-09-21T01:00:00Z')];
  const why = pace.whyNotNow(two, {}, new Date('2026-09-21T06:00:00Z'));
  assert.match(why, /2 already went out today/);
});

test('two still get through, or the cap would be one', () => {
  const one = [{ kind: 'queue.posted', ts: '2026-09-20T22:10:00Z' }];
  assert.equal(pace.whyNotNow(one, {}, new Date('2026-09-21T01:00:00Z')), null);
});
