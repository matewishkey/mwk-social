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
  assert.match(html, /your turn/, 'Facebook resharing is manual');
  assert.match(html, /automatic/, 'LinkedIn resharing is not');
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
  assert.match(html, /company page/);
  assert.match(html, /Your turn/, 'facebook resharing lands on the overview');
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
const reachPill = (html) => {
  const pills = tileFor(html, 'people reached').match(/<span class="pill [^"]*">([^<]*)<\/span>/g) || [];
  return pills.length ? pills[pills.length - 1] : '';
};

/*
 * A morning is not a week. Today's numbers are still arriving, so putting them
 * against seven complete days draws a change that is only the clock — and it
 * would read as a collapse every morning and a recovery every night.
 */
test('today is in neither comparison window', async () => {
  const { statsPage } = await src('pages/stats.js');
  const steady = [row(isoDay(-8), { reach: 100 }), row(isoDay(-1), { reach: 100 })];

  const withToday = statsPage({ email: 'm@x.com', tz: TZ, clicks: [], followers: [], snapshots: {},
    daily: [...steady, row(isoDay(0), { reach: 10000 })] });
  assert.match(reachPill(withToday), /about the same/,
    'a huge partial day must not move a week-on-week figure');

  // Positive control: the SAME spike one day earlier is a complete day, and it
  // must move the number. Without this the assertion above would also pass on a
  // page that had simply stopped comparing anything.
  const withYesterday = statsPage({ email: 'm@x.com', tz: TZ, clicks: [], followers: [], snapshots: {},
    daily: [...steady, row(isoDay(-2), { reach: 10000 })] });
  assert.doesNotMatch(reachPill(withYesterday), /about the same/,
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
  // the older window opened do get a percentage.
  const old = statsPage({ email: 'm@x.com', tz: TZ, clicks: [], followers: [], snapshots: {},
    daily, platformSince: { facebook: isoDay(-60) } });
  assert.match(chanRow(old, 'facebook'), /[+-]\d+%/,
    'a channel with real history behind it should get a real percentage');
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

/* -------------------------------------------------------------- youtube -- */

test('a description proposal shows both versions and does nothing on its own', async () => {
  const { youtubePage } = await src('pages/youtube.js');
  const html = youtubePage({ email: 'm@x.com', tz: TZ, snapshots: {}, settled: [], total: 0,
    waiting: [{ video_id: 'abc123', title: 'Episode 3', current_text: 'old words',
      proposed: 'new words', state: 'proposed', proposed_at: new Date().toISOString() }] });
  assert.match(html, /old words/);
  assert.match(html, /new words/);
  assert.match(html, /Use the new one/);
  assert.match(html, /Keep what's there|Keep what&#39;s there/);
});

// Auto-fill must not ship my paraphrase of the show to the channel.
test('auto-fill announces itself as paused until the blurb is chosen', async () => {
  const { youtubePage } = await src('pages/youtube.js');
  const html = youtubePage({ email: 'm@x.com', tz: TZ, waiting: [], settled: [], total: 0,
    snapshots: { voice: { body: { blurbChosen: false } } } });
  assert.match(html, /Auto-fill is paused/);
});

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

  // TikTok has no clickable link anywhere, so the page must say the bio — not
  // a tracked code, which is what it said while the codes were being wasted.
  const tiktok = html.split('<h2>tiktok</h2>')[1].split('</section>')[0];
  assert.match(tiktok, /the bio — the post says so, and no code is minted/);
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

  assert.match(html, /<b>0<\/b>\s*<span>link clicks<\/span>/, 'zero people is what to show');
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

test('one changed line is a boilerplate swap; anything else is a rewrite', async () => {
  const { tailOnly } = await src('pages/youtube.js');
  assert.equal(tailOnly(PROP()), true, 'a single changed line should count as a swap');
  assert.equal(tailOnly(PROP({ proposed: 'one\nTWO\nTHREE' })), false, 'two changed lines is a rewrite');
  assert.equal(tailOnly(PROP({ proposed: 'one\ntwo\nthree\nfour' })), false, 'an added line is a rewrite');
  assert.equal(tailOnly(PROP({ proposed: 'one\nthree' })), false, 'a removed line is a rewrite');
  assert.equal(tailOnly(PROP({ proposed: 'one\ntwo\nthree' })), false, 'no change is not a swap');
  assert.equal(tailOnly(PROP({ current_text: '', proposed: 'anything' })), false,
    'filling an empty description is not a one-line swap');
});

test('the bulk buttons count the swaps and the rewrites separately', async () => {
  const { youtubePage } = await src('pages/youtube.js');
  const waiting = [PROP({ video_id: 'a' }), PROP({ video_id: 'b' }),
    PROP({ video_id: 'c', proposed: 'wholly\ndifferent\nwords\nhere' })];
  const html = youtubePage({ email: 'm@x.com', tz: TZ, waiting, settled: [],
    snapshots: { voice: { body: { blurbChosen: true } } }, byState: {} });
  assert.match(html, /Approve the 2 boilerplate changes/);
  assert.match(html, /Approve all 3, rewrites included/);
  assert.match(html, /value="approve-tails"/);
  assert.match(html, /value="approve-all"/);
  // The pill is what tells him WHICH is which before he clicks either.
  assert.equal((html.match(/>boilerplate</g) || []).length, 2);
  assert.equal((html.match(/>rewritten</g) || []).length, 1);
});

test('a single proposal gets no bulk bar at all', async () => {
  const { youtubePage } = await src('pages/youtube.js');
  const html = youtubePage({ email: 'm@x.com', tz: TZ, waiting: [PROP()], settled: [],
    snapshots: { voice: { body: { blurbChosen: true } } }, byState: {} });
  assert.ok(!html.includes('approve-tails'), 'one proposal does not need approving in bulk');
});

/*
 * `kind` beats the diff, and this is why the diff cannot be the only answer.
 *
 * The line-count proxy is right only while the boilerplate happens to be one
 * line. The brand update on 2026-08-24 made the blurb's opening three lines, so
 * every proposal became a multi-line diff — while each video's own summary was
 * untouched. Labelling those "rewritten" lies in the expensive direction: he
 * clicks through 23 diffs to approve nothing he needed to read, or stops
 * trusting the label and approves everything without looking.
 */
test('the box says which kind it is, and that beats the diff', async () => {
  const { boilerplateOnly } = await src('pages/youtube.js');
  const multiline = { current_text: 'a\nb\nc', proposed: 'X\nY\nc' };
  assert.equal(boilerplateOnly({ ...multiline }), false,
    'without a kind, a multi-line diff is a rewrite — the fallback');
  assert.equal(boilerplateOnly({ ...multiline, kind: 'swap' }), true,
    'a swap is boilerplate however many lines the blurb spans');
  assert.equal(boilerplateOnly({ current_text: 'a\nb', proposed: 'a\nZ', kind: 'rebuild' }), false,
    'a rebuild is a rewrite even when it happens to touch one line');
});

test('a swap filed with no kind still reads as boilerplate', async () => {
  const { boilerplateOnly } = await src('pages/youtube.js');
  // Every row filed before the column existed. The fallback must keep working.
  assert.equal(boilerplateOnly({ current_text: 'one\ntwo\nthree', proposed: 'one\nTWO\nthree' }), true);
});

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

/*
 * An append is what a video gets when YouTube never captioned it: there is no
 * transcript, so there is no summary to write, and his own words stay exactly
 * as they are with the show blurb added underneath. Nothing of his is replaced.
 */
test('an appended blurb keeps his words, so it is not a rewrite', async () => {
  const { boilerplateOnly, tailOnly } = await src('pages/youtube.js');
  const append = { current_text: 'his own words', kind: 'append',
    proposed: 'his own words\n\nWhy let others solve your problems with AI?\nPrompt it yourself!' };
  assert.equal(boilerplateOnly(append), true);
  // The positive control is the fallback disagreeing: added lines read as a
  // rewrite to the diff, which is why the label has to be believed over it.
  assert.equal(tailOnly(append), false,
    'the diff proxy calls this a rewrite — the kind is what makes it right');
  // And his words must genuinely survive, or "append" is the wrong word for it.
  assert.ok(append.proposed.startsWith(append.current_text));
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
  assert.match(s, /change\(recent\.views, prior\.views, ytViewsBlocked\)/,
    'the tile must pass it, or the guard is declared and never read');
});
