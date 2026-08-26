/*
 * The GALLERY: several stills riding in one post.
 *
 * Added 2026-08-27 with `imageMax`, which is read by galleryFor() and nowhere
 * else. That is the point of these tests. This repo has shipped linkPlacement,
 * landscapeOk, hashtagsInCaption and shortsAreDead as fields declared on the
 * platform table and read by nothing, and the config page renders them, which
 * makes an unread field look implemented. Every assertion below fails if the
 * wiring is pulled out and the field goes back to being decoration.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const platforms = require('../scripts/lib/platforms');

const imgs = (n) => Array.from({ length: n }, (_, i) => ({ file: `i${i}.png`, probe: { isImage: true } }));

test('the table agrees with itself about galleries', () => {
  assert.deepStrictEqual(platforms.galleryProblems(), []);
});

test('every platform declares an imageMax, and it matches whether it takes a still', () => {
  for (const name of Object.keys(platforms.PLATFORMS)) {
    const p = platforms.get(name);
    assert.ok(Number.isFinite(p.imageMax), `${name} has no imageMax`);
    assert.strictEqual(p.imageMax > 0, !!p.imageOk, `${name}: imageOk and imageMax disagree`);
  }
});

test('each platform is capped at its own documented limit', () => {
  // Zernio's own platform pages, read 2026-08-27.
  const want = { linkedin: 20, facebook: 10, instagram: 10, threads: 10, twitter: 4 };
  for (const [name, max] of Object.entries(want)) {
    assert.strictEqual(platforms.galleryFor(name, imgs(25)).length, max, name);
  }
});

test("X's cap is lower than the rest, so it cannot share their request", () => {
  // The bug this prevents: grouping on the first file alone put X in
  // LinkedIn's group and would have sent it twenty images.
  const six = imgs(6);
  const x = platforms.galleryFor('twitter', six).map((m) => m.file);
  const li = platforms.galleryFor('linkedin', six).map((m) => m.file);
  assert.notDeepStrictEqual(x, li);
  assert.strictEqual(x.length, 4);
  assert.strictEqual(li.length, 6);
});

test('a set with a video in it collapses to one item, never a mixed post', () => {
  // One video per post is a hard limit everywhere, and images and videos
  // cannot be mixed either.
  const mixed = [{ file: 'a.png', probe: { isImage: true } },
    { file: 'b.mp4', probe: { isImage: false } },
    { file: 'c.png', probe: { isImage: true } }];
  assert.deepStrictEqual(platforms.galleryFor('linkedin', mixed).map((m) => m.file), ['a.png']);
});

test('a platform that takes no still at all gets nothing', () => {
  for (const name of ['youtube', 'tiktok']) {
    assert.deepStrictEqual(platforms.galleryFor(name, imgs(3)), [], name);
  }
});

test('one item stays one item, unprobed or not', () => {
  // The single-media path must be untouched by any of this: it is every post
  // this pipeline has made until today.
  assert.strictEqual(platforms.galleryFor('youtube', [{ file: 'v.mp4' }]).length, 1);
  assert.strictEqual(platforms.galleryFor('instagram', [{ file: 'v.mp4' }]).length, 1);
});

test('run-queue groups on EVERY file in the set, not just the first', () => {
  // Positive control for the grouping key. Keying on the first file alone is
  // the natural way to write this and is wrong: X and LinkedIn share a first
  // image and must not share a request.
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-queue.js'), 'utf8');
  assert.match(src, /set\.map\(\(m\) => m\.file\)\.join\(/,
    'the group key no longer covers the whole set');
  assert.ok(!/const key = cut \? cut\.file : ''/.test(src),
    'grouping went back to keying on the single cut');
});

test('run-queue checks every image in the set against the platform', () => {
  // The hole this closes: check() ran on the cut only, so a second image
  // outside a platform's aspect range reached Zernio unchecked with the item
  // already claimed.
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-queue.js'), 'utf8');
  assert.match(src, /for \(const m of setFor\(a\.platform\)\)/,
    'the usable filter no longer walks the whole set');
});

test('queue-add carries a gallery into the INSERT, and NULL when there is none', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'queue-add.js'), 'utf8');
  assert.match(src, /media_extra/, 'queue-add stopped writing media_extra');
  // NULL, not '[]': the Worker tests the column for truthiness and the string
  // '[]' is truthy.
  assert.match(src, /extraKeys && extraKeys\.length\) \? JSON\.stringify\(extraKeys\) : null/);
});

test('the Worker hands the gallery back on claim', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'api.js'), 'utf8');
  assert.match(src, /mediaExtraUrls/, 'the claim response dropped the gallery');
  assert.match(src, /media_extra/, 'the Worker stopped reading the column');
});

test('the schema has the column the Worker reads', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'schema.sql'), 'utf8');
  assert.match(src, /media_extra\s+TEXT/, 'queue_item lost media_extra');
});
