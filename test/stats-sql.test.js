/*
 * THE STATS QUERIES, RUN FOR REAL (2026-09-24, rewritten for the tabbed page
 * 2026-09-25). A review found the show/course split tested by reading
 * index.js's source text, which passes a rename that breaks nothing and misses
 * a change that breaks everything. These run stats() against an in-memory
 * SQLite built from web/schema.sql (D1 is SQLite) with a show click, course
 * clicks, a booking press and the links between the two sites, all inside
 * "this week", and read what the page says.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function d1(db) {
  return {
    prepare(sql) {
      const st = db.prepare(sql);
      const bound = (args) => ({
        bind: (...a) => bound(a),
        all: async () => ({ results: st.all(...args) }),
        first: async () => st.get(...args) || null,
        run: async () => st.run(...args),
      });
      return bound([]);
    },
  };
}

function seed() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'web', 'schema.sql'), 'utf8'));
  const now = Date.now();
  const at = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();
  const day = (n) => new Date(now - n * 86400000).toISOString().slice(0, 10);
  const link = db.prepare('INSERT INTO link (code, target, platform, created_at, campaign) VALUES (?,?,?,?,?)');
  link.run('show1', 'https://matewishkey.com/show', 'facebook', at(90000), 'clip');
  link.run('otd', 'https://promptityourself.com/courses/open-the-door', null, at(90000), 'course');
  link.run('30zc4', 'https://calendar.app.google/x', 'website', at(90000), 'book');
  link.run('mwk', 'https://promptityourself.com/', 'website', at(90000), 'site-link');
  link.run('piy', 'https://matewishkey.com/', 'website', at(90000), 'site-link');
  const click = db.prepare('INSERT INTO click (code, at, referer_host, bot, tag) VALUES (?,?,?,?,?)');
  // Two to four days ago: inside "this week" (yesterday back seven days) at
  // any hour of the day, and each hit alone in time so it counts (lib/clicks.js).
  click.run('show1', at(2880), null, 0, null);
  click.run('otd', at(3000), null, 0, 'instagram');
  click.run('otd', at(3120), null, 0, 'instagram');
  click.run('otd', at(3240), null, 0, null);
  click.run('30zc4', at(4320), null, 0, null);
  click.run('mwk', at(5760), null, 0, null);
  click.run('piy', at(5900), null, 0, null);
  click.run('piy', at(6100), null, 0, null);
  // One Facebook post, three days ago: 100 seen, 5 likes and 1 comment, of
  // which 2 likes and the comment are our own (withoutOwnActions).
  db.prepare(`INSERT INTO daily_metric (date, platform, post_count, views, likes, comments, shares, saves, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(day(3), 'facebook', 1, 100, 5, 1, 0, 0, at(10));
  // Facebook existed well before the window, so its older weeks are real zeros, not gaps.
  db.prepare(`INSERT INTO daily_metric (date, platform, post_count, views, likes, comments, shares, saves, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(day(70), 'facebook', 1, 10, 0, 0, 0, 0, at(10));
  return db;
}

const ENV = { LINK_HOST: 'mwk.show', COURSE_HOST: 'piy.show', COURSE_FALLBACK: 'https://promptityourself.com/' };
const render = async (env, snapshots = {}) => {
  const { stats } = await import(path.join(__dirname, '..', 'web', 'src', 'index.js'));
  return stats({ ...env, DB: d1(seed()) }, 'Australia/Brisbane', snapshots, 'm@x.com');
};
// A headline stage on the Journey tab: <span class="l">Clicked</span><b ...>1</b>
const stage = (html, name) => ((html.match(new RegExp(`<span class="l">${name}</span><b[^>]*>([^<]*)</b>`)) || [])[1]);
// A Trends card's big number, found by its title.
const cardNum = (html, title) => {
  const at = html.indexOf(`<h3>${title}</h3>`);
  return at < 0 ? null : (html.slice(at).match(/<div class="big"><b[^>]*>([^<]*)<\/b>/) || [])[1];
};

test('a show click is the journey, and course, booking and site links are each their own series', async () => {
  const html = await render(ENV);
  assert.strictEqual(stage(html, 'Clicked'), '1', 'one show click; the course, the press and the site links stay out');
  assert.strictEqual(stage(html, 'Pressed booking'), '1');
  assert.strictEqual(cardNum(html, 'Course link clicks'), '3');
  assert.strictEqual(cardNum(html, 'Between the two sites'), '3');
  // Our own two likes and first comment came off the one post: 5 + 1 - 3.
  assert.strictEqual(stage(html, 'Reacted'), '3');
  assert.strictEqual(stage(html, 'Seen'), '100');
  // The course track stands apart, with its 30-day count.
  const track = html.split('The course track')[1].split('</div></div>')[0];
  assert.match(track, /<b>3<\/b><span class="sub">course link clicks, last 30 days/);
});

test('with no course configured, every click is the show again (the control)', async () => {
  const html = await render({ LINK_HOST: 'mwk.show' });
  assert.strictEqual(stage(html, 'Clicked'), '4', 'if this read 1 the split above would be proving nothing');
});

test('the course links are counted by the profile ending on the url', async () => {
  const html = await render(ENV);
  const table = html.split('<h3>Course links</h3>')[1].split('</table>')[0];
  assert.match(table, /piy\.show\/otd\/instagram<\/td><td class="num">2<\/td><td class="num">2<\/td>/);
  assert.match(table, /piy\.show\/otd<\/td><td class="num">1<\/td>/);
  const between = html.split('<h3>Between the two sites</h3><span class="sub">one link each way')[1].split('</table>')[0];
  assert.match(between, /show site → course site <span class="faint">piy\.show\/mwk<\/span><\/td><td class="num">1<\/td>/);
  assert.match(between, /course site → show site <span class="faint">mwk\.show\/piy<\/span><\/td><td class="num">2<\/td>/);
});

test('bookings read as unmeasured, robots are not mentioned, and every rate says per 100', async () => {
  const html = await render(ENV);
  assert.match(html, /Booked a slot: not measured/);
  const visible = html.split('<body')[1].replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  assert.ok(!/crawler|robot/i.test(visible), 'robot traffic is filtered and never named (mate, 2026-09-25)');
  // The journey's rates are ratios of two counts, labelled as such.
  for (const label of ['reactions per 100 seen', 'clicks per 100 seen', 'of site visits came from our links', 'booking presses per 100 visits']) {
    assert.ok(html.includes(label), label);
  }
  assert.match(html, /they do not follow people/);
});

test('the visits and Google read from their snapshots, and a missing one says so', async () => {
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const sites = { body: { sites: [
    { host: 'matewishkey.com', since: day(100), sampleInterval: 10,
      days: [{ date: day(2), visits: 30 }, { date: day(3), visits: 20 }],
      referrers: [{ host: '', visits: 40 }, { host: 'm.facebook.com', visits: 10 }, { host: 'www.google.com', visits: 10 },
        { host: 'editor.matewishkey.com', visits: 50 }] },
    { host: 'promptityourself.com', since: day(4), sampleInterval: 10, days: [{ date: day(2), visits: 10 }], referrers: [] },
  ] } };
  const search = { body: { sites: [{ host: 'matewishkey.com', property: 'sc-domain:matewishkey.com',
    days: [{ date: day(3), impressions: 120, clicks: 4, position: 5 }],
    pages: [{ key: 'https://matewishkey.com/show/', impressions: 20, clicks: 1, position: 3.2 },
      { key: 'https://matewishkey.com/', impressions: 90, clicks: 3, position: 4 }],
    countries: [], devices: [], totals: { impressions: 110, clicks: 4, position: 4.1 } },
  { host: 'promptityourself.com', property: 'sc-domain:promptityourself.com', days: [], pages: [], countries: [], devices: [], totals: null }],
  missing: [] } };
  const html = await render(ENV, { sites, search });
  assert.strictEqual(stage(html, 'On the site'), '~50');
  assert.strictEqual(cardNum(html, 'promptityourself.com visits'), '~10');
  const g = html.split('matewishkey.com in Google')[1].split('promptityourself.com in Google')[0];
  assert.match(g, /shown in Google<\/span><b>110<\/b>/);
  assert.match(g, /average position \(1 = top\)<\/span><b>4\.1<\/b>/);
  assert.ok(g.indexOf('hbl">/ <i>') > 0 && g.indexOf('hbl">/ <i>') < g.indexOf('hbl">/show/ <i>'), 'pages are ordered by how often Google showed them');
  const piy = html.split('promptityourself.com in Google')[1].split('</div>\n    </div>')[0];
  assert.match(piy, /shown in Google<\/span><b>—<\/b>/, 'no totals yet is a dash, never 0');
  const sources = html.split('<h3 class="sec">Where visitors came from</h3>')[1].split('</section>')[0];
  assert.match(sources, /no referrer<\/span>[\s\S]*?<b>~40<\/b>/);
  assert.match(sources, /search engines<\/span>[\s\S]*?<b>~10<\/b>/);
  assert.ok(!/editor/.test(sources), 'his own editor is not a source');
});
