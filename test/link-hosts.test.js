/*
 * mwk.show replaced mwkshow.com on 2026-09-23 (mate bought it and will not
 * renew the old one, which lapses 2027-08-20). The codes live in ONE table and
 * every host serves all of them, so the move is a question of which host is
 * PRINTED — and the old one has to keep resolving, and keep being recognised
 * as ours, for as long as a comment carrying it is out there.
 *
 * Two runtimes carry the list: config/voice.json (the box) and
 * web/wrangler.toml (the worker). They only make sense as a pair.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const voice = require('../scripts/lib/voice');
const shortlink = require('../scripts/lib/shortlink');

const toml = fs.readFileSync(path.join(__dirname, '..', 'web', 'wrangler.toml'), 'utf8');
const tomlVar = (k) => (toml.match(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, 'm')) || [])[1];

test('new links are printed as mwk.show', () => {
  assert.strictEqual(voice.shortLink().host, 'mwk.show');
});

test('the worker and the box agree on every host', () => {
  assert.strictEqual(tomlVar('LINK_HOST'), voice.shortLink().host);
  const aliases = (tomlVar('LINK_ALIASES') || '').split(',').map((s) => s.trim()).filter(Boolean);
  assert.deepStrictEqual(aliases, voice.shortLink().aliases);
  for (const h of voice.linkHosts()) {
    assert.ok(toml.includes(`pattern = "${h}"`), `${h} has no route — its codes would not resolve`);
  }
});

test('a comment under the OLD host is still recognised as ours', () => {
  // The control first: the new host is recognised.
  assert.ok(voice.carriesCta('https://mwk.show/ab12x'));
  assert.ok(voice.carriesCta('https://mwkshow.com/ab12x'),
    'forgetting mwkshow.com re-comments under every post written before the move');
});

test('a url already on any of our hosts is never minted again', async () => {
  const realFetch = global.fetch;
  let calls = 0;
  process.env.MWK_LOG_URL = 'https://example.test/events';
  process.env.MWK_LOG_TOKEN = 'x';
  global.fetch = async () => { calls += 1; return { ok: true, json: async () => ({ ok: true, url: 'https://mwk.show/zz9' }) }; };
  try {
    // The control: the show's own page IS minted, so the fetch mock is live.
    const show = voice.config().links.show;
    assert.strictEqual(await shortlink.trackLinks(`go ${show}`), 'go https://mwk.show/zz9');
    assert.strictEqual(calls, 1);
    const body = 'old https://mwkshow.com/abcde and new https://mwk.show/fghij';
    assert.strictEqual(await shortlink.trackLinks(body), body);
    assert.strictEqual(calls, 1, 'one of our own codes was sent to be minted');
  } finally { global.fetch = realFetch; }
});

test('the worker serves every host and nothing else', async () => {
  const { isLinkHost } = await import(path.join(__dirname, '..', 'web', 'src', 'index.js'));
  const env = { LINK_HOST: 'mwk.show', LINK_ALIASES: 'mwkshow.com' };
  assert.ok(isLinkHost(env, 'mwk.show'));
  assert.ok(isLinkHost(env, 'MWKSHOW.com'));
  assert.ok(!isLinkHost(env, 'social.matewishkey.com'));
  assert.ok(!isLinkHost(env, 'evilmwk.show'));
});

/*
 * piy.show is the course's host (mate, 2026-09-23): a piy.show link always
 * lands on promptityourself.com. The table is shared, so a show code typed on
 * piy.show exists — it must go to the course too, and a miss there must never
 * fall back to the show.
 */
async function hit(host, path, rows) {
  const { redirect } = await import(path_.join(__dirname, '..', 'web', 'src', 'links.js'));
  const writes = [];
  const env = {
    LINK_HOST: 'mwk.show', LINK_ALIASES: 'mwkshow.com,piy.show', LINK_FALLBACK: 'https://matewishkey.com/show',
    COURSE_HOST: 'piy.show', COURSE_FALLBACK: 'https://promptityourself.com/',
    DB: { prepare: (sql) => ({ bind: (...a) => ({
      first: async () => (sql.startsWith('SELECT') ? rows[a[0]] || null : null),
      run: async () => { writes.push(a); },
    }) }) },
  };
  const url = new URL(`https://${host}/${path}`);
  const res = await redirect(new Request(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }), env, url, null);
  return { to: res.headers.get('Location'), writes };
}
const path_ = path;
const ROWS = {
  otd: { target: 'https://promptityourself.com/courses/open-the-door' },
  kc8h6: { target: 'https://matewishkey.com/show' },
};

