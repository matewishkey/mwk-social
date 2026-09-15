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

// One channel's row out of the side-by-side table.
const chanRow = (html, platform) => {
  const at = html.indexOf(`<b>${platform}</b>`);
  return at < 0 ? '' : html.slice(at, html.indexOf('</tr>', at));
};

/*
 * Each channel's "seen" number is whichever measurement it actually reports,
 * and the row has to SAY which — reach counts unique accounts, impressions
 * count every appearance on a screen, and a play is neither. Naming the
 * denominator inline is the whole defence against ranking them against each
 * other.
 */
test('every channel names the measurement its own number is', async () => {
  const { statsPage } = await src('pages/stats.js');
  const { flows } = require('../scripts/lib/platforms.js');
  const html = statsPage({ email: 'm@x.com', tz: TZ, daily: DAILY, followers: [], clicks: [],
    snapshots: { platforms: { body: { flows: flows() } } } });

  // YouTube reports no reach at all, so calling its number reach would be a
  // structural zero pretending to be a measurement.
  const youtube = chanRow(html, 'youtube');
  assert.ok(youtube, 'youtube should have a row');
  assert.match(youtube, /plays/, "youtube's number is plays, and must say so");
  assert.ok(!/unique people|of reach/.test(youtube), 'youtube must not claim reach');

  // Facebook does report reach, and its row must name that instead.
  const facebook = chanRow(html, 'facebook');
  assert.match(facebook, /unique people/, "facebook's number is reach, and must say so");
  assert.match(facebook, /of reach/);
});

/*
 * The two comparable columns have to stay marked as the comparable ones. They
 * are the answer to "which of these numbers can I put side by side" — every
 * other column on the row is on a scale of its own.
 */
test('the table marks which columns actually compare across channels', async () => {
  const { statsPage } = await src('pages/stats.js');
  const html = statsPage({ email: 'm@x.com', tz: TZ, daily: DAILY, followers: [], clicks: [],
    snapshots: {} });
  assert.match(html, /class="cmp">per post/);
  assert.match(html, /class="cmp">clicks \(our links\)/);
  assert.match(html, /only ones that compare across channels/);
  // And the reason has to travel with them, or it is decoration.
  assert.match(html, /24 August 2026/, 'the YouTube view-counting change is why a play is not a play');
});

test('channels with almost no followers are left off the trend on purpose', async () => {
  const { statsPage } = await src('pages/stats.js');
  const html = statsPage({ email: 'm@x.com', tz: TZ, daily: DAILY, clicks: [],
    followers: [{ platform: 'linkedin', username: 'matevisky', followers: 2151 },
      { platform: 'threads', username: 'mwk', followers: 0 }],
    snapshots: {} });
  assert.match(html, /2\.2k|2151/);
  assert.match(html, /under ten followers/);
  assert.match(html, /threads/);
});

/*
 * daily_metric is one row per PLATFORM, so summing post_count counts a single
 * clip once per platform it went to. Off two weeks of real data that read as
 * "30.6 posts a week", which is nonsense. Cadence is days-we-posted instead.
 */
test('cadence counts days we posted, not platform-posts', async () => {
  const { statsPage } = await src('pages/stats.js');
  // One clip a day for 7 days, each going to four platforms: 28 rows, 7 days.
  const rows = [];
  for (let d = 1; d <= 7; d++) {
    for (const platform of ['facebook', 'instagram', 'tiktok', 'threads']) {
      rows.push({ date: `2026-08-0${d}`, platform, post_count: 1, impressions: 10,
        reach: 10, views: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0 });
    }
  }
  const html = statsPage({ email: 'm@x.com', tz: TZ, daily: rows, followers: [], clicks: [], snapshots: {} });
  const cadence = html.match(/<b>([\d.]+)<\/b>\s*<span>days a week we post<\/span>/);
  assert.ok(cadence, 'the cadence tile should render');
  assert.equal(cadence[1], '7.0', `posted every day for a week, got ${cadence[1]}`);
});

// A gap day is still a day that went by; the divisor is the span, not the
// number of dates carrying data.
test('the window is the real span, gaps included', async () => {
  const { statsPage } = await src('pages/stats.js');
  const rows = [
    { date: '2026-08-01', platform: 'facebook', post_count: 1, impressions: 5, reach: 5,
      views: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0 },
    { date: '2026-08-15', platform: 'facebook', post_count: 1, impressions: 5, reach: 5,
      views: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0 },
  ];
  const html = statsPage({ email: 'm@x.com', tz: TZ, daily: rows, followers: [], clicks: [], snapshots: {} });
  assert.match(html, /Last 15 days/, 'two dates a fortnight apart is 15 days, not 2');
});

