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
