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
  assert.match(html, /Only Facebook reports clicks natively/);
  assert.match(html, /none have been minted/, 'with no links at all, say so');
});

/* ---------------------------------------------------------------- queue -- */

test('the queue shows the pace it does not itself decide', async () => {
  const { queuePage } = await src('pages/queue.js');
  const html = queuePage({ email: 'm@x.com', tz: TZ,
    items: [{ id: 'q1', status: 'queued', body: 'a post', platforms: '["threads"]',
      first_comment: 1, priority: 0, created_at: new Date().toISOString() }],
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

test('queued text cannot inject markup either', async () => {
  const { queuePage } = await src('pages/queue.js');
  const html = queuePage({ email: 'm@x.com', tz: TZ,
    items: [{ id: 'q1', status: 'queued', body: '<img src=x onerror=alert(1)>',
      platforms: '[]', first_comment: 0, priority: 0, created_at: new Date().toISOString() }],
    pace: { perDay: 6, today: 0, minGapMinutes: 90, tz: TZ, nextAt: null, why: null } });
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
test('the workflows page shows the caption-link platforms carrying a tracked link', async () => {
  const { configPage } = await src('pages/config.js');
  const { flows } = require('../scripts/lib/platforms.js');
  const html = configPage({ email: 'm@x.com', tz: TZ, snapshots: {
    platforms: { body: { flows: flows() }, updatedAt: new Date().toISOString() } } });

  const tiktok = html.split('<h2>tiktok</h2>')[1].split('</section>')[0];
  assert.match(tiktok, /appended to the caption, with its own tracked code/);
  assert.ok(!/first-comment|watcher adds/.test(tiktok), 'nothing may suggest a comment reaches TikTok');
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
