/*
 * The dashboard's markup. The Worker's other paths need Access headers or a D1
 * binding to exercise; the rendering does not, and it is the part where a
 * mistake is silent — a wrong status colour or an unescaped caption.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const src = (f) => import(path.join(__dirname, '..', 'web', 'src', f));

const TZ = 'Australia/Brisbane';
const PACE = { body: { today: 2, perDay: 6, nextAt: 'Fri 09:00' } };

const base = (over = {}) => ({
  tz: TZ, email: 'mate@matewishkey.com', beat: { at: new Date().toISOString(), count: 3 },
  snapshots: { pace: PACE }, events: [], counts: [], kind: '', level: '',
  actions: [], queue: { waiting: 3, failed: 0 }, ...over,
});

/* ------------------------------------------------------------- overview -- */

test('the page leads with what is waiting and what has gone out today', async () => {
  const { overviewPage } = await src('pages/overview.js');
  const html = overviewPage(base());
  assert.match(html, /<b>3<\/b>\s*<span>waiting to go out<\/span>/);
  assert.match(html, /<b>2\/6<\/b>\s*<span>sent today<\/span>/);
  assert.match(html, /next Fri 09:00/);
});

// "Nothing happened" and "the box is off" must never look the same. The
// heartbeat tile is the only thing separating them.
test('a stale heartbeat is called out, a fresh one is not', async () => {
  const { overviewPage } = await src('pages/overview.js');
  assert.match(overviewPage(base()), /t-ok/);
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  assert.match(overviewPage(base({ beat: { at: old, count: 0 } })), /t-bad/);
  assert.match(overviewPage(base({ beat: null })), /never checked in/);
});

test('an empty database renders rather than throwing', async () => {
  const { overviewPage } = await src('pages/overview.js');
  const html = overviewPage(base({ snapshots: {}, beat: null, queue: null, actions: [] }));
  assert.match(html, /never checked in/);
  assert.match(html, /Nothing yet/);
  assert.match(html, /Nothing waiting on you/);
});

// Captions and messages come from the platforms, not from us.
test('text from a post cannot inject markup', async () => {
  const { overviewPage } = await src('pages/overview.js');
  const nasty = '<script>alert(1)</script>';
  const html = overviewPage(base({
    events: [{ ts: new Date().toISOString(), kind: 'comment.posted', level: 'info',
      platform: 'instagram', message: nasty, url: null }],
  }));
  assert.ok(!html.includes(nasty), 'the raw script tag must not survive');
  assert.match(html, /&lt;script&gt;/);
});

