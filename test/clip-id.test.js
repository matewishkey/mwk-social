/*
 * A CLICK HAS TO NAME THE VIDEO THAT EARNED IT.
 *
 * `first-comment.js` only ever sees a published post, so for sixteen Threads
 * codes it minted with no clip id and the join from a click back to the clip
 * did not exist. The publisher's 82 codes all had one; the watcher's had none.
 * The join was there the whole time: run-queue.js writes each platform's own
 * post id into `queue_item.result`, and the watcher's `post_key` is
 * `<platform>:<that same id>`.
 *
 * These tests pin the resolution, and pin the two ways it goes wrong:
 * a post_key with no queue item behind it must stay null rather than guess,
 * and a Facebook id containing `_` must not match through LIKE's wildcard.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const src = (f) => import(path.join(__dirname, '..', 'web', 'src', f));

/**
 * SQL LIKE, with `\` as the ESCAPE character, as a regex. Written out rather
 * than chained replaces: the chained version silently mistranslated `\_` and
 * made the escaping test fail against correct code, which is the worst kind of
 * test double — one that accuses the thing it is checking.
 */
const quote = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const likeToRegex = (pattern) => {
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') { i += 1; out += quote(pattern[i] ?? ''); continue; }
    if (ch === '%') { out += '[\\s\\S]*'; continue; }
    if (ch === '_') { out += '[\\s\\S]'; continue; }
    out += quote(ch);
  }
  return new RegExp(`${out}$`);
};

/** A stand-in for D1 that records the bound parameters and answers from rows. */
const fakeDb = (rows) => {
  const seen = [];
  return {
    seen,
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            seen.push({ sql, args });
            return {
              async first() {
                const rx = likeToRegex(args[0]);
                const hit = rows.find((r) => rx.test(r.result));
                return hit ? { id: hit.id } : null;
              },
            };
          },
        };
      },
    },
  };
};

const ROWS = [
  { id: 'Q_THREADS', result: '[{"platform":"threads","status":"published","postId":"18070854974736781"}]' },
  { id: 'Q_FB_A', result: '[{"platform":"facebook","status":"published","postId":"1218437048021839_122115471303415959"}]' },
  { id: 'Q_FB_B', result: '[{"platform":"facebook","status":"published","postId":"1218437048021839X122115471303415959"}]' },
  // A video: the publisher records what posts:list gave it, which is BARE.
  { id: 'Q_FB_VIDEO', result: '[{"platform":"facebook","status":"published","postId":"1526644959488954"}]' },
];

test('a watcher post_key resolves to the queue item that published it', async () => {
  const { resolveClipId } = await src('api.js');
  const db = fakeDb(ROWS);
  assert.equal(await resolveClipId(db, 'threads:18070854974736781'), 'Q_THREADS');
});

/*
 * The absence has to be an absence. An external YouTube VOD, a manual code and
 * a reality-check card were never queued, so there is no clip to name and
 * inventing one would be worse than leaving it null.
 */
test('a post_key with no queue item behind it stays null', async () => {
  const { resolveClipId } = await src('api.js');
  const db = fakeDb(ROWS);
  for (const key of ['youtube:gUAo3DSGf-o', 'threads:99999999999999999']) {
    assert.equal(await resolveClipId(db, key), null, `${key} should not resolve`);
  }
});

test('the publisher\'s own keys are never looked up — they already carry a clip id', async () => {
  const { resolveClipId } = await src('api.js');
  const db = fakeDb(ROWS);
  for (const key of ['queue:01M2YCPNYDJXYRTEDYNFAR2WWD', 'reshare:01M2Y:6a7f', 'manual:pretalk-public',
    'account:6a7f2a46', 'new:1642442762', 'reality-check:ato']) {
    assert.equal(await resolveClipId(db, key), null, `${key} should not be looked up`);
  }
  assert.equal(db.seen.length, 0, 'no query should have been made at all');
});

/*
 * THE ONE THAT WOULD HAVE BEEN SILENT. A Facebook post id is `<page>_<post>`,
 * and `_` is a single-character wildcard in LIKE — so an unescaped id matches
 * a different post that differs only at that position. Q_FB_B exists purely to
 * be the wrong answer this test refuses.
 */