test('with no clicks the page says why there is nothing to show', async () => {
  const { statsPage } = await src('pages/stats.js');
  const html = statsPage({ email: 'm@x.com', tz: TZ, daily: [], followers: [], clicks: [], snapshots: {} });
  assert.match(html, /Only Facebook reports clicks natively/);
  assert.match(html, /none have been minted/, 'with no links at all, say so');
});

/* ------------------------------------------------------- stats: trends -- */

/*
 * Every one of these three lies in the FLATTERING direction, which is why each
 * gets a positive control: a guard that cannot fail is not a guard, and the
 * cheapest way to prove one works is to break it and watch the test go red.
 */

// The day the page is rendered, and the days either side of it.
const isoDay = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const row = (date, over = {}) => ({
  date, platform: 'facebook', post_count: 1, impressions: 0, reach: 0, views: 0,
  likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, ...over,
});
// The whole tile block, found by its label — the value sits BEFORE the label
// and the trend pill AFTER it, so either half alone finds only one of them.
const tileFor = (html, label) => (html.split('<div class="tile')
  .find((part) => part.includes(`<span>${label}</span>`)) || '');
// The clicks tile is the observable for the window logic since 2026-09-14:
// reach and actions no longer carry an arrow at all (they keep settling for
// weeks), and a click is stamped the moment it happens, so its arrow is real.
const clicksPill = (html) => {
  const pills = tileFor(html, 'link clicks from social').match(/<span class="pill [^"]*">([^<]*)<\/span>/g) || [];
  return pills.length ? pills[pills.length - 1] : '';
};
const clicksOn = (pairs) => pairs.map(([d, n]) => ({ day: d, n }));

/*
 * A morning is not a week. Today's numbers are still arriving, so putting them
 * against seven complete days draws a change that is only the clock — and it
 * would read as a collapse every morning and a recovery every night.
 */
test('today is in neither comparison window', async () => {
  const { statsPage } = await src('pages/stats.js');
  const steady = [[isoDay(-8), 10], [isoDay(-1), 10]];
  const daily = [row(isoDay(-8)), row(isoDay(-1))];

  const withToday = statsPage({ email: 'm@x.com', tz: TZ, clicks: [], followers: [], snapshots: {},
    daily, split: [{ bot: 0, n: 1 }], clicksByDay: clicksOn([...steady, [isoDay(0), 1000]]) });
  assert.match(clicksPill(withToday), /about the same/,
    'a huge partial day must not move a week-on-week figure');

  // Positive control: the SAME spike one day earlier is a complete day, and it
  // must move the number. Without this the assertion above would also pass on a
  // page that had simply stopped comparing anything.
  const withYesterday = statsPage({ email: 'm@x.com', tz: TZ, clicks: [], followers: [], snapshots: {},
    daily, split: [{ bot: 0, n: 1 }], clicksByDay: clicksOn([...steady, [isoDay(-2), 1000]]) });
  assert.doesNotMatch(clicksPill(withYesterday), /about the same/,
    'a complete day inside the window must still count');
});

/*
 * TikTok's first row is 17 Aug. Compare its last seven days against the seven
 * before and the denominator is one day of data, so a channel that did nothing
 * new reads as several hundred percent up.
 */
test('a channel with no history behind the older window shows its start date, not a percentage', async () => {
  const { statsPage } = await src('pages/stats.js');
  const daily = [row(isoDay(-8), { reach: 10 }), row(isoDay(-2), { reach: 400 })];

  const young = statsPage({ email: 'm@x.com', tz: TZ, clicks: [], followers: [], snapshots: {},
    daily, platformSince: { facebook: isoDay(-3) } });
  assert.match(chanRow(young, 'facebook'), /since /, 'name the start date');
  assert.doesNotMatch(chanRow(young, 'facebook'), /[+-]\d+%/,
    'a channel younger than the comparison must not be given a percentage');

  // Positive control: the same numbers from a channel that WAS reporting before
  // the older window opened get the OTHER reason — "still settling" — and no
  // percentage either. Since 2026-09-14 no channel row carries an arrow on seen:
  // daily_metric is lifetime accrual by publish date and a Facebook day is
  // three-quarters of its final number at midnight, so every arrow pointed down.
  const old = statsPage({ email: 'm@x.com', tz: TZ, clicks: [], followers: [], snapshots: {},
    daily, platformSince: { facebook: isoDay(-60) } });
  assert.match(chanRow(old, 'facebook'), /still settling/,
    'a channel with history says why it has no arrow');
  assert.doesNotMatch(chanRow(old, 'facebook'), /[+-]\d+%/,
    'seen never gets a percentage — it is not settled for weeks');
  assert.doesNotMatch(chanRow(young, 'facebook'), /still settling/,
    '"too new" beats "still settling": a channel with no older window has nothing to settle against');
});

