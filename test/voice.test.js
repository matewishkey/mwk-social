'use strict';
const test = require('node:test');
const assert = require('node:assert');
const voice = require('../scripts/lib/voice');

const KEYS = Array.from({ length: 20 }, (_, i) => `instagram:1814681423553${String(i).padStart(4, '0')}`);

test('every rendered comment keeps the marker intact', () => {
  for (const k of KEYS) {
    const { text } = voice.firstComment(k, { platform: 'instagram', topicTags: ['Debugging'] });
    assert.ok(text.includes(voice.marker()), `lost the marker for ${k}`);
  }
});

test('the url is byte-identical everywhere', () => {
  const show = voice.config().links.show;
  for (const k of KEYS) {
    const { text } = voice.firstComment(k, { platform: 'threads' });
    const urls = text.match(/https?:\/\/[^\s]+/g) || [];
    assert.ok(urls.includes(show), `${k} did not emit the configured URL verbatim`);
  }
});

test('the same post always renders the same comment', () => {
  const a = voice.firstComment(KEYS[0], { platform: 'instagram', noEpisode: true }).text;
  const b = voice.firstComment(KEYS[0], { platform: 'instagram', noEpisode: true }).text;
  assert.strictEqual(a, b, 're-running a job must not change what it says');
});

test('consecutive posts do not repeat a variant', () => {
  let last = -1;
  for (const k of KEYS) {
    const r = voice.firstComment(k, { platform: 'instagram', noEpisode: true, avoidIndex: last });
    assert.notStrictEqual(r.index, last);
    last = r.index;
  }
});

test('the rotation actually varies', () => {
  const seen = new Set(KEYS.map((k) => voice.firstComment(k, { platform: 'instagram', noEpisode: true }).text));
  assert.ok(seen.size >= 4, `only ${seen.size} distinct comments across 20 posts`);
});

test('instagram never exceeds five hashtags', () => {
  const line = voice.tagLine('instagram', ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.strictEqual(line.split(' ').length, 5);
});

test('a cap tighter than the always-on pair truncates the pair', () => {
  assert.strictEqual(voice.tagLine('twitter', ['A', 'B']), '#PIY');
});

test('the brand tag is on every post that has room for it', () => {
  for (const p of ['instagram', 'threads', 'tiktok', 'facebook']) {
    assert.ok(voice.tagLine(p, ['Trading']).includes('#MWKShow'), `${p} lost the brand tag`);
  }
});

test('PromptItYourself is not a tag any more', () => {
  assert.ok(!voice.tagLine('threads', ['Trading']).includes('#PromptItYourself'));
});

test('blocked tags never get through', () => {
  const line = voice.tagLine('threads', ['ai', 'viral', 'Trading', 'fyp']);
  assert.ok(!/#ai\b|#viral|#fyp/i.test(line));
  assert.ok(line.includes('#Trading'));
});

test('a config without the marker is refused', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voice-')), 'voice.json');
  const cfg = JSON.parse(JSON.stringify(voice.config()));
  cfg.links.show = 'https://example.com/nope';
  fs.writeFileSync(bad, JSON.stringify(cfg));
  const { execFileSync } = require('child_process');
  assert.throws(() => execFileSync(process.execPath,
    ['-e', 'require(process.env.V).config()'],
    { env: { ...process.env, MWK_VOICE_CONFIG: bad, V: require.resolve('../scripts/lib/voice') }, stdio: 'pipe' }));
});

test('a pinned variant beats the rotation, on every platform and every key', () => {
  const pinned = new Set(['a', 'b', 'c'].flatMap((k) => ['instagram', 'facebook', 'youtube']
    .map((p) => voice.firstComment(k, { platform: p, variantIndex: 0 }).text)));
  assert.strictEqual(pinned.size, 1, 'pinning still varied the comment');
  assert.ok([...pinned][0].startsWith('Do not let others solve your problem'));
});

test('pinning a variant that does not exist is refused', () => {
  assert.throws(() => voice.firstComment('k', { platform: 'facebook', variantIndex: 99 }));
  assert.throws(() => voice.firstComment('k', { platform: 'facebook', variantIndex: -1 }));
});

test('the short brand tag rides along wherever there is room', () => {
  for (const p of ['instagram', 'threads', 'tiktok', 'facebook', 'youtube', 'linkedin']) {
    assert.ok(voice.tagLine(p, ['VPN']).includes('#MWK '), `${p} lost the short brand tag`);
  }
  // Instagram's budget is the binding one: three always-on leaves exactly two.
  assert.strictEqual(voice.tagLine('instagram', ['A', 'B', 'C', 'D']).split(' ').length, 5);
});