test('an underscore in a post id is escaped, not treated as a wildcard', async () => {
  const { resolveClipId } = await src('api.js');

  /*
   * THE CONTROL COMES FIRST, or this test cannot fail. Q_FB_B differs from
   * Q_FB_A only where the underscore sits, so an UNESCAPED needle matches both
   * — and, ordered by created_at, could hand back the wrong one. Prove the
   * double is fooled by the bug before asserting the code avoids it.
   */
  const naive = fakeDb(ROWS);
  const bothMatch = ROWS.filter((r) => likeToRegex(
    '%"postId":"1218437048021839_122115471303415959"%',
  ).test(r.result));
  assert.equal(bothMatch.length, 2, 'the unescaped needle must match both rows, or this proves nothing');
  assert.equal(naive.seen.length, 0);

  const db = fakeDb(ROWS);
  const got = await resolveClipId(db, 'facebook:1218437048021839_122115471303415959');
  assert.equal(got, 'Q_FB_A', 'the escaped needle must match only the real post');
  assert.match(db.seen[0].sql, /ESCAPE/, 'the LIKE must declare an escape character');
  assert.ok(db.seen[0].args[0].includes('\\_'), 'the underscore must be escaped in the needle');
});

/*
 * A FACEBOOK VIDEO HAS TWO IDS AND THE SOURCE DECIDES WHICH ONE WE HOLD.
 * Measured 2026-09-22 on four videos: `posts:list` reports the bare video id
 * (which is what the publisher then writes into `queue_item.result`), while
 * `analytics:posts` — the sweep that finds a Restream mirror — reports the
 * `<page>_<post>` composite for the SAME video. The two numbers are unrelated,
 * so the only bridge is the post url, which both surfaces spell with the bare
 * id in it.
 *
 * The control is the image post two tests up: composite on both surfaces, and
 * it must keep resolving on the FIRST lookup, or this fallback is papering
 * over a direct match it broke.
 */
test('a Facebook video found by the analytics sweep resolves through its url', async () => {
  const { resolveClipId } = await src('api.js');

  // The control: without the url there is nothing to bridge with, and the
  // composite matches no row. If this passed, the test below would prove
  // nothing about the url.
  const blind = fakeDb(ROWS);
  assert.equal(
    await resolveClipId(blind, 'facebook:1218437048021839_122116207695415959'),
    null, 'the composite alone must not resolve — that is the bug',
  );

  const db = fakeDb(ROWS);
  assert.equal(
    await resolveClipId(db, 'facebook:1218437048021839_122116207695415959',
      'https://www.facebook.com/reel/1526644959488954/'),
    'Q_FB_VIDEO', 'the bare id in the url is what joins',
  );
  assert.equal(db.seen.length, 2, 'the direct needle has to be tried first');
});

test('the watch/?v= spelling resolves too, and a foreign url does not', async () => {
  const { resolveClipId } = await src('api.js');
  assert.equal(
    await resolveClipId(fakeDb(ROWS), 'facebook:1218437048021839_122116207695415959',
      'https://www.facebook.com/watch/?v=1526644959488954'),
    'Q_FB_VIDEO',
  );
  // A url for some other video must not hand back this one.
  assert.equal(
    await resolveClipId(fakeDb(ROWS), 'facebook:1218437048021839_122116207695415959',
      'https://www.facebook.com/reel/2067282410583411/'),
    null, 'an unrelated video id must stay null rather than fall back to anything',
  );
});

/*
 * The fallback is FACEBOOK ONLY and is a SECOND lookup. A platform whose id
 * shape is stable must not gain a second query it never needed, and a direct
 * hit must never be second-guessed — Q_FB_A is the control for that.
 */
test('the url fallback never fires for a direct hit or for another platform', async () => {
  const { resolveClipId } = await src('api.js');

  const direct = fakeDb(ROWS);
  assert.equal(await resolveClipId(direct, 'facebook:1218437048021839_122115471303415959',
    'https://www.facebook.com/reel/1526644959488954/'), 'Q_FB_A');
  assert.equal(direct.seen.length, 1, 'a direct hit must not run the fallback');

  const other = fakeDb(ROWS);
  assert.equal(await resolveClipId(other, 'threads:99999999999999999',
    'https://www.facebook.com/reel/1526644959488954/'), null);
  assert.equal(other.seen.length, 1, 'only Facebook gets a second lookup');
});

/*
 * clip_id is part of mint()'s dedupe key, so resolving it changes what an
 * existing row matches. Reading the source rather than the behaviour, because
 * the behaviour needs a live D1 and the ordering is the thing that matters:
 * resolve BEFORE the key is used, never after.
 */
test('mint resolves the clip id before the dedupe key reads it', async () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'api.js'), 'utf8');
  const resolveAt = s.indexOf('clipId = clipId || await resolveClipId(');
  const keyAt = s.indexOf('AND clip_id IS ?');
  assert.ok(resolveAt > 0, 'mint() must resolve the clip id');
  assert.ok(keyAt > 0, 'the dedupe key must still read clip_id');
  assert.ok(resolveAt < keyAt, 'the resolution has to happen before the dedupe key is built');
});
