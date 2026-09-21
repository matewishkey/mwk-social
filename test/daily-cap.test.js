/*
 * THE DAILY CAP IS HIS NUMBER, NOT A TUNING KNOB.
 *
 * It was six until 2026-09-21, when the Pinterest backfill put EIGHT pins out
 * in a single day — every one of them legal under the cap and the ninety
 * minute gap, and the whole day reading as a machine emptying a list. He set
 * it to two that lunchtime and said "only override this one if i say so", then
 * to ONE the same evening: "I want to focus one short per a day instead of
 * overdo it... i think it is better i am learning things". The second move is
 * not the same complaint — it is about what he wants to spend his day on.
 *
 * So this file pins the DEFAULT, which is the thing a caller cannot see. The
 * rest of the pace tests pass their own fixture on purpose: they are about the
 * shape of the rules, and a fixture that happens to match the default hides
 * the day somebody changes it.
 */
const test = require('node:test');
const assert = require('node:assert');

const pace = require('../scripts/lib/pace');

test('the default cap is one a day, and changing it is his call', () => {
  assert.equal(pace.DEFAULTS.perDay, 1,
    'the cap is mate\'s number (2026-09-21) — he has to ask before this moves');
});

test('a second post is refused on the default config', () => {
  // 21:10Z is 07:10 Brisbane on the 21st and 00:30Z is 10:30 the SAME Brisbane
  // day — both inside the 07:00-11:00 window and more than the gap apart, so
  // the cap is the only thing left that can refuse.
  const one = [{ kind: 'queue.posted', ts: '2026-09-20T21:10:00Z' }];
  const why = pace.whyNotNow(one, {}, new Date('2026-09-21T00:30:00Z'));
  assert.match(why, /1 already went out today/);
});

test('the first of the day still gets through', () => {
  // The positive control: same instant, nothing sent yet. Without this, a cap
  // of zero would pass the test above just as well.
  assert.equal(pace.whyNotNow([], {}, new Date('2026-09-21T00:30:00Z')), null);
});

/*
 * At one a day the gap can never bind — the cap refuses first. That is a
 * CONSEQUENCE of his number rather than a rule, so it is asserted here and not
 * in pace.test.js, which tests the gap on its own fixture.
 */
test('the cap, not the gap, is what a second post hits', () => {
  const one = [{ kind: 'queue.posted', ts: '2026-09-20T21:10:00Z' }];
  const why = pace.whyNotNow(one, {}, new Date('2026-09-20T21:20:00Z'));
  assert.match(why, /already went out today/,
    'ten minutes after the last post it is still the cap that answers, not the gap');
});
