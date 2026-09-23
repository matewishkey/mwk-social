/*
 * WHERE A POST POINTS, AND WHAT MWKSHOW.COM IS ALLOWED TO STAND FOR.
 *
 * Mate, 2026-09-22, an hour after the first Dial Countdown pin went live
 * pointing at "Apply to be a guest": "for these we can use always the original
 * page with a link instead of the show... the mwkshow.com is really just the
 * show otherwise use full link. this rule has to be generic."
 *
 * Two rules and they are separate:
 *
 *   1. A post has its own DESTINATION. Default the show; `queue_item.link`
 *      names another, and then the pin's destination, X's caption link and the
 *      link in the first comment all point there.
 *   2. A mwkshow.com code is minted for the SHOW and for nothing else. A short
 *      domain named after the show standing in for Elgato's marketplace is a
 *      worse link than the real one — nobody can tell where it goes.
 *
 * The cost of (2) is real and it is his call: a project link is not counted.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const voice = require('../scripts/lib/voice');
const shortlink = require('../scripts/lib/shortlink');
const { parse, sqlFor } = require('../scripts/queue-add');
const commentState = require('../scripts/lib/comment-state');

const SHOW = voice.config().links.show;
const PROJECT = 'https://matewishkey.com/projects/dial-countdown/';
const ELGATO = 'https://marketplace.elgato.com/product/dial-countdown';

/* ------------------------------------------------ what counts as the show */

test('the show, and anything under it, and nothing else', () => {
  assert.ok(shortlink.isShowLink(SHOW));
  assert.ok(shortlink.isShowLink(`${SHOW}/`));
  assert.ok(shortlink.isShowLink(`${SHOW}/faq`));
  assert.ok(shortlink.isShowLink(`${SHOW}?ref=x`));

  assert.ok(!shortlink.isShowLink(PROJECT));
  assert.ok(!shortlink.isShowLink(ELGATO));
  assert.ok(!shortlink.isShowLink(voice.config().links.episodes));
  // A prefix test alone would let a sibling path through on the same host.
  assert.ok(!shortlink.isShowLink(`${SHOW}case-studies`));
});

/*
 * A POSITIVE CONTROL, because "it did not mint" and "minting is switched off
 * in this process" look identical. The show url has to come back shortened in
 * the same run, through the same stub, or the assertions below prove nothing.
 */
function withMinting(fn) {
  const env = { ...process.env };
  const realFetch = globalThis.fetch;
  const calls = [];
  process.env.MWK_LOG_URL = 'https://ingest.example/log';
  process.env.MWK_LOG_TOKEN = 'test-token';
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true, url: 'https://mwkshow.com/zz9' }) };
  };
  try { return fn(calls); } finally {
    globalThis.fetch = realFetch;
    for (const k of ['MWK_LOG_URL', 'MWK_LOG_TOKEN']) {
      if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
    }
  }
}

test('a code is minted for the show and refused for anything else', async () => {
  await withMinting(async (calls) => {
    assert.equal(await shortlink.mint({ platform: 'pinterest', medium: 'link' }),
      'https://mwkshow.com/zz9', 'the default target is the show — this is the control');
    assert.equal(calls.length, 1);

    assert.equal(await shortlink.mint({ platform: 'pinterest', medium: 'link', target: PROJECT }), null);
    assert.equal(await shortlink.mint({ platform: 'twitter', medium: 'caption', target: ELGATO }), null);
    assert.equal(calls.length, 1, 'and neither one was even asked for');
  });
});

test('a custom comment keeps every url but the show as it was written', async () => {
  await withMinting(async () => {
    const body = `Everything it does: ${PROJECT}\nInstall it: ${ELGATO}\nCome along: ${SHOW}`;
    const out = await shortlink.trackLinks(body, { platform: 'facebook', medium: 'comment' });
    assert.ok(out.includes(PROJECT), 'the project page goes out in full');
    assert.ok(out.includes(ELGATO), 'so does somebody else\'s marketplace');
    assert.ok(!out.includes(SHOW), 'and the show is the one that gets a code');
    assert.ok(out.includes('https://mwkshow.com/zz9'));
  });
});

/* -------------------------------------------- the item names its own page */

