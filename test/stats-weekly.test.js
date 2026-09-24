/*
 * THE WEEKS THE STATS PAGE IS DRAWN FROM (web/src/lib/weekly.js), and the
 * honesty rules that moved there from the old page on 2026-09-25. Each one lies
 * in the flattering direction if it breaks, so each has a case that fails for
 * that reason.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const lib = () => import(path.join(__dirname, '..', 'web', 'src', 'lib', 'weekly.js'));
const page = () => import(path.join(__dirname, '..', 'web', 'src', 'pages', 'stats.js'));
const TODAY = '2026-09-25';

test('eight whole weeks, the newest ending yesterday, so today is in none of them', async () => {
  const { weekBlocks } = await lib();
  const w = weekBlocks(TODAY);
  assert.strictEqual(w.length, 8);
  assert.deepStrictEqual(w[7], { from: '2026-09-18', to: '2026-09-24' });
  assert.deepStrictEqual(w[0], { from: '2026-07-31', to: '2026-08-06' });
  for (let i = 1; i < 8; i++) {
    assert.strictEqual(Date.parse(w[i].from) - Date.parse(w[i - 1].to), 86400_000, 'no gap and no overlap');
  }
  assert.ok(w.every((b) => b.to < TODAY));
});

test('a platform that did not exist yet is a gap, never a zero, and gets no baseline', async () => {
  const { weekly, baseline } = await lib();
  const daily = [{ date: '2026-09-20', platform: 'pinterest', post_count: 2, impressions: 5 },
    { date: '2026-08-01', platform: 'facebook', post_count: 1, views: 10 }];
  const w = weekly({ today: TODAY, daily, platformSince: { pinterest: '2026-09-20', facebook: '2026-08-01' } });
  assert.deepStrictEqual(w.byPlatform.pinterest.seen, [null, null, null, null, null, null, null, 5]);
  assert.strictEqual(baseline(w.byPlatform.pinterest.seen), null, 'no usual week for a platform in its first week');
  // The control: Facebook existed, so its empty weeks ARE zeros.
  assert.deepStrictEqual(w.byPlatform.facebook.seen, [10, 0, 0, 0, 0, 0, 0, 0]);
});

test('an account connected part-way through is not counted as growth', async () => {
  const { weekly } = await lib();
  const followers = [
    { day: '2026-08-10', account_id: 'a', followers: 100 },
    { day: '2026-09-20', account_id: 'a', followers: 110 },
    // A LinkedIn profile connected on 22 Aug arrived with 5,040 followers.
    { day: '2026-08-22', account_id: 'late', followers: 5040 },
    { day: '2026-09-20', account_id: 'late', followers: 5050 },
  ];
  const w = weekly({ today: TODAY, followers });
  assert.deepStrictEqual(w.series.followers, [null, 100, 100, 100, 100, 100, 100, 110],
    'only the account that was there from the first reading; the late one would read as +5,040');
});

test('a percentage against a tiny count is withheld, but a rate always gets one', async () => {
  const { baseline, pctVs } = await lib();
  const clicks = [0, 0, 0, 1, 0, 0, 0, 3];
  assert.strictEqual(pctVs(3, baseline(clicks)), null, 'against a usual week of 0.25 one click is +1100%');
  const rate = [0, 0, 0, 0.4, 0.2, 0.3, 0.3, 0.6];
  assert.strictEqual(pctVs(0.6, baseline(rate), 0), 100, 'rates are small by nature');
  assert.strictEqual(pctVs(14, baseline([0, 0, 0, 30, 3, 1, 6, 14])), 40);
});

test('the journey rates divide two counts from the same week', async () => {
  const { weekly, THIS } = await lib();
  const daily = [{ date: '2026-09-20', platform: 'youtube', post_count: 1, views: 500, likes: 5 }];
  const clicks = [{ day: '2026-09-21', kind: 'show', platform: 'youtube' },
    { day: '2026-09-22', kind: 'booking', platform: 'website' },
    { day: '2026-09-22', kind: 'course', platform: null }];
  const sites = { sites: [{ host: 'matewishkey.com', since: '2026-01-01', days: [{ date: '2026-09-21', visits: 20 }], referrers: [] }] };
  const w = weekly({ today: TODAY, daily, clicks, sites, platformSince: { youtube: '2026-08-01' } });
  assert.strictEqual(w.rates.reactedPer100Seen[THIS], 1);
  assert.strictEqual(w.rates.clickedPer100Seen[THIS], 0.2, 'the course click is not a show click');
  assert.strictEqual(w.rates.linksShareOfVisits[THIS], 5);
  assert.strictEqual(w.rates.pressesPer100Visits[THIS], 5);
  assert.strictEqual(w.series.courseClicks[THIS], 1);
});

test('a platform seen too few times is listed, but not rated', async () => {
  const { weekly } = await lib();
  const { statsPage } = await page();
  const daily = [{ date: '2026-09-20', platform: 'pinterest', post_count: 1, impressions: 1 },
    { date: '2026-09-20', platform: 'facebook', post_count: 1, views: 900 }];
  const clicks = [{ day: '2026-09-21', kind: 'show', platform: 'pinterest' }, { day: '2026-09-21', kind: 'show', platform: 'facebook' }];
  const w = weekly({ today: TODAY, daily, clicks, platformSince: { pinterest: '2026-09-20', facebook: '2026-08-01' } });
  const html = statsPage({ email: 'm@x.com', tz: 'Australia/Brisbane', w });
  const box = html.split('Which platform turns attention into clicks')[1].split('</div>\n  <div class="legend"')[0];
  assert.match(box, /hbl">Facebook/, 'Facebook has a bar');
  assert.ok(!/hbl">Pinterest/.test(box), 'one click on one impression is not "100 per 100"');
  assert.match(box, /Too small to rate: Pinterest \(1 seen, 1 click\)/);
});

test('a YouTube trend reaching back before 24 Aug says the unit changed', async () => {
  const { weekly } = await lib();
  const { statsPage } = await page();
  const daily = [{ date: '2026-08-26', platform: 'youtube', post_count: 1, views: 50 },
    { date: '2026-09-20', platform: 'youtube', post_count: 1, views: 60 }];
  const flagged = statsPage({ email: 'm@x.com', tz: 'Australia/Brisbane',
    w: weekly({ today: TODAY, daily, platformSince: { youtube: '2026-08-05' } }) });
  assert.match(flagged, /YouTube counted long videos differently before 24 Aug/);
  // The control: the same page a month later, when the usual weeks are all after the change.
  const later = statsPage({ email: 'm@x.com', tz: 'Australia/Brisbane',
    w: weekly({ today: '2026-10-30', daily, platformSince: { youtube: '2026-08-05' } }) });
  assert.ok(!/counted long videos differently/.test(later));
});
