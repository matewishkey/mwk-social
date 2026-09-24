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
  const click = db.prepare('INSERT INTO click (code, at, referer_host, bot, tag) VALUES (?,?,?,?,?)');
  // Each hit alone in time, so every one counts as a person (lib/clicks.js).
  click.run('show1', at(600), null, 0, null);
  click.run('otd', at(1200), null, 0, 'instagram');
  click.run('otd', at(1800), null, 0, 'instagram');
  click.run('otd', at(2400), null, 0, null);
  click.run('30zc4', at(3000), null, 0, null);
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
});

test('with no course configured, every click is the show again (the control)', async () => {
  const { stats } = await import(path.join(__dirname, '..', 'web', 'src', 'index.js'));
  const html = await stats({ LINK_HOST: 'mwk.show', DB: d1(seed()) }, 'Australia/Brisbane', {}, 'm@x.com');
  const tile = html.split('<div class="tile').find((t) => t.includes('<span>show link clicks</span>')) || '';
  assert.match(tile, /<b>4<\/b>/, 'if this read 1 the split above would be proving nothing');
});