test('a url in an event becomes a link, and one without stays text', async () => {
  const { overviewPage } = await src('pages/overview.js');
  const withUrl = overviewPage(base({ events: [{ ts: new Date().toISOString(), kind: 'queue.posted',
    level: 'info', platform: 'threads', message: 'posted', url: 'https://example.com/p' }] }));
  assert.match(withUrl, /<a href="https:\/\/example\.com\/p"/);
  const without = overviewPage(base({ events: [{ ts: new Date().toISOString(), kind: 'run.started',
    level: 'info', platform: null, message: 'started', url: null }] }));
  assert.ok(!/<a href="https:\/\/example/.test(without));
});

// The your-turn list is the only part of the page that stops without a human.
test('a manual action offers its link and a way to tick it off', async () => {
  const { overviewPage } = await src('pages/overview.js');
  const html = overviewPage(base({ actions: [{ id: 'a1', kind: 'fb-personal-share',
    platform: 'facebook', label: 'Share to your personal timeline',
    url: 'https://facebook.com/p/1', created_at: new Date().toISOString() }] }));
  assert.match(html, /Share to your personal timeline/);
  assert.match(html, /href="https:\/\/facebook\.com\/p\/1"/);
  assert.match(html, /name="id" value="a1"/);
  assert.match(html, /t-warn/, 'it should be flagged as needing attention');
});

/* ------------------------------------------------------------ workflows -- */

// The point of the page is that it comes from the same table the publish path
// reads, so the thing worth asserting is that an impossible step says so.
test('the workflow page names who does each step, including nobody', async () => {
  const { configPage } = await src('pages/config.js');
  const { flows } = require('../scripts/lib/platforms.js');
  const html = configPage({ email: 'm@x.com', tz: TZ,
    snapshots: { platforms: { body: { flows: flows() }, updatedAt: new Date().toISOString() } } });
  assert.match(html, /tiktok/);
  assert.match(html, /impossible/, 'TikTok and X have no comments API we can use');
  assert.doesNotMatch(html, /your turn/, 'nothing asks him to share Facebook by hand any more (2026-09-14)');
  assert.match(html, /automatic/, 'LinkedIn resharing is');
  assert.match(html, /watcher/, 'Threads gets its comment from the watcher');
});

/*
 * The page has to EXPLAIN the two mechanisms, not just badge each platform —
 * it is the answer to "how does the first comment actually work?", and the
 * lists in it are derived so they cannot drift from the platform table.
 */
test('the workflow page explains the first comment, and derives who does it', async () => {
  const { configPage } = await src('pages/config.js');
  const { flows } = require('../scripts/lib/platforms.js');
  const html = configPage({ email: 'm@x.com', tz: TZ, snapshots: {
    platforms: { body: { flows: flows() }, updatedAt: new Date().toISOString() },
    voice: { body: { always: ['#MWKShow', '#PIY'], maxTopic: 4, variants: 10,
      episodeMixRatio: 0.4, shortLinkHost: 'mwkshow.com', caps: { instagram: 5 } } } } });

  assert.match(html, /How the first comment works/);
  assert.match(html, /Natively<\/b> on [^<]*youtube/, 'youtube takes it natively');
  assert.match(html, /By the watcher<\/b> on [^<]*threads/, 'threads needs the watcher');
  assert.match(html, /Not at all<\/b> on [^<]*tiktok/, 'tiktok cannot have one');
  assert.match(html, /10 variants/);
  assert.match(html, /mwkshow\.com/);
  assert.match(html, /#MWKShow #PIY/);
});

test('the workflow page explains resharing, and who has to do it', async () => {
  const { configPage } = await src('pages/config.js');
  const { flows } = require('../scripts/lib/platforms.js');
  const html = configPage({ email: 'm@x.com', tz: TZ, snapshots: {
    platforms: { body: { flows: flows() }, updatedAt: new Date().toISOString() } } });

  assert.match(html, /How resharing works/);
  assert.match(html, /possible on <b>linkedin<\/b> and nowhere else/);
  assert.match(html, /never generated for you/, 'the commentary is his, not ours');
  assert.match(html, /your own profile/, 'the native post is his, since 2026-09-14');
  assert.match(html, /company page/);
  assert.match(html, /someone else's name/, 'the other profile reposts plain');
  assert.doesNotMatch(html, /Your turn/, 'nothing files a Facebook share for him any more');
});

/*
 * A REWRITE HE HAS NOT ANSWERED IN 14 DAYS IS A NO (2026-09-14). Four rebuilds
 * were re-drafted by the model every night for a week and re-filed with their
 * age reset, so "drafted hours ago" sat on proposals he had ignored for weeks.
 * The endpoint the box reads first expires them, then hands back the list of
 * videos NOT to build for — waiting or refused — so nothing re-drafts them.
 */
test('the pending endpoint expires stale rewrites and names what not to redraft', async () => {
  const { api } = await src('api.js');
  const seen = [];
  const env = {
    INGEST_TOKEN: 'tok',
    DB: { prepare(sql) {
      const stmt = {
        bind: (...args) => { seen.push({ sql, args }); return stmt; },
        run: async () => { seen.push({ sql, ran: true }); return { meta: { changes: 0 } }; },
        all: async () => {
          seen.push({ sql, all: true });
          if (/IN \('proposed', 'rejected'\)/.test(sql)) return { results: [{ video_id: 'w1' }, { video_id: 'no1' }] };
          return { results: [] };
        },
      };
      return stmt;
    } },
  };
  const request = new Request('https://ingest.example/youtube/pending', {
    method: 'POST', headers: { Authorization: 'Bearer tok' }, body: '{}',
  });
  const body = await (await api(request, env, new URL('https://ingest.example/youtube/pending'))).json();

  const expiry = seen.find((s) => /SET state = 'rejected'/.test(s.sql) && s.args);
  assert.ok(expiry, 'stale proposals are expired before anything is read');
  assert.match(expiry.sql, /state = 'proposed' AND proposed_at < \?/, 'only undecided rows, only past the cutoff');
  assert.match(String(expiry.args[1]), /^auto:\d+-days$/, 'an automatic no is stamped as one, never as his');
  const cutoff = Date.parse(expiry.args[2]);
  const daysAgo = (Date.now() - cutoff) / 86400_000;
  assert.ok(daysAgo > 13.9 && daysAgo < 14.1, `the cutoff is 14 days back, got ${daysAgo.toFixed(2)}`);
  assert.ok(seen.findIndex((s) => s.ran && /rejected/.test(s.sql)) < seen.findIndex((s) => s.all),
    'the expiry runs BEFORE the reads, or a just-expired row is still handed back to build');

  assert.deepStrictEqual(body.skip, ['w1', 'no1'], 'waiting and refused both come back as skip');
  assert.deepStrictEqual(body.items, []);
});

/*
 * The Retry button is offered ONLY for platforms that said failed. A timeout or
 * a platform still processing is unknown, gets no button, and says so.
 */
test('an unknown platform gets no Retry button, only a note to look by hand', async () => {
  const { failedPlatforms, unknownPlatforms, queuePage } = await src('pages/queue.js');
  const pace = { perDay: 6, today: 0, minGapMinutes: 90, tz: TZ, nextAt: null, why: null };
  const row = { id: 'q1', status: 'posted', body: 'x', platforms: '[]', first_comment: 1, priority: 0,
    created_at: new Date().toISOString(),
    result: JSON.stringify([
      { platform: 'facebook', status: 'published', url: 'https://fb/1' },
      { platform: 'twitter', status: 'failed', url: null, error: 'media' },
      { platform: 'threads', status: 'processing', url: null },
      { platform: 'tiktok', status: 'unknown', url: null, error: 'timed out' },
    ]) };
  assert.deepEqual(failedPlatforms(row), ['twitter'], 'only the platform that said failed');
  assert.deepEqual(unknownPlatforms(row), ['threads', 'tiktok']);

  const html = queuePage({ email: 'm@x.com', tz: TZ, waiting: [], done: [row], total: 1, pace });
  assert.match(html, /Retry 1<\/button>/, 'twitter can be retried');
  assert.doesNotMatch(html, /Retry 3/, 'threads and tiktok must not be offered a second copy');

  // A row with only unknowns: no button at all, a note instead.
  const only = { ...row, result: JSON.stringify([{ platform: 'instagram', status: 'unknown', url: null }]) };
  const html2 = queuePage({ email: 'm@x.com', tz: TZ, waiting: [], done: [only], total: 1, pace });
  assert.doesNotMatch(html2, /Retry \d/);
  assert.match(html2, /instagram: unknown, check by hand/);
});

/*
 * A claim older than forty minutes is a run that died. It is marked failed
 * with a note — never re-queued, since it may have published before dying —
 * and the sweep runs inside claim() so the next tick is what notices.
 */
test('claim() marks a stale claim failed, and never queued', async () => {
  const { api } = await src('api.js');
  const seen = [];
  const env = { INGEST_TOKEN: 'tok', DB: { prepare(sql) {
    const stmt = { bind: (...args) => { seen.push({ sql, args }); return stmt; },
      run: async () => ({ meta: { changes: 0 } }), all: async () => ({ results: [] }), first: async () => null };
    return stmt;
  } } };
  const request = new Request('https://ingest.example/queue/claim', {
    method: 'POST', headers: { Authorization: 'Bearer tok' }, body: '{}' });
  await api(request, env, new URL('https://ingest.example/queue/claim'));
  const sweep = seen.find((s) => /status = 'claimed' AND claimed_at < \?/.test(s.sql));
  assert.ok(sweep, 'the sweep runs on every claim');
  assert.match(sweep.sql, /SET status = 'failed'/);
  assert.doesNotMatch(sweep.sql, /'queued'/, 'a dead run is never re-queued by the code');
  assert.match(sweep.sql, /check every platform by hand/);
  const minutesAgo = (Date.now() - Date.parse(sweep.args[0])) / 60_000;
  assert.ok(minutesAgo > 39 && minutesAgo < 41, `cutoff is 40 minutes back, got ${minutesAgo.toFixed(1)}`);
  assert.ok(seen.indexOf(sweep) < seen.findIndex((s) => /status = 'queued'/.test(s.sql)),
    'the sweep runs before the select, or a dead claim is skipped one more time');
});

/*
 * A dry run hands the item back as 'released', which is not an attempt. It
 * used to come back as 'queued', and three dry runs marked the item failed.
 */
test('a released item goes back to queued without spending an attempt', async () => {
  const { api } = await src('api.js');
  const seen = [];
  const env = { INGEST_TOKEN: 'tok', DB: { prepare(sql) {
    const stmt = { bind: (...args) => { seen.push({ sql, args }); return stmt; },
      run: async () => ({ meta: { changes: 1 } }), first: async () => ({ attempts: 2 }) };
    return stmt;
  } } };
  const request = new Request('https://ingest.example/queue/result', {
    method: 'POST', headers: { Authorization: 'Bearer tok' },
    body: JSON.stringify({ id: 'q1', status: 'released', note: 'dry run' }) });
  const body = await (await api(request, env, new URL('https://ingest.example/queue/result'))).json();
  assert.equal(body.status, 'queued');
  assert.ok(!seen.some((s) => /SET attempts/.test(s.sql)), 'no attempt is counted');
  assert.ok(seen.some((s) => /SET status = 'queued', claimed_at = NULL/.test(s.sql)));
});

test('sync() holds every video on the skip list before any build', () => {
  const s = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'yt-description.js'), 'utf8');
  const fn = s.slice(s.indexOf('async function sync('), s.indexOf('console.log(`${filled} filled'));
  assert.match(fn, /skip = \[\]/, 'sync must read skip from /youtube/pending');
  const hold = fn.indexOf('skipSet.has(id)');
  const build = fn.indexOf('await build(id)');
  assert.ok(hold > 0 && build > 0 && hold < build, 'the hold must come before the first build()');
});

test('the workflow page survives the box never having shipped the table', async () => {
  const { configPage } = await src('pages/config.js');
  const html = configPage({ email: 'm@x.com', tz: TZ, snapshots: {} });
  assert.match(html, /has not shipped the platform table yet/);
});

/* ---------------------------------------------------------------- stats -- */

const DAILY = [
  { date: '2026-08-18', platform: 'facebook', post_count: 1, impressions: 100, reach: 80,
    views: 90, likes: 4, comments: 2, shares: 1, saves: 0, clicks: 3 },
  { date: '2026-08-19', platform: 'youtube', post_count: 1, impressions: 0, reach: 0,
    views: 50, likes: 2, comments: 1, shares: 0, saves: 0, clicks: 0 },
];


/* ---------------------------------------------------------------- queue -- */

test('the queue shows the pace it does not itself decide', async () => {
  const { queuePage } = await src('pages/queue.js');
  const html = queuePage({ email: 'm@x.com', tz: TZ,
    waiting: [{ id: 'q1', status: 'queued', body: 'a post', platforms: '["threads"]',
      first_comment: 1, priority: 0, created_at: new Date().toISOString() }],
    done: [], total: 0,
    pace: { perDay: 6, today: 2, minGapMinutes: 90, tz: TZ, nextAt: 'Fri 09:00', why: null } });
  assert.match(html, /a post/);
  assert.match(html, /Fri 09:00/);
  assert.match(html, /of 6 sent today/);
});

// The bug this pins: fourteen bindings were passed at nine placeholders, and
// the five columns they were meant for were missing from the column list. The
// row still appeared, so the queue looked fine while reshare, its wording, a
// custom comment, the topics and the landscape cut were all silently dropped.
test('every value bound to the queue insert has a column to land in', async () => {
  const { queueAction } = await src('pages/queue.js');
  const seen = {};
  const env = { DB: { prepare(sql) {
    return { bind(...args) { seen.sql = sql; seen.args = args; return { run: async () => {} }; } };
  } } };
  const form = new FormData();
  form.set('do', 'add');
  form.set('body', 'a post');
  form.set('p_linkedin', 'on');
  form.set('reshare', 'on');
  form.set('reshareText', 'my line on top');
  form.set('commentText', 'a custom first comment');
  form.set('topics', '#Invoicing, LatePayments');
  const request = new Request('https://social.example/queue', { method: 'POST', body: form });
  await queueAction(request, env, 'mate@matewishkey.com');

  const placeholders = (seen.sql.match(/\?/g) || []).length;
  assert.equal(seen.args.length, placeholders,
    `${seen.args.length} values bound at ${placeholders} placeholders`);
  for (const col of ['reshare', 'reshare_text', 'comment_text', 'topics', 'media_wide_key']) {
    assert.match(seen.sql, new RegExp(`\\b${col}\\b`), `${col} must be named in the insert`);
  }
  assert.ok(seen.args.includes('my line on top'), 'his words must be bound');
  assert.ok(seen.args.includes('["Invoicing","LatePayments"]'), 'topics must be bound, hash stripped');
});

// "has media" is not a preview. A queued clip is the only thing he cannot check
// anywhere else before it publishes — not on a platform yet, not on his machine.
test('a queued clip is shown, not just announced', async () => {
  const { queuePage } = await src('pages/queue.js');
  const html = queuePage({ email: 'm@x.com', tz: TZ, done: [], total: 0,
    waiting: [{ id: 'q1', status: 'queued', body: 'a post', platforms: '[]',
      media_key: 'queue/2026-08-21-clip.mp4', media_type: 'video/mp4',
      first_comment: 1, priority: 0, created_at: new Date().toISOString() }],
    pace: { perDay: 6, today: 0, minGapMinutes: 90, tz: TZ, nextAt: null, why: null } });
  assert.match(html, /<video src="\/media\/queue%2F2026-08-21-clip\.mp4"/);
  assert.match(html, /controls/);
});

test('a landscape cut is shown beside the vertical one', async () => {
  const { queuePage } = await src('pages/queue.js');
  const html = queuePage({ email: 'm@x.com', tz: TZ, done: [], total: 0,
    waiting: [{ id: 'q1', status: 'queued', body: 'a post', platforms: '[]',
      media_key: 'queue/tall.mp4', media_wide_key: 'queue/wide.mp4', media_type: 'video/mp4',
      first_comment: 1, priority: 0, created_at: new Date().toISOString() }],
    pace: { perDay: 6, today: 0, minGapMinutes: 90, tz: TZ, nextAt: null, why: null } });
  assert.match(html, /queue%2Ftall\.mp4/);
  assert.match(html, /queue%2Fwide\.mp4/);
  assert.match(html, /landscape/);
});

test('no media means no empty preview box', async () => {
  const { queuePage } = await src('pages/queue.js');
  const html = queuePage({ email: 'm@x.com', tz: TZ, done: [], total: 0,
    waiting: [{ id: 'q1', status: 'queued', body: 'text only', platforms: '[]',
      first_comment: 1, priority: 0, created_at: new Date().toISOString() }],
    pace: { perDay: 6, today: 0, minGapMinutes: 90, tz: TZ, nextAt: null, why: null } });
  assert.ok(!html.includes('class="prevs"'), 'no preview container without media');
});

/* ----------------------------------------------------------- retry half -- */

/*
 * Since 34db048 a partially-published item is marked `posted` and never
 * re-queued — re-queueing would post again to the platforms that already have
 * it. That left the failed half with no route back, which is what this covers.
 */
test('only the platforms that did not go are counted as failed', async () => {
  const { failedPlatforms } = await src('pages/queue.js');
  const row = { result: JSON.stringify([
    { platform: 'facebook', status: 'published', url: 'https://fb/1' },
    { platform: 'linkedin', status: 'published', url: 'https://li/1' },
    { platform: 'twitter', status: 'failed', url: null },
  ]) };
  assert.deepEqual(failedPlatforms(row), ['twitter']);
});

// TikTok returns no url ever, and Threads sits at 'processing' for a while.
// Reading either as a failure would repost to a platform that already has it —
// and on TikTok that second copy cannot be deleted.
test('no url is not a failure when the platform never gives one', async () => {
  const { failedPlatforms } = await src('pages/queue.js');
  assert.deepEqual(failedPlatforms({ result: JSON.stringify([
    { platform: 'tiktok', status: 'published', url: null },
    { platform: 'threads', status: 'processing', url: 'https://threads/1' },
  ]) }), []);
});

test('a row with no recorded outcome offers no retry', async () => {
  const { failedPlatforms } = await src('pages/queue.js');
  for (const row of [{}, { result: null }, { result: 'not json' }, { result: '{}' }]) {
    assert.deepEqual(failedPlatforms(row), []);
  }
});

test('the retry button names what is missing and nothing else', async () => {
  const { queuePage } = await src('pages/queue.js');
  const html = queuePage({ email: 'm@x.com', tz: TZ, waiting: [], total: 1,
    done: [{ id: 'q1', status: 'posted', body: 'a post', platforms: '["facebook","twitter"]',
      first_comment: 1, priority: 0, created_at: new Date().toISOString(),
      result: JSON.stringify([
        { platform: 'facebook', status: 'published', url: 'https://fb/1' },
        { platform: 'twitter', status: 'failed', url: null }]) }],
    pace: { perDay: 6, today: 0, minGapMinutes: 90, tz: TZ, nextAt: null, why: null } });
  assert.match(html, /value="retry"/);
  assert.match(html, /Retry 1/);
  assert.match(html, /twitter did not go/);
});

test('queued text cannot inject markup either', async () => {
  const { queuePage } = await src('pages/queue.js');
  const html = queuePage({ email: 'm@x.com', tz: TZ,
    waiting: [{ id: 'q1', status: 'queued', body: '<img src=x onerror=alert(1)>',
      platforms: '[]', first_comment: 0, priority: 0, created_at: new Date().toISOString() }],
    done: [], total: 0,
    pace: { perDay: 6, today: 0, minGapMinutes: 90, tz: TZ, nextAt: null, why: null } });
  assert.ok(!html.includes('<img src=x'), 'the raw tag must not survive');
});

// Auto-fill must not ship my paraphrase of the show to the channel.
/* --------------------------------------------------------------- pager -- */

/*
 * A pager that loses the filter is worse than no pager: "older" would quietly
 * widen what is being read from errors-only back to everything, and the page
 * would look like it had simply found more errors.
 */
test('paging carries every filter with it', async () => {
  const { pager } = await src('lib/html.js');
  const html = pager({ path: '/', params: new URLSearchParams('kind=queue.posted&level=error'),
    page: 2, size: 100, total: 350, noun: 'events' });
  assert.match(html, /kind=queue\.posted/);
  assert.match(html, /level=error/);
  assert.match(html, /101–200 of 350 events/);
  assert.match(html, /page 2 of 4/);
});

test('page one drops the parameter rather than writing p=1', async () => {
  const { pager } = await src('lib/html.js');
  const html = pager({ path: '/', params: new URLSearchParams(''), page: 2, size: 10, total: 30 });
  assert.match(html, /href="\/"/, 'newer from page 2 goes back to the bare path');
  assert.ok(!/p=1\b/.test(html), 'no p=1 in any link');
});

test('the ends of the list are not links', async () => {
  const { pager } = await src('lib/html.js');
  const first = pager({ path: '/', params: '', page: 1, size: 10, total: 30 });
  assert.match(first, /<span>← newer<\/span>/);
  const last = pager({ path: '/', params: '', page: 3, size: 10, total: 30 });
  assert.match(last, /<span>older →<\/span>/);
});

// One page still says how many there are; a bare list leaves you guessing.
test('a single page says the total and offers no navigation', async () => {
  const { pager } = await src('lib/html.js');
  const html = pager({ path: '/queue', params: '', page: 1, size: 25, total: 12, noun: 'posts' });
  assert.match(html, /1–12 of 12 posts/);
  assert.ok(!html.includes('older →'));
});

test('an empty list says so rather than counting to zero', async () => {
  const { pager } = await src('lib/html.js');
  assert.match(pager({ path: '/', params: '', page: 1, size: 25, total: 0, noun: 'events' }),
    /No events yet/);
});

test('a page beyond the end clamps rather than showing an empty table', async () => {
  const { pageOf } = await src('lib/html.js');
  const url = new URL('https://social.example/?p=99');
  assert.equal(pageOf(url, 25, 30), 2);
  assert.equal(pageOf(new URL('https://social.example/?p=nonsense'), 25, 30), 1);
  assert.equal(pageOf(new URL('https://social.example/?p=-4'), 25, 30), 1);
});

/*
 * The hashtag rule is the thing most likely to drift back, because it is a
 * judgement call the model makes on every post. The page states it, so the
 * page should assert it.
 */
test('the workflows page states the hashtag rule, with both sides of it', async () => {
  const { configPage } = await src('pages/config.js');
  const { flows } = require('../scripts/lib/platforms.js');
  const voice = require('../scripts/lib/voice.js');
  const cfg = voice.config();
  const html = configPage({ email: 'm@x.com', tz: TZ, snapshots: {
    platforms: { body: { flows: flows() }, updatedAt: new Date().toISOString() },
    voice: { body: { always: cfg.tags.always, maxTopic: cfg.tags.maxTopic,
      blockedCount: cfg.tags.blocked.length, shortLinkHost: 'mwkshow.com' } } } });

  assert.match(html, /<b>ordinary people, never for technical people<\/b>/);
  assert.match(html, /would someone who does not work in technology/i);
  assert.match(html, /#Xero/, 'the good example he gave');
  assert.match(html, /#Cloudflare/, 'the bad example he gave');
  assert.match(html, /no tag at all is an acceptable answer/);
});

// TikTok and X were publishing into a dead end; the page must not imply
// otherwise now that it is fixed.
test('the workflows page says where each platform\'s link actually goes', async () => {
  const { configPage } = await src('pages/config.js');
  const { flows } = require('../scripts/lib/platforms.js');
  const html = configPage({ email: 'm@x.com', tz: TZ, snapshots: {
    platforms: { body: { flows: flows() }, updatedAt: new Date().toISOString() } } });

  // TikTok has no clickable link anywhere — not the caption, not a comment, and
  // not the bio either on a personal account under 1,000 followers (checked in
  // the app by mate, 2026-09-14). The page said "the bio" for three weeks while
  // every caption claimed a link that was plain text. It must say none.
  const tiktok = html.split('<h2>tiktok</h2>')[1].split('</section>')[0];
  assert.match(tiktok, /none — nothing here is clickable, the bio included/);
  assert.ok(!/the post says so/.test(tiktok), 'TikTok must not claim a bio link');
  // Match the CLAIM, not the explanation: the note legitimately uses the words
  // "a tracked code" while saying why one is not spent here.
  assert.ok(!/with its own tracked code/.test(tiktok), 'no code is minted for TikTok any more');
  assert.ok(!/first-comment|watcher adds/.test(tiktok), 'nothing may suggest a comment reaches TikTok');

  // X is the one that does append its own tracked link to a post it publishes.
  const x = html.split('<h2>twitter</h2>')[1].split('</section>')[0];
  assert.match(x, /appended to the caption, with its own tracked code/);
});

/*
 * One video per post is a hard limit on every platform — Facebook's docs are
 * explicit ("a single video per post", and images and videos cannot be mixed).
 * So a vertical cut and a landscape cut can never ride together, and which
 * platform gets which is a property of the platform, not a guess per post.
 */
test('the vertical surfaces are exactly the ones that reject a landscape cut', async () => {
  const { PLATFORMS, get } = require('../scripts/lib/platforms.js');
  const vertical = Object.keys(PLATFORMS).filter((p) => !get(p).landscapeOk);
  // Pinterest joined on 2026-09-20: a pin is 2:3, 1:1 or 9:16, so the wide cut has no shape there.
  assert.deepStrictEqual(vertical.sort(), ['instagram', 'pinterest', 'threads', 'tiktok']);

  // Instagram is the one the media check enforces independently, so the two
  // statements of the same fact must agree.
  const media = require('../scripts/lib/media.js');
  const landscape = { durationSec: 20, aspect: 1.7778, hasAudio: true, codec: 'h264' };
  assert.ok(media.check('instagram', landscape).length,
    'instagram must reject a landscape clip on aspect alone');
  for (const p of ['facebook', 'youtube', 'linkedin', 'twitter']) {
    assert.deepStrictEqual(media.check(p, landscape), [],
      `${p} is marked landscapeOk so it must actually accept one`);
  }
});


/*
 * "unattributed" on the links table. A code minted before codes were
 * per-platform served all five comment platforms at once, so it carries no
 * platform and never can. The referer is the second route to an answer — and
 * it also catches a link clicked somewhere we never posted it.
 */
test('a referring host maps to the platform it belongs to', async () => {
  const { platformFromReferer } = await src('links.js');
  assert.strictEqual(platformFromReferer('www.facebook.com'), 'facebook');
  assert.strictEqual(platformFromReferer('m.facebook.com'), 'facebook');
  assert.strictEqual(platformFromReferer('l.instagram.com'), 'instagram');
  assert.strictEqual(platformFromReferer('lnkd.in'), 'linkedin');
  assert.strictEqual(platformFromReferer('youtu.be'), 'youtube');
  assert.strictEqual(platformFromReferer('t.co'), 'twitter');
  assert.strictEqual(platformFromReferer('x.com'), 'twitter');
});

// It must not claim a platform it cannot see. A lookalike domain matching
// loosely would attribute clicks to the wrong channel, which is worse than
// admitting we do not know.
test('an unknown or absent referer stays unattributed', () => {
  return src('links.js').then(({ platformFromReferer }) => {
    assert.strictEqual(platformFromReferer('example.com'), null);
    assert.strictEqual(platformFromReferer(''), null);
    assert.strictEqual(platformFromReferer(null), null);
    assert.strictEqual(platformFromReferer('notfacebook.com'), null, 'must anchor, not substring-match');
    assert.strictEqual(platformFromReferer('facebook.com.evil.net'), null);
  });
});

/*
 * The Links page is where he goes to get a link he has to paste somewhere. A
 * code he cannot copy off the screen is a code he cannot use — the whole reason
 * the share pages exist is that text cannot be selected out of a terminal, and
 * the same applies to a table row. So: every row carries a copy button, and it
 * carries the WHOLE url, not the five-character code on its own.
 */
const LINKROWS = [
  { code: 'n0t4d', campaign: 'bio', platform: 'linkedin', medium: 'profile',
    target: 'https://matewishkey.com/show', label: 'LinkedIn personal', human: 3, crawler: 1,
    created_at: new Date().toISOString() },
  { code: '30zc4', campaign: 'book', platform: 'website', medium: 'show-page',
    target: 'https://calendar.google.com/appointments/schedules/AAA', human: 0, crawler: 0,
    created_at: new Date().toISOString() },
];
const LINKCAMPS = [
  { campaign: 'bio', links: 9, human: 3, crawler: 1 },
  { campaign: 'book', links: 2, human: 0, crawler: 0 },
];

test('every link on the page can be copied whole', async () => {
  const { linksPage } = await src('pages/links.js');
  const html = linksPage({ email: 'm@x.com', tz: TZ, host: 'mwkshow.com',
    rows: LINKROWS, campaigns: LINKCAMPS, totals: { links: 11, human: 3, crawler: 1 }, total: 2 });
  for (const r of LINKROWS) {
    assert.ok(html.includes(`data-t="https://mwkshow.com/${r.code}"`),
      `${r.code} has no copy button carrying the full url`);
  }
  assert.ok(!/data-t="[a-z0-9]{5}"/.test(html), 'a copy button carries a bare code, not a url');
});

test('a campaign is shown by what it means, not its column value', async () => {
  const { linksPage } = await src('pages/links.js');
  const html = linksPage({ email: 'm@x.com', tz: TZ, host: 'mwkshow.com',
    rows: LINKROWS, campaigns: LINKCAMPS, totals: { links: 11, human: 3, crawler: 1 }, total: 2 });
  assert.ok(html.includes('Your profiles'), 'the bio campaign is not named in plain English');
  assert.ok(html.includes('Booking a call'), 'the book campaign is not named in plain English');
});

test('the page says which links he has to paste and which write themselves', async () => {
  const { linksPage } = await src('pages/links.js');
  const html = linksPage({ email: 'm@x.com', tz: TZ, host: 'mwkshow.com', rows: LINKROWS,
    campaigns: [...LINKCAMPS, { campaign: 'episode', links: 1, human: 0, crawler: 0 }],
    totals: { links: 12, human: 3, crawler: 1 }, total: 2 });
  assert.ok(html.includes('you paste it'), 'nothing tells him a bio link is his job');
  assert.ok(html.includes('automatic'), 'nothing tells him episode links write themselves');
});

test('the links page still refuses to build a utm', async () => {
  const { linksPage } = await src('pages/links.js');
  const html = linksPage({ email: 'm@x.com', tz: TZ, host: 'mwkshow.com', rows: LINKROWS,
    campaigns: LINKCAMPS, totals: { links: 11, human: 3, crawler: 1 }, total: 2 });
  // Only what is actually a LINK — the explainer on this page mentions
  // "?utm_source=" by name to say we do not use one, and a naive scan of the
  // whole document would trip on our own prose.
  const urls = [...html.matchAll(/(?:href|data-t)="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(urls.length > 4, 'no links were rendered — the assertion below would pass vacuously');
  for (const u of urls) {
    assert.ok(!/utm_source=|utm_medium=|utm_campaign=/.test(u),
      `a utm parameter appeared on a rendered link: ${u}`);
  }
});

/* -------------------------------------------------------------- youtube -- */

/*
 * The bulk approve. What makes it safe is the split: a proposal that changes one
 * line of boilerplate is not the same decision as one that replaces words he
 * wrote, and the button says which it is doing. If tailOnly ever loosened to
 * "mostly the same", "approve the boilerplate swaps" would start approving
 * rewrites — silently, in a batch, over words already published.
 */
const PROP = (over = {}) => ({ video_id: 'abc', title: 'A video', state: 'proposed',
  proposed_at: new Date().toISOString(), current_text: 'one\ntwo\nthree',
  proposed: 'one\nTWO\nthree', ...over });


/*
 * HIS OWN LIKE AND REPOST COME OFF EVERY POST (mate, 2026-09-20). No platform
 * says who liked, so it is the flat deduction he named: 2 likes and 2 shares
 * per platform-post, clamped at zero, before anything is summed. One comment
 * per post comes off where the watcher writes our first comment. The control is the row with no posts, which must pass through
 * untouched — a deduction on a day nothing was posted would invent a debt.
 */
test('two likes and two shares per post are his own and come off, never below zero', async () => {
  const { withoutOwnActions } = await src('pages/stats.js');
  const rows = withoutOwnActions([
    { date: '2026-09-01', platform: 'facebook', post_count: 3, likes: 10, shares: 7, comments: 4, saves: 1 },
    { date: '2026-09-02', platform: 'facebook', post_count: 2, likes: 1, shares: 0, comments: 2, saves: 0 },
    { date: '2026-09-03', platform: 'facebook', post_count: 0, likes: 5, shares: 5, comments: 0, saves: 0 },
  ]);
  assert.deepEqual(rows.map((r) => [r.likes, r.shares, r.comments, r.saves]),
    [[4, 1, 1, 1], [0, 0, 0, 0], [5, 5, 0, 0]]);
});

test('our first comment comes off exactly where the watcher writes one', async () => {
  const { withoutOwnActions, OWN_COMMENT_PLATFORMS } = await src('pages/stats.js');
  const platforms = require('../scripts/lib/platforms');
  const watched = Object.keys(platforms.PLATFORMS).filter((p) => platforms.commentWatched(p)).sort();
  assert.deepEqual([...OWN_COMMENT_PLATFORMS].sort(), watched);
  // TikTok gets no first comment from us, so its comments are all theirs: the control.
  const [tt, yt] = withoutOwnActions([
    { platform: 'tiktok', post_count: 2, comments: 3 },
    { platform: 'youtube', post_count: 2, comments: 3 },
  ]);
  assert.equal(tt.comments, 3);
  assert.equal(yt.comments, 1);
});

/*
 * The box works out which kind of change a proposal is; the ingest door decides
 * whether to believe it. Those are two files, and the door silently rewrites
 * anything it does not recognise to NULL — so a kind added to one and not the
 * other is thrown away with no error, which is exactly what happened to
 * 'append' on the day it was written. Read both and compare.
 */
test('every proposal kind the box files is one the door accepts', () => {
  const read = (...f) => fs.readFileSync(path.join(__dirname, '..', ...f), 'utf8');
  const filed = [...new Set([...read('scripts', 'yt-description.js')
    .matchAll(/kind:\s*'([a-z]+)'/g)].map((m) => m[1]))];
  const list = read('web', 'src', 'api.js').match(/const PROPOSAL_KINDS = \[([^\]]*)\]/);
  assert.ok(list, 'the allow-list must stay findable by name');
  const accepted = [...list[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);

  assert.ok(filed.length >= 3, `expected the three kinds, found ${filed.join(', ')}`);
  for (const kind of filed) {
    assert.ok(accepted.includes(kind),
      `yt-description.js files kind '${kind}' and api.js drops it to null`);
  }
});

test('the sharing card counts real opens and says what it cannot tell him', async () => {
  const { linksPage } = await src('pages/links.js');
  const html = linksPage({ email: 'm@x.com', tz: TZ, host: 'mwkshow.com', rows: LINKROWS,
    campaigns: LINKCAMPS, totals: { links: 11, human: 3, crawler: 1 }, total: 2,
    shares: [{ tag: 'natalie', clicks: 2, last_at: new Date().toISOString() }] });
  assert.match(html, /natalie/);
  // The honesty is the feature. A link that gets forwarded, and a messenger
  // that fetches the url to draw a preview, are both normal.
  assert.match(html, /not that Natalie opened it/);
  assert.match(html, /forwarded/);
});

/*
 * YOUTUBE CHANGED WHAT A VIEW IS ON 24 AUGUST 2026, so a views trend whose
 * older window opens before that date compares two different units — and the
 * newer side is inflated by definition, which is the flattering direction.
 *
 * The page already knows how to refuse a comparison rather than draw a
 * misleading one: a channel younger than the older window gets its start date
 * instead of a percentage. This is the same mechanism, for the same reason.
 */
test('a views trend that crosses the 24 Aug unit change is refused, not drawn', async () => {
  const { viewsUnitBlocked, YT_VIEW_UNIT_CHANGED } = await src('pages/stats.js');
  assert.strictEqual(YT_VIEW_UNIT_CHANGED, '2026-08-24', 'the boundary is the date YouTube states');

  // An older window opening before the change: two units, no percentage.
  assert.match(viewsUnitBlocked('2026-08-12') || '', /unit changed/,
    'a window that straddles the change must give a reason instead of a number');
  assert.match(viewsUnitBlocked('2026-08-23') || '', /unit changed/, 'the day before still straddles it');

  /*
   * Positive control, and it is the half that matters: once the whole window
   * sits after the change, both sides are the same unit and the trend must go
   * back to being a real percentage. A guard that never lifts is just a
   * permanently broken tile.
   */
  assert.strictEqual(viewsUnitBlocked('2026-08-24'), null, 'the change date itself is clean');
  assert.strictEqual(viewsUnitBlocked('2026-09-20'), null, 'a window wholly after it must compare normally');
});


/* ------------------------------------------------- auto-approved proposals -- */

/*
 * EVERY PROPOSAL APPROVES ITSELF (mate, 2026-09-15: "just approve it").
 *
 * The narrower rule it replaces held a 'rebuild' back because a model had
 * written the opening. What this test has to pin now is the pair that is left:
 * every kind goes in approved, AND the decision is still stamped as automatic
 * rather than as his. The second half is the one that would rot quietly — a row
 * that claims HE approved it is a lie the next reader cannot detect.
 */
const proposeVia = async (items) => {
  const { api } = await src('api.js');
  const rows = [];
  const env = {
    INGEST_TOKEN: 'tok',
    DB: {
      prepare(sql) { return { bind: (...args) => { rows.push({ sql, args }); return { sql, args }; } }; },
      batch: async (stmts) => stmts.map(() => ({ meta: { changes: 1 } })),
    },
  };
  const request = new Request('https://ingest.example/youtube/propose', {
    method: 'POST', headers: { Authorization: 'Bearer tok' }, body: JSON.stringify({ items }),
  });
  const res = await api(request, env, new URL('https://ingest.example/youtube/propose'));
  return { rows, body: await res.json() };
};

test('every kind files itself approved, and says a machine did it', async () => {
  const { rows, body } = await proposeVia([
    { videoId: 'swp', kind: 'swap', currentText: 'his words\n\nold tail', proposed: 'his words\n\nnew tail' },
    { videoId: 'apd', kind: 'append', currentText: 'his words', proposed: 'his words\n\nthe blurb' },
    { videoId: 'rbd', kind: 'rebuild', currentText: 'his words', proposed: 'a model wrote this' },
    { videoId: 'non', kind: 'nonsense', currentText: 'x', proposed: 'y' },
  ]);
  assert.equal(rows.length, 4);

  const state = (i) => rows[i].args[4];
  const decidedBy = (i) => rows[i].args[8];
  const decidedAt = (i) => rows[i].args[7];

  for (let i = 0; i < 4; i++) {
    assert.equal(state(i), 'approved', `row ${i} should go straight through now`);
    // An automatic decision must never read as his: the stamp is what a later
    // reader uses to tell "he said yes" from "nobody looked".
    assert.match(String(decidedBy(i)), /^auto:/, `row ${i} must be stamped automatic`);
    assert.ok(decidedAt(i), `row ${i} needs a decided_at or it is approved at no time at all`);
  }
  assert.equal(body.autoApproved, 4, 'the response says how many went straight through');

  // The control that keeps this test honest: it fails for the intended reason
  // if the stamp is ever set to something that reads like a person.
  assert.notEqual(decidedBy(0), 'mate', 'a machine decision must not wear his name');
});

/*
 * REJECTION IS STILL FINAL, AND THAT IS THE ONLY GATE LEFT.
 *
 * With every kind auto-approving, the WHERE clause on the upsert is the whole
 * of his remaining protection: a row he said no to must not come back on the
 * next sync wearing 'approved'. This reads the SQL rather than the state,
 * because the state is now always the same and would pass either way.
 */
test('a rejected row is still excluded from the re-file', async () => {
  const { rows } = await proposeVia([
    { videoId: 'v1', kind: 'swap', currentText: 'a', proposed: 'b' },
  ]);
  const sql = rows[0].sql.replace(/\s+/g, ' ');
  assert.match(sql, /ON CONFLICT\(video_id\) DO UPDATE/, 'still an upsert');
  assert.match(sql, /WHERE yt_proposal\.state = 'proposed'/, 'a waiting row may be replaced');
  assert.ok(!/state = 'rejected'/.test(sql) && !/'rejected'/.test(sql),
    'nothing in the WHERE clause may let a rejected row be revived');
});

/*
 * Same bug class as the queue insert above, and this insert just grew two
 * columns: a binding with no placeholder lands silently and the row still
 * appears. Count them, and pin that a rejection is still final — auto-approve
 * decides the STATE a row is filed in, never whether a "no" gets asked again.
 */
test('the proposal insert binds what it declares, and a rejection stays final', async () => {
  const { rows } = await proposeVia([
    { videoId: 'x', kind: 'swap', currentText: 'a', proposed: 'b' },
  ]);
  const { sql, args } = rows[0];
  assert.equal(args.length, (sql.match(/\?/g) || []).length,
    `${args.length} values bound at ${(sql.match(/\?/g) || []).length} placeholders`);
  for (const col of ['state', 'decided_at', 'decided_by', 'kind']) {
    assert.match(sql, new RegExp(`\\b${col}\\b`), `${col} must be named in the insert`);
  }
  // Positive control on the same read: the guard that reopens a changed row is
  // still there, so finding no 'rejected' below means it is genuinely excluded.
  assert.match(sql, /yt_proposal\.proposed <> excluded\.proposed/, 'the churn guard must survive');
  assert.ok(!/state\s*=\s*'rejected'|'rejected'/.test(sql.split('WHERE')[1] || ''),
    'the WHERE clause never reopens a rejected row');
});

/* --------------------------------------------- age-matched seen and actions -- */

/*
 * THE SETTLE ARTEFACT, AND THE PROOF THAT AGE-MATCHING REMOVES IT.
 *
 * The reason seen and actions lost their arrow on 14 Sep: daily_metric keeps
 * climbing for weeks, so the recent window is read younger than the one before
 * it and a flat channel reads as a fall. These tests build a channel that is
 * EXACTLY FLAT in truth, with a settle curve on top, and assert that the naive
 * sum shows the fake fall while the age-matched sum does not. Without the first
 * half the second proves nothing: a test that only checks the fix passes just
 * as happily when there was never a bug to fix.
 */

/** A series that truly did 100, read at 60% on day one and 100% by day seven. */
const settling = (date, finalValue) => ({
  current: { date, platform: 'facebook', reach: finalValue, updated_at: `${date}T00:00:01Z` },
  revisions: [
    // was 0, replaced 6h in
    { date, platform: 'facebook', reach: 0, written_at: `${date}T00:00:01Z`, superseded_at: `${date}T06:00:00Z` },
    // was 60% of final, replaced at 24h + a bit — so the value live AT 24h is this one
    { date, platform: 'facebook', reach: Math.round(finalValue * 0.6), written_at: `${date}T06:00:00Z`,
      superseded_at: `${date}T30:00:00Z`.replace('T30', 'T23') },
    { date, platform: 'facebook', reach: Math.round(finalValue * 0.6), written_at: `${date}T23:00:00Z`,
      superseded_at: new Date(Date.parse(`${date}T00:00:00Z`) + 2 * 86400_000).toISOString() },
  ],
});


/* ------------------------------------------------------------- the funnel -- */

/*
 * A STAGE WE CANNOT SEE MUST NOT BE PRINTED AS A ZERO.
 *
 * The booking calendar is Google's and reports nothing back, so "nobody booked"
 * and "we cannot see bookings" are different claims and only the second is
 * ours. A 0 in that row would be a measurement we invented to complete a
 * picture, and it is exactly the shape of error this page exists to refuse.
 *
 * The other half: the social-click row is NOT a parent of the booking rows.
 * The buttons live on his own site, so most people pressing them never touched
 * one of our links. A percentage between those rows would claim a path the data
 * cannot trace, so there must not be one.
 */
const FUNNEL = [
  { stage: 'social', all_time: 38, recent: 38, first_seen: '2026-08-21', last_seen: '2026-09-15', days: 12 },
  { stage: '30zc4', all_time: 43, recent: 43, first_seen: '2026-08-24', last_seen: '2026-09-14', days: 19 },
  { stage: 'g9q8j', all_time: 14, recent: 14, first_seen: '2026-08-24', last_seen: '2026-09-13', days: 9 },
];


/*
 * RELATIVE FIXTURE, DELIBERATELY. This test read a hard-coded 2026-08-21 as
 * "recent" and went red on 2026-09-21, the day that date fell out of the
 * rolling 30-day window — the page was behaving exactly as designed. A test
 * whose fixture ages against a relative window passes until a date and then
 * lies, so the first click is anchored to today instead.
 */
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);


/*
 * A LINK'S CLICK COUNT IS ALL TIME, AND THAT IS RIGHT, BUT IT GETS READ AS
 * "recently" (mate, 2026-09-15: "I need report always vs last 1 months"). A code
 * minted in August that earned three clicks in August and none since looks
 * identical to one earning three a week. Two columns, so the question "is this
 * still working" has somewhere to be asked.
 */
test('every link row carries all-time clicks and the last 30 days beside it', async () => {
  const { linksPage } = await src('pages/links.js');
  const html = linksPage({ email: 'm@x.com', tz: TZ, host: 'mwkshow.com', totals: { human: 9 },
    campaigns: [{ campaign: 'clip', links: 4, human: 9, human_recent: 2 }],
    rows: [{ code: 'abc', target: 'https://x.test/', campaign: 'clip', human: 7, human_recent: 1,
      crawler: 3, created_at: '2026-08-01T00:00:00Z' }] });
  assert.match(html, /<th class="num">last 30d<\/th>/, 'the column is labelled on the link table');
  assert.match(html, />7</, 'all time still shows');
  assert.match(html, />1</, 'and the recent count beside it');
});

test('the campaign summary gets the same two columns', () => {
  const s = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'web', 'src', 'pages', 'links.js'), 'utf8');
  assert.match(s, /c\.human_recent/, 'a campaign total that is all-time only answers half the question');
  const sql = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'web', 'src', 'index.js'), 'utf8');
  assert.match(sql, /AS human_recent/, 'and the query has to actually compute it');
  assert.match(sql, /date\('now','-30 days'\)/,
    'the window is computed in SQLite, because the optional WHERE shifts every placeholder number');
});

