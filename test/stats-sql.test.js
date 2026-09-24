/*
 * THE STATS QUERIES, RUN FOR REAL (2026-09-24). A review found the show/course
 * split tested by reading index.js's source text, which passes a rename that
 * breaks nothing and misses a change that breaks everything. These run stats()
 * against an in-memory SQLite built from web/schema.sql — D1 is SQLite — with
 * a show click, a course click and a website press, and read what the page says.
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
  const link = db.prepare('INSERT INTO link (code, target, platform, created_at, campaign) VALUES (?,?,?,?,?)');
  link.run('show1', 'https://matewishkey.com/show', 'facebook', at(9000), 'clip');
  link.run('otd', 'https://promptityourself.com/courses/open-the-door', null, at(9000), 'course');
  link.run('30zc4', 'https://calendar.app.google/x', 'website', at(9000), 'book');
  link.run('mwk', 'https://promptityourself.com/', 'website', at(9000), 'site-link');
  link.run('piy', 'https://matewishkey.com/', 'website', at(9000), 'site-link');
  const click = db.prepare('INSERT INTO click (code, at, referer_host, bot, tag) VALUES (?,?,?,?,?)');
  // Each hit alone in time, so every one counts as a person (lib/clicks.js).
  click.run('show1', at(600), null, 0, null);
  click.run('otd', at(1200), null, 0, 'instagram');
  click.run('otd', at(1800), null, 0, 'instagram');
  click.run('otd', at(2400), null, 0, null);
  click.run('30zc4', at(3000), null, 0, null);
  click.run('mwk', at(3600), null, 0, null);
  click.run('piy', at(4200), null, 0, null);
  click.run('piy', at(4800), null, 0, null);
  return db;
}

const ENV = { LINK_HOST: 'mwk.show', COURSE_HOST: 'piy.show', COURSE_FALLBACK: 'https://promptityourself.com/' };

test('a course click is never a show click, and the course card has it by profile', async () => {
  const { stats } = await import(path.join(__dirname, '..', 'web', 'src', 'index.js'));
  const html = await stats({ ...ENV, DB: d1(seed()) }, 'Australia/Brisbane', {}, 'm@x.com');
  const tile = (label) => (html.split('<div class="tile').find((t) => t.includes(`<span>${label}</span>`)) || '');
  assert.match(tile('show link clicks'), /<b>1<\/b>/, 'one show click; the three course clicks and the press stay out');
  assert.match(tile('course link clicks'), /<b>3<\/b>/);
  const course = html.split('The course')[1] || '';
  assert.match(course, /instagram[\s\S]*piy\.show\/otd\/instagram[\s\S]*<td class="num">2<\/td>/);
  assert.match(course, /generic link/);
  const funnel = html.split('Does any of it produce a guest')[1] || '';
  assert.match(funnel, /clicked a show link in a post[\s\S]*?<td class="num">1<\/td>/,
    'the guest funnel counts the show click only');
  // The links between his two sites: their own card, and in nothing else.
  const between = html.split('Between the two sites')[1].split('</section>')[0];
  assert.match(between, /show site → course site[\s\S]*?piy\.show\/mwk[\s\S]*?<td class="num">1<\/td>/);
  assert.match(between, /course site → show site[\s\S]*?mwk\.show\/piy[\s\S]*?<td class="num">2<\/td>/);
  assert.ok(!/<b>mwk<\/b>|piy\.show\/mwk/.test(course.split('</section>')[0]), 'the site link is not a course click');
});

test('with no course configured, every click is the show again (the control)', async () => {
  const { stats } = await import(path.join(__dirname, '..', 'web', 'src', 'index.js'));
  const html = await stats({ LINK_HOST: 'mwk.show', DB: d1(seed()) }, 'Australia/Brisbane', {}, 'm@x.com');
  const tile = html.split('<div class="tile').find((t) => t.includes('<span>show link clicks</span>')) || '';
  assert.match(tile, /<b>4<\/b>/, 'if this read 1 the split above would be proving nothing (site links are website, so out either way)');
});

test('the websites card sets visits beside the week\'s clicks, show and course apart', async () => {
  const { stats } = await import(path.join(__dirname, '..', 'web', 'src', 'index.js'));
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const sites = { body: { sites: [
    { host: 'matewishkey.com', since: day(100), sampleInterval: 10,
      days: [{ date: day(2), visits: 30, views: 40 }, { date: day(3), visits: 20, views: 20 }, { date: day(9), visits: 70, views: 70 }],
      referrers: [{ host: '', visits: 40 }, { host: 'm.facebook.com', visits: 10 }, { host: 'www.google.com', visits: 10 },
        { host: 'editor.matewishkey.com', visits: 50 }] },
    { host: 'promptityourself.com', since: day(4), sampleInterval: 10,
      days: [{ date: day(2), visits: 10, views: 10 }], referrers: [] },
  ] } };
  const html = await stats({ ...ENV, DB: d1(seed()) }, 'Australia/Brisbane', { sites }, 'm@x.com');
  const card = html.split('The websites, week by week')[1].split('</section>')[0];
  const [thisWeek, lastWeek] = card.split('<tbody>')[1].split('</tr>');
  const cells = (row) => [...row.matchAll(/<td class="num[^"]*">(?:<b>)?([^<]*)/g)].map((m) => m[1]);
  // The seeded clicks are hours old, so whether each is in the newest block
  // (which ends YESTERDAY, like every trend here) depends on the clock: work it
  // out rather than assume it. 1 show click at 600 min, course at 1200/1800/2400;
  // the booking press and the two site links are neither.
  const inWeek = (mins) => { const d = new Date(Date.now() - mins * 60000).toISOString().slice(0, 10); return d >= day(7) && d <= day(1); };
  const show = [600].filter(inWeek).length;
  const course = [1200, 1800, 2400].filter(inWeek).length;
  assert.ok(course > 0, 'the fixture must put at least one click in the block, or this proves nothing');
  assert.deepStrictEqual(cells(thisWeek), ['50', '10', String(show), String(course)]);
  assert.deepStrictEqual(cells(lastWeek), ['70', 'not tracked', '0', '0'],
    'a week before the course site was tracked says so, rather than 0');
  assert.match(card, /1 page load in 10/);

  const sources = html.split('Where website visitors came from')[1].split('</section>')[0];
  assert.match(sources, /no referrer<\/dt><dd>40/);
  assert.match(sources, /Facebook<\/dt><dd>10/);
  assert.match(sources, /search engines<\/dt><dd>10/);
  assert.ok(!/editor/.test(sources), 'his own editor is not a source');
});
