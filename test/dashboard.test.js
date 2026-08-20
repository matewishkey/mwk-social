/*
 * The dashboard's markup. The Worker's other paths need Access headers or a D1
 * binding to exercise; the rendering does not, and it is the part where a
 * mistake is silent — a wrong status colour or an unescaped caption.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const src = (f) => import(path.join(__dirname, '..', 'web', 'src', f));

const TZ = 'Australia/Brisbane';
const LEDGER = {
  updatedAt: new Date().toISOString(),
  body: { clips: { 'facebook:123': {
    publishedAt: '2026-08-18T21:33:00.000Z',
    caption: 'Ever wondered why prompts beat websites?',
    targets: {
      threads: { status: 'posted', url: 'https://www.threads.com/x', note: 'mirrored' },
      twitter: { status: 'posted', url: 'https://twitter.com/x' },
      tiktok: { status: 'pending' },
      instagram: { status: 'blocked', note: 'held' },
    },
  } } },
};

const base = (over = {}) => ({
  tz: TZ, email: 'mate@matewishkey.com', beat: { at: new Date().toISOString(), count: 3 },
  snapshots: { 'mirror-ledger': LEDGER }, events: [], counts: [], kind: '', level: '',
  actions: [], ...over,
});

/* ------------------------------------------------------------- overview -- */

test('the page renders the ledger as a matrix', async () => {
  const { overviewPage } = await src('pages/overview.js');
  const html = overviewPage(base());
  assert.match(html, /Ever wondered why prompts beat websites\?/);
  assert.match(html, /s-posted/);
  assert.match(html, /s-pending/);
  assert.match(html, /s-blocked/);
  assert.match(html, /https:\/\/www\.threads\.com\/x/);
  assert.match(html, /<b>2<\/b>/, 'two posted');
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
  const html = overviewPage(base({ snapshots: {}, beat: null }));
  assert.match(html, /No mirror ledger has been shipped yet/);
  assert.match(html, /Nothing yet/);
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
  const withUrl = overviewPage(base({ events: [{ ts: new Date().toISOString(), kind: 'mirror.posted',
    level: 'info', platform: 'threads', message: 'mirrored', url: 'https://example.com/p' }] }));
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

test('a channel only shows the metrics it actually reports', async () => {
  const { statsPage } = await src('pages/stats.js');
  const { flows } = require('../scripts/lib/platforms.js');
  const html = statsPage({ email: 'm@x.com', tz: TZ, daily: DAILY, followers: [], clicks: [],
    snapshots: { platforms: { body: { flows: flows() } } } });
  // YouTube reports no reach at all, so a reach row there would be a structural
  // zero pretending to be a measurement.
  const youtubeCard = html.split('<h2>youtube</h2>')[1].split('</section>')[0];
  assert.ok(!/>reach</.test(youtubeCard), 'youtube must not show a reach row');
  assert.match(youtubeCard, />views</);
  assert.match(youtubeCard, /Not reported here:.*reach/);
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
  assert.match(html, /no platform except Facebook reports clicks/);
});

/* ---------------------------------------------------------------- queue -- */

test('the queue shows the pace it does not itself decide', async () => {
  const { queuePage } = await src('pages/queue.js');
  const html = queuePage({ email: 'm@x.com', tz: TZ,
    items: [{ id: 'q1', status: 'queued', body: 'a post', platforms: '["threads"]',
      first_comment: 1, priority: 0, created_at: new Date().toISOString() }],
    pace: { perDay: 6, today: 2, window: '9:00–21:00', tz: TZ, nextAt: 'Fri 09:00', why: null } });
  assert.match(html, /a post/);
  assert.match(html, /Fri 09:00/);
  assert.match(html, /of 6 sent today/);
});

test('queued text cannot inject markup either', async () => {
  const { queuePage } = await src('pages/queue.js');
  const html = queuePage({ email: 'm@x.com', tz: TZ,
    items: [{ id: 'q1', status: 'queued', body: '<img src=x onerror=alert(1)>',
      platforms: '[]', first_comment: 0, priority: 0, created_at: new Date().toISOString() }],
    pace: { perDay: 6, today: 0, window: '9:00–21:00', tz: TZ, nextAt: null, why: null } });
  assert.ok(!html.includes('<img src=x'), 'the raw tag must not survive');
});

/* -------------------------------------------------------------- youtube -- */

test('a description proposal shows both versions and does nothing on its own', async () => {
  const { youtubePage } = await src('pages/youtube.js');
  const html = youtubePage({ email: 'm@x.com', tz: TZ, snapshots: {},
    proposals: [{ video_id: 'abc123', title: 'Episode 3', current_text: 'old words',
      proposed: 'new words', state: 'proposed', proposed_at: new Date().toISOString() }] });
  assert.match(html, /old words/);
  assert.match(html, /new words/);
  assert.match(html, /Use the new one/);
  assert.match(html, /Keep what's there|Keep what&#39;s there/);
});

// Auto-fill must not ship my paraphrase of the show to the channel.
test('auto-fill announces itself as paused until the blurb is chosen', async () => {
  const { youtubePage } = await src('pages/youtube.js');
  const html = youtubePage({ email: 'm@x.com', tz: TZ, proposals: [],
    snapshots: { voice: { body: { blurbChosen: false } } } });
  assert.match(html, /Auto-fill is paused/);
});