/*
 * THE LATEST POSTS CARD (2026-09-24): one row per post, our own hands off,
 * the age on every row, show and course clicks apart.
 */
test('the latest posts card shows each post per platform, with our own actions taken off', async () => {
  const { latestPostsCard } = await src('pages/stats.js');
  const now = Date.parse('2026-09-23T05:35:00Z');
  const html = latestPostsCard({ tz: TZ, now,
    posts: [{ title: 'How I spot a candidate reading AI answers', publishedAt: '2026-09-22T23:35:00Z',
      platforms: [
        { platform: 'facebook', views: 287, impressions: 287, likes: 3, comments: 1, shares: 0, saves: 0 },
        { platform: 'tiktok', views: 90, impressions: 0, likes: 0, comments: 2, shares: 0, saves: 0 },
        { platform: 'linkedin', views: 0, impressions: 52, likes: 2, comments: 1, shares: 2, saves: 0 },
      ] }],
    postClicks: [{ body: 'How I spot a candidate reading AI answers\n\nThe answers were right', show: 1, course: 2 }] });
  assert.match(html, /6h old/);
  assert.match(html, />287<div class="faint den">1 did<\/div>/, 'facebook: 3 likes - 2 own, 1 comment - 1 ours');
  assert.match(html, />90<div class="faint den">2 did<\/div>/, 'tiktok gets no first comment from us, so its 2 are real');
  assert.match(html, />52<\/td>/, 'linkedin has no views, so impressions; every action there was ours');
  assert.match(html, /<b>429<\/b>/, 'seen is summed across the platforms');
  assert.match(html, /1 <span class="faint">\+ 2 course<\/span>/, 'show and course clicks are kept apart');
});