test('the comment renders the post\'s own page, and still reads as ours', () => {
  const composed = voice.firstComment('facebook:1', { platform: 'facebook', noTags: true,
    linkUrl: PROJECT, linkLive: true });
  assert.strictEqual(composed.text, PROJECT);
  assert.ok(voice.carriesCta(composed.text),
    'without a marker for his own site the watcher would comment a second time, for ever');
});

/*
 * linkFor() is not exported — it is reached only through publish(), which
 * needs a network. The source is the next best evidence and it pins the one
 * thing that can silently regress: the item's destination is returned WHOLE,
 * before any minting, so it cannot come back as a mwkshow.com code.
 */
test('the link slot hands back the item\'s own destination, through destination()', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'post.js'), 'utf8');
  assert.match(src, /if \(opts\.link\) return shortlink\.destination\(opts\.link, where\);/,
    'the early return is the rule — only destination() decides whether it is minted');
  assert.match(src, /commentLink\(opts\.link\) \? await shortlink\.destination\(opts\.link, where\)/,
    'the comment uses the same destination, filtered to links that are his');
});

/*
 * TWO THINGS ARE TRACKED NOW (2026-09-23): the show and the course. A course
 * page is minted (the worker prints it on piy.show); a project or vendor page
 * still goes out whole.
 */
test('destination() mints a course page and leaves everything else alone', async () => {
  const realFetch = global.fetch;
  const sent = [];
  process.env.MWK_LOG_URL = 'https://example.test/events';
  process.env.MWK_LOG_TOKEN = 'x';
  global.fetch = async (_u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ ok: true, url: 'https://piy.show/c0de' }) }; };
  try {
    const COURSE = 'https://promptityourself.com/courses/open-the-door';
    assert.strictEqual(await shortlink.destination(COURSE, { platform: 'facebook' }), 'https://piy.show/c0de');
    assert.strictEqual(sent[0].target, COURSE);
    assert.strictEqual(await shortlink.destination(PROJECT, {}), PROJECT, 'a project page is not minted');
    assert.strictEqual(await shortlink.destination(ELGATO, {}), ELGATO);
    assert.strictEqual(sent.length, 1);
    assert.ok(voice.carriesCta(COURSE), 'a plain course url in a comment must still read as ours');
  } finally { global.fetch = realFetch; }
});

test('run-queue carries the destination from the row to the publish', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-queue.js'), 'utf8');
  assert.match(src, /link:\s*item\.link \|\| null/);
  const api = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'api.js'), 'utf8');
  assert.match(api, /link:\s*row\.link \|\| null/,
    'a column the claim does not hand over is a column nothing reads');
});

/* ------------------------------------------------------ caught at the keyboard */

test('--link wants a url, and says so while it is still one edit', () => {
  assert.throws(() => parse(['--body', 'x', '--link', 'Everything it does: see the page']), /--link/);
  assert.throws(() => parse(['--body', 'x', '--link', 'matewishkey.com/projects/dial-countdown/']),
    /--link/, 'no scheme is not a url, and Pinterest answers Invalid URL to that');
  assert.throws(() => parse(['--body', 'x', '--link', 'https://mwkshow.com/dial']),
    /show/, 'that host means the show, whatever it happens to resolve to');
  assert.doesNotThrow(() => parse(['--body', 'x', '--link', PROJECT]));
});

test('the destination rides into the insert, and nothing there means the show', () => {
  const with_ = parse(['--body', 'x', '--link', PROJECT]);
  const sql = sqlFor(with_, '01ABC', [null, null], [null, null], 'now');
  assert.ok(sql.includes(`'${PROJECT}'`), sql);
  assert.match(sql, /not_before, link\)/, 'named in the column list, or the value lands nowhere');

  const without = parse(['--body', 'x']);
  assert.match(sqlFor(without, '01ABC', [null, null], [null, null], 'now'), /NULL, NULL\);/);
});

/* ------------------------------------------- and the watcher has to know too */

