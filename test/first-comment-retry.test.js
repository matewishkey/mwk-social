/*
 * A 403 THAT HAS EXPIRED IS A QUESTION, NOT AN ANSWER.
 *
 * E010 (2026-09-19): YouTube closes the comments endpoint while a stream is
 * live, so the first run filed a 403 with a 24-hour retry window. Every run
 * after the stream ended could read the comments fine — and walked past the
 * 403 branch to the transcript wait, which `continue`d without touching the
 * ledger. When the window lapsed, the pre-loop filter read the stale note as a
 * post closed for good. Nine hourly runs said "0 without a recorded first
 * comment" over a video with zero comments and its door wide open.
 *
 * Two things pin it: an entry that ever carried retryUntil stays retryable
 * until the LOOP writes a permanent verdict, and the moment a read succeeds
 * any 403 note on file is cleared before anything else can `continue`.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { isRetryable } = require('../scripts/first-comment.js');

const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

test('a 403 whose window is still open is retried', () => {
  assert.equal(isRetryable({ commentedAt: null, note: 'comments unavailable (403)', retryUntil: hoursFromNow(+2) }), true);
});

/* THE ONE THAT DROPPED E010. Expired is not the same as decided. */
test('a 403 whose window has LAPSED is still retried — the loop decides, never the filter', () => {
  assert.equal(isRetryable({ commentedAt: null, note: 'comments unavailable (403)', retryUntil: hoursFromNow(-2) }), true);
});

test('a permanent verdict — written without retryUntil — is left alone', () => {
  for (const entry of [
    { commentedAt: null, note: 'comments closed on this post' },
    { commentedAt: null, note: 'comment already on the post' },
    { commentedAt: null, note: 'seeded, not commented' },
    { commentedAt: null, note: 'link already in the caption' },
    { commentedAt: '2026-09-20T06:34:58.969Z', variant: 'episode/2' },
  ]) {
    assert.equal(isRetryable(entry), false, JSON.stringify(entry));
  }
  assert.equal(isRetryable(undefined), false);
});

/*
 * The clearing has to happen where the door is found open, and BEFORE any
 * branch that can `continue` — the transcript wait is the one that bit. Read
 * off the source, because the order is the fix.
 */
test('an open read clears a stale 403 before anything downstream can continue', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'first-comment.js'), 'utf8');
  const closedBranch = src.indexOf('if (closed) {');
  const clear = src.indexOf("Object.hasOwn(state[target.key], 'retryUntil')");
  const doneBranch = src.indexOf('if (done) {');
  const transcriptWait = src.indexOf("message: 'no transcript yet'");
  assert.ok(closedBranch > 0 && clear > 0 && doneBranch > 0 && transcriptWait > 0, 'all four landmarks must exist');
  assert.ok(clear > closedBranch, 'the clear sits after the 403 branch — a closed post keeps its note');
  assert.ok(clear < doneBranch, 'the clear sits before the already-commented branch');
  assert.ok(clear < transcriptWait, 'the clear sits before the transcript wait, which is the continue that bit');
  assert.match(src.slice(clear, clear + 200), /delete state\[target\.key\]/, 'the stale entry is deleted, not annotated');
});

/* The permanent verdict must be written WITHOUT retryUntil, or nothing ever converges. */
test('an expired 403 that is still 403 becomes a permanent note with no retryUntil', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'first-comment.js'), 'utf8');
  assert.match(src, /\.\.\.\(again \? \{ retryUntil: retryUntil\.toISOString\(\) \} : \{\}\)/,
    'the closed branch must omit retryUntil once the window has passed');
});