test('a platform a post never went to reads as a dash, not a zero', async () => {
  const { latestPostsCard } = await src('pages/stats.js');
  const html = latestPostsCard({ tz: TZ, now: Date.parse('2026-09-24T00:00:00Z'), posts: [
    { title: 'A', publishedAt: '2026-09-23T00:00:00Z', platforms: [{ platform: 'facebook', views: 5 }, { platform: 'tiktok', views: 7 }] },
    { title: 'B', publishedAt: '2026-09-22T00:00:00Z', platforms: [{ platform: 'pinterest', views: 0, impressions: 0 }] },
  ] });
  const b = html.slice(html.indexOf('<b>B</b>'));
  assert.equal((b.match(/<td class="num faint">—<\/td>/g) || []).length, 2, 'B went to Pinterest only');
  assert.match(html.slice(html.indexOf('<b>A</b>'), html.indexOf('<b>B</b>')), /<td class="num faint">—<\/td>/,
    'A never went to Pinterest');
});

test('a TikTok title arriving with its tags attached still finds its clicks', async () => {
  const { latestPostsCard } = await src('pages/stats.js');
  const html = latestPostsCard({ tz: TZ, now: Date.parse('2026-09-24T00:00:00Z'),
    posts: [{ title: 'Fastest Job Interview Ever', publishedAt: '2026-09-21T22:30:00Z',
      platforms: [{ platform: 'youtube', views: 10 }] }],
    postClicks: [{ body: 'Fastest Job Interview Ever #hiring @thechrisgoor', show: 4, course: 0 }] });
  assert.match(html, /<td class="num">4<\/td>/);
});


/*
 * The admin mark (2026-09-24): each admin page wears its own colour as a FRAME
 * round the RedBlock, never by recolouring it — the RedBlock is the only logo
 * and it is always #e2342b (scripts/reality-check/brandkit.js).
 */
test('the admin mark frames the red block in the page colour and never recolours it', async () => {
  const { adminMark, ADMIN_COLOR, layout } = await src('lib/html.js');
  for (const color of [ADMIN_COLOR, '#0d9488']) {
    const svg = adminMark(color);
    assert.match(svg, new RegExp(`<rect width="64" height="64" fill="${color}"/>`));
    assert.match(svg, /<rect x="8" y="8" width="48" height="48" fill="#e2342b"\/>/, 'the block stays brand red');
  }
  const page = layout({ title: 'Stats', path: '/stats', email: 'm', tz: TZ, body: '' });
  assert.match(page, /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,/);
  assert.match(page, new RegExp(`border-top:4px solid ${ADMIN_COLOR}`));
});
