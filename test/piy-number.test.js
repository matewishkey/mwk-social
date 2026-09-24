/*
 * A PIY SHORT'S NUMBER (mate, 2026-09-24): "if we are doing a piy it will
 * always have a link piy.show/001 etc... that will lead to the prompt page".
 * One number per prompt page, the same everywhere it is printed; plain numbers
 * are reserved for it; only a page on the course site gets one.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const shortlink = require('../scripts/lib/shortlink');
const { parse } = require('../scripts/queue-add');

const ENV = { LINK_HOST: 'mwk.show', COURSE_HOST: 'piy.show', COURSE_FALLBACK: 'https://promptityourself.com/' };
const REFUND = 'https://promptityourself.com/prompts/refund';

// Just enough of D1 for the numbered path: the codes, by target, and a max.
function fakeDb(rows = []) {
  return {
    rows,
    prepare(sql) {
      const stmt = (...a) => ({
        first: async () => {
          const piy = (r) => r.campaign === 'piy' || !/campaign = 'piy'/.test(sql);
          if (/SELECT code FROM link WHERE target = \?/.test(sql)) {
            return rows.find((r) => r.target === a[0] && /^\d+$/.test(r.code) && piy(r)) || null;
          }
          if (/SELECT MAX\(CAST\(code AS INTEGER\)\)/.test(sql)) {
            const nums = rows.filter((r) => /^\d+$/.test(r.code) && piy(r)).map((r) => Number(r.code));
            return { n: nums.length ? Math.max(...nums) : null };
          }
          return null;
        },
        run: async () => { if (/^\s*INSERT INTO link/.test(sql)) rows.push({ code: a[0], target: a[1], campaign: a[7] }); },
      });
      // D1 lets a statement with no parameters skip bind(), and the worker does.
      return { bind: (...a) => stmt(...a), ...stmt() };
    },
  };
}

test('the first prompt page gets 001, the next 002, and a page keeps its number', async () => {
  const { mint } = await import(path.join(__dirname, '..', 'web', 'src', 'api.js'));
  // 77235 is real: a random code minted before the numbers existed that happens
  // to be all digits. Counting from it made the first PIY number 77236.
  const env = { ...ENV, DB: fakeDb([{ code: 'otd', target: 'https://promptityourself.com/courses/open-the-door' },
    { code: '77235', target: 'https://matewishkey.com/show', campaign: null }]) };
  const a = await mint(env, { target: REFUND, numbered: true, clipId: 'x' });
  assert.strictEqual(a.code, '001');
  assert.strictEqual(a.url, 'https://piy.show/001', 'printed on the course host');
  const b = await mint(env, { target: 'https://promptityourself.com/prompts/dial', numbered: true, clipId: 'y' });
  assert.strictEqual(b.code, '002');
  const again = await mint(env, { target: REFUND, numbered: true, clipId: 'z', platform: 'instagram', medium: 'comment' });
  assert.strictEqual(again.code, '001', 'every placement of one post prints the same number');
  assert.strictEqual(again.reused, true);
});

test('only a page on the course site may have a number', async () => {
  const { mint } = await import(path.join(__dirname, '..', 'web', 'src', 'api.js'));
  const env = { ...ENV, DB: fakeDb() };
  await assert.rejects(mint(env, { target: 'https://matewishkey.com/show', numbered: true, clipId: 'x' }), /course site/);
});

test('a chosen code may not be a plain number, so the numbers stay his', async () => {
  const { normaliseCode } = await import(path.join(__dirname, '..', 'web', 'src', 'api.js'));
  assert.strictEqual(normaliseCode('007'), null);
  assert.strictEqual(normaliseCode('otd'), 'otd', 'the control: a word is fine');
});

test('a prompt page is minted as a number, a course page as a plain code', async () => {
  const realFetch = global.fetch;
  const sent = [];
  process.env.MWK_LOG_URL = 'https://example.test/events';
  process.env.MWK_LOG_TOKEN = 'x';
  global.fetch = async (_u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ ok: true, url: 'https://piy.show/001' }) }; };
  try {
    assert.ok(shortlink.isPromptLink(REFUND));
    assert.ok(!shortlink.isPromptLink('https://promptityourself.com/courses/open-the-door'));
    await shortlink.destination(REFUND, { platform: 'instagram' });
    await shortlink.destination('https://promptityourself.com/courses/open-the-door', {});
    assert.strictEqual(sent[0].numbered, true);
    assert.strictEqual(sent[1].numbered, false);
  } finally { global.fetch = realFetch; }
});

test('--piy points the post at its prompt page, and refuses --link beside it', () => {
  const opt = parse(['--body', 'Refund in one prompt', '--piy', 'refund']);
  assert.strictEqual(opt.link, REFUND);
  assert.throws(() => parse(['--body', 'x', '--piy', 'refund', '--link', 'https://example.com/']), /not both/);
  assert.throws(() => parse(['--body', 'x', '--piy', 'Refund Page!']), /slug/);
});

test('the number is printed even where nothing is clickable', async () => {
  const fs = require('fs'); const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piy-'));
  const was = process.env.MWK_COMMENT_STATE;
  process.env.MWK_COMMENT_STATE = path.join(dir, 'state.json');
  process.env.MWK_LOG_URL = 'https://example.test/events';
  process.env.MWK_LOG_TOKEN = 'x';
  const realFetch = global.fetch;
  global.fetch = async (_u, o) => {
    const b = JSON.parse(o.body);
    return { ok: true, json: async () => ({ ok: true, url: b.numbered ? 'https://piy.show/001' : 'https://mwk.show/zz9' }) };
  };
  try {
    const { commentFor } = require('../scripts/post');
    for (const platform of ['instagram', 'tiktok']) {
      const piy = await commentFor(platform, 'Refund in one prompt', { link: REFUND, topics: [], postKey: `t:${platform}` });
      assert.match(piy, /piy\.show\/001/, `${platform}: a PIY number is typed, so it is printed`);
    }
    // The control: the same platform with an ordinary post still says the bio.
    const plain = await commentFor('instagram', 'An ordinary clip', { topics: [], postKey: 't:plain' });
    assert.ok(!/mwk\.show|piy\.show/.test(plain), 'an ordinary Instagram comment carries no dead url');
    assert.match(plain, /bio/);
  } finally {
    global.fetch = realFetch;
    if (was === undefined) delete process.env.MWK_COMMENT_STATE; else process.env.MWK_COMMENT_STATE = was;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