/*
 * The one that would have been believed. A third LinkedIn account was connected
 * on 22 Aug carrying 5,040 followers — summed, that is +5,043 overnight and the
 * best week the show has ever had. It is an integration, not an audience.
 */
test('an account connected part-way through is not counted as growth', async () => {
  const { statsPage } = await src('pages/stats.js');
  const followerHistory = [
    { day: isoDay(-3), account_id: 'a', platform: 'facebook', username: 'mwk', followers: 89 },
    { day: isoDay(-1), account_id: 'a', platform: 'facebook', username: 'mwk', followers: 91 },
    // Connected on the last day only, bringing an audience with it.
    { day: isoDay(-1), account_id: 'b', platform: 'linkedin', username: 'Zsuzsanna', followers: 5040 },
  ];
  const html = statsPage({ email: 'm@x.com', tz: TZ, daily: [], clicks: [], snapshots: {},
    followers: [], followerHistory, accountSince: { a: isoDay(-3), b: isoDay(-1) } });

  const tile = tileFor(html, 'followers');
  assert.match(tile, /<b>91<\/b>/, 'the total must be the accounts held throughout, not 5,131');
  assert.ok(!/5131|5\.1k/.test(tile), 'a connection must never be folded into the total');
  assert.match(html, /Zsuzsanna/, 'and the account left out has to be named, not silently dropped');
  assert.match(html, /connected part-way through/);
});

/*
 * A bar chart that skips its empty days draws them as if they never happened:
 * two posts a week apart sit side by side and the gap disappears — and the gap
 * is the thing worth seeing, because cadence is the lever we control.
 */
test('the reach chart draws every day in the span, not only the days with rows', async () => {
  const { statsPage } = await src('pages/stats.js');
  const html = statsPage({ email: 'm@x.com', tz: TZ, clicks: [], followers: [], snapshots: {},
    daily: [row('2026-08-01', { reach: 5 }), row('2026-08-10', { reach: 5 })] });
  const chart = html.split('Reach by day')[1].split('</svg>')[0];
  assert.equal((chart.match(/<rect/g) || []).length, 10,
    'first to last inclusive is ten bars, eight of them empty');
});

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
  assert.deepStrictEqual(vertical.sort(), ['instagram', 'threads', 'tiktok']);

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

// The click card must never present crawler traffic as people. It said "18
// clicks" on the first live post when every one of them was a preview fetch.
test('the stats page separates people from crawlers and says so', async () => {
  const { statsPage } = await src('pages/stats.js');
  const html = statsPage({ email: 'm@x.com', tz: TZ, daily: [], followers: [], clicks: [],
    targets: [{ target: 'https://github.com/matewishkey/mwk-og-image-generator', n: 0, codes: 3 }],
    split: [{ bot: 1, n: 1 }, { bot: 2, n: 37 }], links: 9, snapshots: {} });

  assert.match(html, /<b>0<\/b>\s*<span>link clicks from social<\/span>/, 'zero people is what to show');
  assert.match(html, /38 not counted/, 'and the ignored traffic is named, not hidden');
  assert.match(html, /link-preview crawler/);
  assert.match(html, /logged before this was measured/);
  assert.ok(!/<b>38<\/b>\s*<span>link clicks/.test(html), 'the total must never be shown as clicks');
});

