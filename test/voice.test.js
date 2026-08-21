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
  // X allows one tag. Truncating beats blowing the budget, and the brand tag
  // is the one worth keeping when only one survives.
  assert.strictEqual(voice.tagLine('twitter', ['A', 'B']), '#MWKShow');
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

test('the motto tag rides along wherever there is room', () => {
  for (const p of ['instagram', 'threads', 'tiktok', 'facebook', 'youtube', 'linkedin']) {
    assert.ok(voice.tagLine(p, ['VPN']).includes('#PIY'), `${p} lost the motto tag`);
  }
  // Instagram's budget is the binding one: two always-on now leaves three topic
  // slots, where the old trio left two.
  assert.strictEqual(voice.tagLine('instagram', ['A', 'B', 'C', 'D']).split(' ').length, 5);
  assert.strictEqual(voice.tagLine('instagram', ['A', 'B', 'C', 'D']), '#MWKShow #PIY #A #B #C');
});

/* ------------------------------------------------------- the short link -- */

/*
 * Introducing the short link changed the CTA's host. config/voice.json warns in
 * its own notes that this is a breaking change: the duplicate guard works by
 * finding the CTA in a comment's text, so a guard taught only the NEW host
 * would fail to recognise every comment written before the change and would
 * comment again on all of them. These are the cases that catch that.
 */
test('the guard recognises a comment written before the short link existed', () => {
  assert.ok(voice.carriesCta('come and build yours\n\nhttps://matewishkey.com/show'));
});

test('the guard recognises a comment carrying a short link', () => {
  assert.ok(voice.carriesCta('come and build yours\n\nhttps://mwkshow.com/ab12x'));
});

test('the guard does not fire on an unrelated comment', () => {
  assert.ok(!voice.carriesCta('great video mate'));
  assert.ok(!voice.carriesCta('see matewishkey.com/episodes'));
});

test('every marker is a real substring of something we would post', () => {
  const cfg = voice.config();
  assert.ok(cfg.markers.includes(cfg.marker), 'the primary marker must be in the list');
  assert.ok(cfg.links.show.includes(cfg.marker));
  if (cfg.shortLink && cfg.shortLink.enabled) {
    const sample = `https://${cfg.shortLink.host}/abcde`;
    assert.ok(voice.carriesCta(sample), `no marker matches ${sample} — the guard would re-comment on every post`);
  }
});

test('a composed comment renders the short link when it is given one', () => {
  const short = voice.firstComment('k1', { platform: 'threads', noEpisode: true,
    showUrl: 'https://mwkshow.com/ab12x' });
  assert.match(short.text, /mwkshow\.com\/ab12x/);
  assert.ok(!short.text.includes('matewishkey.com/show'));
  assert.ok(voice.carriesCta(short.text), 'and it still reads as ours');
});

test('without a short link it falls back to the plain URL rather than failing', () => {
  const plain = voice.firstComment('k1', { platform: 'threads', noEpisode: true, showUrl: null });
  assert.match(plain.text, /matewishkey\.com\/show/);
  assert.ok(voice.carriesCta(plain.text));
});

// Same post, same rendering — or the guard sees a different comment each run.
test('the same post renders the identical comment twice running', () => {
  const a = voice.firstComment('post-42', { platform: 'instagram', noEpisode: true, showUrl: 'https://mwkshow.com/zz' });
  const b = voice.firstComment('post-42', { platform: 'instagram', noEpisode: true, showUrl: 'https://mwkshow.com/zz' });
  assert.equal(a.text, b.text);
});

/* --------------------------------------------- captions that carry the link -- */

/*
 * TikTok and X have no comments API we can use, so their caption is the ONLY
 * place a link can go. Before this, a post there went out with his words and
 * nothing else — no route to the sign-up page and nothing measurable. These
 * pin the shape of what gets appended.
 */
const platformTable = require('../scripts/lib/platforms');

test('exactly the platforms with no comments API take the link in the caption', () => {
  const inCaption = Object.keys(platformTable.PLATFORMS)
    .filter((p) => platformTable.get(p).linkPlacement === 'caption');
  assert.deepStrictEqual(inCaption.sort(), ['tiktok', 'twitter']);
  for (const p of inCaption) {
    assert.equal(platformTable.get(p).commentsApi, false,
      `${p} takes the link in its caption, so it must be because it cannot be commented on`);
  }
});

test('a caption-link platform gets tags under its own cap', () => {
  // TikTok has no meaningful cap: both fixed tags plus everything given.
  assert.strictEqual(voice.tagLine('tiktok', ['Xero', 'Invoicing']),
    '#MWKShow #PIY #Xero #Invoicing');
  // X allows one, so the pair is truncated rather than the budget blown.
  assert.strictEqual(voice.tagLine('twitter', ['Xero', 'Invoicing']), '#MWKShow');
});

test('a platform that can be commented on keeps its caption clean', () => {
  for (const p of ['linkedin', 'instagram', 'facebook', 'youtube', 'threads']) {
    assert.equal(platformTable.get(p).linkPlacement, 'comment',
      `${p} must keep the link out of the body`);
  }
});

// build() in yt-description.js appends voice.tagLine() after the blurb, so any
// tag inside the blurb itself prints a second time. It did, live, on one video.
test('the show blurb carries no hashtags of its own', () => {
  assert.ok(!/#\w/.test(voice.showBlurb()),
    'tags in the blurb duplicate the tag line appended after it');
});