/*
 * THE WATCHER NEVER LEARNED THE DESTINATION, AND ON THREADS IT IS THE ONLY
 * PATH (found in review 2026-09-22, hours after the feature shipped).
 *
 * `first-comment.js` only ever sees a published post — it cannot look a queue
 * item up — so it rendered the SHOW under a post that is about a project.
 * Threads has no native first comment, so that was EVERY Threads comment on a
 * `--link` post, and any comment backfilled after a native one failed.
 *
 * The publisher writes it down under the post's own key. Under `__links` and
 * not the post's entry, because an entry under the post key means "already
 * dealt with" and would make the watcher skip the post altogether.
 */
test('the publisher records the destination where the watcher looks', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mwk-cs-'));
  const was = process.env.MWK_COMMENT_STATE;
  process.env.MWK_COMMENT_STATE = path.join(dir, 'first-comments.json');
  try {
    const state0 = commentState.load();
    assert.equal(commentState.linkFor(state0, 'threads:1'), null, 'nothing recorded is the show');

    const n = commentState.recordLinks([{ platform: 'threads', postId: '1' },
      { platform: 'facebook', postId: '2' }], PROJECT);
    assert.equal(n, 2);

    const state = commentState.load();
    assert.equal(commentState.linkFor(state, 'threads:1'), PROJECT);
    assert.equal(commentState.linkFor(state, 'facebook:2'), PROJECT);

    // The post's OWN entry must stay empty, or the watcher's pending filter
    // (`!state[p.key]`) reads it as done and never comments at all.
    assert.equal(state['threads:1'], undefined,
      'recording a destination must not look like the comment already went out');

    assert.equal(commentState.recordLinks([{ platform: 'threads', postId: '1' }],
      'https://matewishkey.com/elsewhere/'), 0, 'never overwritten');
    assert.equal(commentState.linkFor(commentState.load(), 'threads:1'), PROJECT);
    assert.equal(commentState.recordLinks([{ platform: 'threads', postId: '9' }], null), 0,
      'no destination means the show, and writes nothing');
  } finally {
    if (was === undefined) delete process.env.MWK_COMMENT_STATE; else process.env.MWK_COMMENT_STATE = was;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('both writer and reader are wired, not just declared', () => {
  const rq = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-queue.js'), 'utf8');
  assert.match(rq, /commentState\.recordLinks\(/, 'the publisher must write it down');
  const fc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'first-comment.js'), 'utf8');
  assert.match(fc, /commentState\.linkFor\(state, target\.key\)/, 'the watcher must read it');
  assert.match(fc, /\(ourLink\n\s*\? await shortlink\.destination\(ourLink,/,
    'and it must take precedence over minting, or the show comes back');
});

/*
 * A DESTINATION THAT IS NOT HIS STILL GETS THE SHOW IN THE COMMENT, AND THE
 * WHOLE POST USED TO DIE INSTEAD (found in review 2026-09-22).
 *
 * `voice.firstComment()` refuses a comment carrying none of `markers[]` — the
 * duplicate guard could never recognise it again — and `commentFor()` is
 * called OUTSIDE post.js's per-account catch. So a `--link` at a vendor's page
 * threw and took the entire publish group with it: nothing went out.
 */
test('a vendor page is refused as a comment, which is why it must not reach one', () => {
  assert.throws(() => voice.firstComment('facebook:1', { platform: 'facebook', noTags: true,
    linkUrl: ELGATO, linkLive: true }), /markers/,
  'this is the throw the guard below exists to keep away from a publish');
});

test('the comment keeps the show when the destination is not his', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'post.js'), 'utf8');
  assert.match(src, /const commentLink = \(link\) => \(link && voice\.carriesCta\(link\) \? link : null\);/);
  assert.match(src, /commentLink\(opts\.link\) \? await shortlink\.destination\(opts\.link, where\)/);

  const fc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'first-comment.js'), 'utf8');
  assert.match(fc, /itemLink && voice\.carriesCta\(itemLink\) \? itemLink : null/,
    'the watcher needs the same guard — it composes through the same function');

  // The slots do NOT have this guard, on purpose: a pin may point anywhere.
  assert.match(src, /if \(opts\.link\) return shortlink\.destination\(opts\.link, where\);/);
});

test('queue-add says so, rather than leaving it to be noticed at publish time', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'queue-add.js'), 'utf8');
  const notes = src.match(/the first comment keeps the show/g) || [];
  assert.equal(notes.length, 2, 'on the queued line AND the dry run — the 2026-09-21 lesson');
});