test('the stats page names the destination, not just the channel', async () => {
  const { statsPage } = await src('pages/stats.js');
  const html = statsPage({ email: 'm@x.com', tz: TZ, daily: [], followers: [],
    clicks: [{ platform: 'instagram', n: 4 }],
    targets: [{ target: 'https://matewishkey.com/show', n: 3, codes: 2 },
      { target: 'https://www.youtube.com/watch?v=abc', n: 1, codes: 1 }],
    split: [{ bot: 0, n: 4 }], links: 5, snapshots: {} });
  assert.match(html, /the sign-up page/);
  assert.match(html, /a video on YouTube/);
  assert.match(html, /What they clicked/);
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
 * The site-wide "engagement rate" divided actions from every channel by reach
 * from the three that report it — seven channels on top, three underneath. On
 * the real window that read 5.5% where the same-set figure was 3.8%, and even
 * that mixes unique-accounts with plays.
 *
 * Actions per post divides two numbers that mean the same thing on every
 * channel, so it is the one headline that survives being compared over time.
 */
test('the headline quality number cannot mix denominators', async () => {
  const { statsPage } = await src('pages/stats.js');
  // Two channels: one reports reach, one reports nothing but views. Both earn
  // actions. Ten platform-posts, twenty actions => 2.0 per post, whatever each
  // channel happens to expose.
  const rows = [
    { date: isoDay(-3), platform: 'facebook', post_count: 5, reach: 100, impressions: 0,
      views: 0, likes: 10, comments: 0, shares: 0, saves: 0, clicks: 0 },
    { date: isoDay(-3), platform: 'youtube', post_count: 5, reach: 0, impressions: 0,
      views: 9999, likes: 10, comments: 0, shares: 0, saves: 0, clicks: 0 },
  ];
  const html = statsPage({ email: 'm@x.com', tz: TZ, daily: rows, followers: [], clicks: [],
    snapshots: {} });

  const tile = tileFor(html, 'actions per post');
  assert.ok(tile, 'the headline tile should be actions per post');
  assert.match(tile, /<b>2\.0<\/b>/, '20 actions over 10 posts is 2.0, whatever the reach was');

  // YouTube's 9,999 views must not touch it. Under the old formula the
  // denominator was facebook's reach alone and youtube's actions still counted.
  const noViews = statsPage({ email: 'm@x.com', tz: TZ, followers: [], clicks: [], snapshots: {},
    daily: rows.map((r) => ({ ...r, views: r.views ? 1 : 0 })) });
  assert.match(tileFor(noViews, 'actions per post'), /<b>2\.0<\/b>/,
    'changing a denominator nothing should depend on moved the headline');

  // And the page must not still be claiming a site-wide percentage.
  assert.ok(!/<span>engagement rate<\/span>/.test(html),
    'the mixed-denominator rate is back on the page');
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

/*
 * The site-wide "video views" total sums YouTube and TikTok, so it carries
 * YouTube's unit change even though the tile never says YouTube. It must be
 * wired to the same guard — and only when YouTube actually contributed to the
 * older window, or the caveat would sit on a number YouTube had no part in.
 */
test('the site-wide views tile is wired to the same guard, and only when youtube is in it', () => {
  const s = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'web', 'src', 'pages', 'stats.js'), 'utf8');
  assert.match(s, /ytViewsBlocked/, 'the site-wide total needs its own blocked value');
  assert.match(s, /r\.platform === 'youtube' && r\.views/,
    'it must check youtube actually reported views in the older window');
  // The tile carries no arrow since 2026-09-14 (views keep settling); the
  // week-on-week row is where the guard lives now, and it must still win over
  // the generic "still settling" — naming the unit change is the more specific
  // truth, and a reader deciding whether to trust a views trend needs it.
  assert.match(s, /'video views', recent\.views, prior\.views, num, ytViewsBlocked \|\| SETTLING/,
    'the week-on-week row must pass it first, or the guard is declared and never read');
  assert.ok(!/change\(recent\.views, prior\.views/.test(s),
    'the views tile no longer draws a trend at all');
});

/*
 * THE SOCIAL CLICK NUMBERS EXCLUDE THE WEBSITE'S OWN CODES (2026-09-14). The two
 * booking buttons on matewishkey.com were 56 of 91 counted hits all-time and
 * 16 of 16 in a week the tile read "16 link clicks (people)" — every one a
 * press by somebody already on the site, none brought there by a post. They
 * get their own card, called what they are.
 */
test('website button presses are their own card and never in the social click numbers', async () => {
  const { statsPage } = await src('pages/stats.js');
  const html = statsPage({ email: 'm@x.com', tz: TZ, daily: [], followers: [], clicks: [],
    split: [{ bot: 0, n: 2 }], snapshots: {},
    website: [{ code: '30zc4', note: 'Public Show pre-talk', n: 40 }] });
  assert.match(html, /On the website/);
  assert.match(html, /Public Show pre-talk/);
  assert.match(html, /<td class="num">40<\/td>/);
  assert.match(html, /<b>2<\/b>\s*<span>link clicks from social<\/span>/,
    'the social tile shows the social count, not 42');
  assert.match(html, /Not clicks\s+from social/);

  // And the queries that feed the social numbers all say so. Positive control:
  // the website card's own query names platform = 'website' the other way.
  const src_ = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'web', 'src', 'index.js'), 'utf8');
  const block = src_.slice(src_.indexOf('const SOCIAL ='), src_.indexOf('// Fold the two attribution routes'));
  const social = (block.match(/\$\{SOCIAL\}/g) || []).length;
  assert.ok(social >= 4, `clicks, targets, split and clicksByDay must all exclude the website (found ${social})`);
  assert.match(block, /l\.platform = 'website'/, 'the website card reads the other side of the same line');
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
