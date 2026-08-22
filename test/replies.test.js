/*
 * The reply pipeline. Every test here is a thing that would go out under his
 * name to a real person if it broke, so they are all about refusal: what must
 * never be drafted, never be posted twice, never be posted at all.
 */
const test = require('node:test');
const assert = require('node:assert');

const replies = require('../scripts/lib/replies');

const tweet = (over = {}) => ({
  id: '1', created: new Date().toISOString(), replyCount: 2,
  author: { username: 'someone', displayName: 'Some One' },
  text: 'I spend every sunday copying invoices out of my email into a spreadsheet and it takes hours.',
  ...over,
});

/* ------------------------------------------------------------- the guardrails */

test('a draft carrying a link is refused', () => {
  assert.deepStrictEqual(replies.problems('come along https://matewishkey.com/show'), ['contains a link']);
  assert.deepStrictEqual(replies.problems('have a look at mwkshow.com/ab12'), []);   // no scheme, not a link
  assert.ok(replies.problems('see www.matewishkey.com').includes('contains a link'));
});

/*
 * The one mistake that cannot be walked back. The very first live draft claimed
 * he had hosted and sold his own digital assets, which he never said he had —
 * the model does not know his history and must not invent one.
 */
test('a draft that invents his history is refused', () => {
  for (const t of [
    'i built a thing that just emails them for me',
    'i ended up hosting my own files and selling directly',
    'my client had exactly this last year',
    'when i was doing this by hand it took all sunday',
  ]) {
    assert.ok(replies.problems(t).includes('invents his history'), `should refuse: ${t}`);
  }
  // Saying what is true of the THING rather than of him is fine.
  assert.deepStrictEqual(
    replies.problems('you can host and sell the files yourself, no gatekeeper. takes an afternoon.'), []);
});

test('a draft that compliments, tags, or opens with a handle is refused', () => {
  assert.ok(replies.problems('great thread, so true').includes('compliments the poster'));
  assert.ok(replies.problems('you could automate that #PIY').includes('contains a hashtag'));
  assert.ok(replies.problems('@someone you could automate that').includes('opens with a handle — X adds that itself'));
});

test('a draft using a word the brand rules forbid is refused', () => {
  for (const w of ['free', 'guaranteed', 'safe']) {
    assert.ok(replies.problems(`that would be ${w} to do yourself`)
      .includes('uses a word the brand rules forbid'), w);
  }
});

test('an empty draft is a valid answer, and is refused as a post', () => {
  assert.deepStrictEqual(replies.problems(''), ['empty']);
  assert.deepStrictEqual(replies.problems('   '), ['empty']);
});

/* -------------------------------------------------------------------- sieve -- */

test('the sieve drops what it should and says why', () => {
  const hours = (n) => new Date(Date.now() - n * 3600000).toISOString();
  const { kept, dropped } = replies.sieve([
    tweet({ id: 'ok' }),
    tweet({ id: 'old', created: hours(48) }),
    tweet({ id: 'seen' }),
    tweet({ id: 'crowd', replyCount: 5000 }),
    tweet({ id: 'short', text: 'lol' }),
    tweet({ id: 'promo', text: 'doors close tonight on my course, last chance to enroll before we start' }),
    tweet({ id: 'recent-author', author: { username: 'cooldown', displayName: 'C' } }),
  ], { known: new Set(['seen']), recentAuthors: new Set(['cooldown']) });

  assert.deepStrictEqual(kept.map((t) => t.id), ['ok']);
  assert.equal(dropped['too old'], 1);
  assert.equal(dropped['already seen'], 1);
  assert.equal(dropped['already a crowd'], 1);
  assert.equal(dropped['nothing to answer'], 1);
  assert.equal(dropped['blocked phrase'], 1);
  assert.equal(dropped['author replied to recently'], 1);
});

test('the sieve keeps the freshest when it has to choose', () => {
  const mins = (n) => new Date(Date.now() - n * 60000).toISOString();
  const { kept } = replies.sieve([
    tweet({ id: 'older', created: mins(300) }),
    tweet({ id: 'newest', created: mins(5) }),
    tweet({ id: 'middle', created: mins(90) }),
  ]);
  assert.deepStrictEqual(kept.map((t) => t.id), ['newest', 'middle', 'older']);
});

/* ------------------------------------------------------------------ cursors -- */

/*
 * X bills per post returned, so a run that re-reads the same tweets costs real
 * money — five chunk queries at forty posts is a dollar a run, and the timer
 * fires every twenty minutes. The cursor is what makes the cadence affordable.
 */
test('a cursor is keyed by the query, not by its position', () => {
  const a = replies.queriesFor(['one', 'two', 'three'], 2);
  const b = replies.queriesFor(['zero', 'one', 'two', 'three'], 2);
  // Adding a handle reshuffles the chunks. Keys must follow the query text, or
  // a cursor gets applied to a different set of people — silently, and in the
  // direction that HIDES posts.
  assert.notEqual(replies.cursorKey(a[0]), replies.cursorKey(b[0]));
  assert.equal(replies.cursorKey(a[0]), replies.cursorKey(replies.queriesFor(['one', 'two'], 2)[0]));
});

test('the watch list is chunked inside X\'s query length limit', () => {
  for (const q of replies.queriesFor(replies.config().watch)) {
    assert.ok(q.length <= 512, `query is ${q.length} characters: X rejects it`);
  }
});

/* ------------------------------------------------------------------- config -- */

test('the watch list is people, and holds no duplicates', () => {
  const w = replies.config().watch;
  assert.ok(w.length > 10);
  assert.equal(new Set(w.map((h) => h.toLowerCase())).size, w.length, 'a duplicate handle');
  for (const h of w) assert.match(h, /^[A-Za-z0-9_]{1,15}$/, `${h} is not a valid X handle`);
});

test('the daily cap is small on purpose', () => {
  // 20+ replies in an hour trips X's spam detection and 50 a day is the ceiling.
  // His rule is "less is more"; this pins that it stays that way.
  const p = replies.config().pick;
  assert.ok(p.perDay <= 15, `perDay is ${p.perDay} — X deboosts a reply guy`);
  assert.ok(p.perRun <= p.perDay);
});