test('piy.show/otd goes to the course and counts, with the profile tag kept', async () => {
  const r = await hit('piy.show', 'otd/ig', ROWS);
  assert.strictEqual(r.to, 'https://promptityourself.com/courses/open-the-door');
  assert.strictEqual(r.writes.length, 1);
  assert.strictEqual(r.writes[0][4], 'ig');
});

test('a show code on piy.show lands on the course, not the show', async () => {
  // The control: the same code on mwk.show goes to the show.
  assert.strictEqual((await hit('mwk.show', 'kc8h6', ROWS)).to, 'https://matewishkey.com/show');
  const r = await hit('piy.show', 'kc8h6', ROWS);
  assert.strictEqual(r.to, 'https://promptityourself.com/');
  assert.strictEqual(r.writes.length, 0, 'counted as a click on a show code');
});

test('a miss on piy.show falls back to the course, and on mwk.show to the show', async () => {
  assert.strictEqual((await hit('piy.show', 'nope', ROWS)).to, 'https://promptityourself.com/');
  assert.strictEqual((await hit('piy.show', '', ROWS)).to, 'https://promptityourself.com/');
  assert.strictEqual((await hit('mwk.show', 'nope', ROWS)).to, 'https://matewishkey.com/show');
});

/*
 * TWO DESTINATIONS, TWO SCOREBOARDS (2026-09-23). A course code is told apart
 * by its TARGET: piy.show/otd has no platform, so without this every course
 * click was a "social" click and counted toward the show's guest funnel.
 */
const COURSE_ENV = { LINK_HOST: 'mwk.show', COURSE_HOST: 'piy.show', COURSE_FALLBACK: 'https://promptityourself.com/' };

test('a course code prints on piy.show, a show code on mwk.show', async () => {
  const { hostFor } = await import(path.join(__dirname, '..', 'web', 'src', 'links.js'));
  assert.strictEqual(hostFor(COURSE_ENV, 'https://promptityourself.com/courses/open-the-door'), 'piy.show');
  assert.strictEqual(hostFor(COURSE_ENV, 'https://matewishkey.com/show'), 'mwk.show');
  assert.strictEqual(hostFor(COURSE_ENV, 'https://evilpromptityourself.com/x'), 'mwk.show', 'suffix is not the site');
  assert.strictEqual(hostFor(COURSE_ENV, null), 'mwk.show');
});

test('the course SQL matches the course site and nothing else', async () => {
  const { courseSql } = await import(path.join(__dirname, '..', 'web', 'src', 'links.js'));
  const sql = courseSql(COURSE_ENV);
  assert.match(sql, /l\.target = 'https:\/\/promptityourself\.com'/);
  assert.match(sql, /l\.target LIKE 'https:\/\/promptityourself\.com\/%'/);
  assert.strictEqual(courseSql({}), '0', 'no course configured must match nothing, not everything');
});

test('the social numbers exclude the course, and the funnel gives it its own stage', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'index.js'), 'utf8');
  assert.match(src, /const SOCIAL = `l\.platform IS NOT 'website' AND NOT \$\{COURSE\}`/);
  assert.match(src, /WHEN \$\{COURSE\} THEN 'course' ELSE 'social'/);
});

test('the stats page shows course clicks by profile ending', async () => {
  const { statsPage } = await import(path.join(__dirname, '..', 'web', 'src', 'pages', 'stats.js'));
  const html = statsPage({ email: 'm@x.com', tz: 'Australia/Brisbane', daily: [], followers: [], clicks: [],
    snapshots: {}, courseHost: 'piy.show',
    course: [{ code: 'otd', tag: 'instagram', all_time: 3, recent: 2 }, { code: 'otd', tag: '', all_time: 1, recent: 1 }] });
  const card = html.split('The course')[1] || '';
  assert.match(card, /instagram/);
  assert.match(card, /piy\.show\/otd\/instagram/);
  assert.match(card, /generic link/);
});
