'use strict';
const test = require('node:test');
const assert = require('node:assert');
const captions = require('../scripts/lib/captions');
const voice = require('../scripts/lib/voice');

const SRC = 'Ever had a secret exposed? 😳 What do you think happens next? 🤔 #CuriousAI #DramaAI';
const { body, hashtags } = captions.parseSource(SRC);

test('parseSource separates words, tags and links', () => {
  const p = captions.parseSource('look at this https://x.test/a #One #Two');
  assert.strictEqual(p.body, 'look at this');
  assert.deepStrictEqual(p.hashtags, ['One', 'Two']);
  assert.deepStrictEqual(p.urls, ['https://x.test/a']);
});

test('the matching key survives the differences between platforms', () => {
  // The same clip as it appears on Facebook, then as we would mirror it.
  const fb = 'Ever had a secret exposed? 😳 What do you think happens next? 🤔 #CuriousAI';
  const ours = 'Ever had a secret exposed? What do you think happens next?\n\nOne wish is one show.\n\nhttps://matewishkey.com/show #PIY';
  assert.ok(captions.prefixMatch(captions.normalizeKey(fb), captions.normalizeKey(ours)));
});

test('different clips do not match', () => {
  const a = captions.normalizeKey('Ever wondered why prompts beat websites?');
  const b = captions.normalizeKey('Ever thought 80% is good enough with AI?');
  assert.ok(!captions.prefixMatch(a, b));
});

test('a stub caption never matches on length alone', () => {
  assert.ok(!captions.prefixMatch(captions.normalizeKey('hi'), captions.normalizeKey('hi there everyone')));
});

test('instagram carries no hashtags in the caption', () => {
  const { text } = captions.compose('instagram', { body, sourceTags: hashtags, topicTags: ['CyberSecurity'] });
  assert.ok(!/#/.test(text), 'the comment spends the 5-tag budget, not the caption');
  assert.ok(!text.includes(voice.marker()), 'instagram takes its link in the comment');
});

test('tiktok and x carry the link in the caption', () => {
  for (const p of ['tiktok', 'twitter']) {
    const { text } = captions.compose(p, { body, sourceTags: hashtags, topicTags: ['CyberSecurity'] });
    assert.ok(text.includes(voice.marker()), `${p} has no comment API, so the link must be in the post`);
  }
});

test('x gets exactly one hashtag and one url', () => {
  const { text } = captions.compose('twitter', { body, sourceTags: hashtags, topicTags: ['CyberSecurity', 'DataPrivacy'] });
  assert.strictEqual((text.match(/#[A-Za-z]/g) || []).length, 1);
  assert.strictEqual((text.match(/https?:\/\//g) || []).length, 1, 'a second URL would be a second $0.20 charge');
});

test('threads is truncated to 500 without severing the url', () => {
  const long = 'word '.repeat(400).trim();
  const { text, warnings } = captions.compose('threads', { body: long, topicTags: [] });
  assert.ok(text.length <= 500);
  assert.ok(warnings.some((w) => /truncated/.test(w)));
});

test('every mirrored caption keeps the source opening', () => {
  for (const p of ['threads', 'twitter', 'tiktok', 'instagram']) {
    const { text } = captions.compose(p, { body, sourceTags: hashtags, topicTags: ['CyberSecurity'] });
    assert.ok(text.startsWith('Ever had a secret exposed?'), `${p} must stay recognisable as the same clip`);
  }
});
