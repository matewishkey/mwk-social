/*
 * YOUTUBE'S COVER IS A PICTURE PUSHED AFTER THE FACT, AND IT DOES LAND ON A
 * SHORT.
 *
 * Both Zernio's YouTube page and this repo's own notes said custom thumbnails
 * "work on videos only, not Shorts". Exercised 2026-09-22 on msRZswGIkCY and
 * checked at YouTube's end rather than by the API's echo: maxresdefault.jpg
 * changed bytes and the picture is ours. What did NOT change is the vertical
 * cover in the Shorts feed.
 *
 * These pin the decision, which is the part that can silently rot. The write
 * itself is one REST call and is proven by the measurement above, not here.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const cover = require('../scripts/lib/cover');
const platforms = require('../scripts/lib/platforms');

const YT = { platform: 'youtube', status: 'published', postId: 'msRZswGIkCY' };
const OPTS = { isVideo: true, coverMs: 2000 };

test('only youtube, only a video, only with the platform id', () => {
  assert.equal(cover.wantsCover(YT, OPTS), true);

  assert.equal(cover.wantsCover({ ...YT, platform: 'tiktok' }, OPTS), false,
    'the other three carry the offset in the publish and need no second call');
  assert.equal(cover.wantsCover({ ...YT, platform: 'instagram' }, OPTS), false);
  assert.equal(cover.wantsCover(YT, { ...OPTS, isVideo: false }), false,
    'a still has no frame to cut');
  assert.equal(cover.wantsCover({ ...YT, postId: null }, OPTS), false,
    'update-metadata is addressed by the PLATFORM video id — the Zernio _id 404s');
  assert.equal(cover.wantsCover({ ...YT, status: 'failed' }, OPTS), false);
  assert.equal(cover.wantsCover({ ...YT, status: 'pending' }, OPTS), false,
    'unknown is not published: there may be no video to put a cover on');
  assert.equal(cover.wantsCover(YT, { ...OPTS, coverMs: null }), false);
});

/*
 * The offset comes from the same place the other three get theirs, so a
 * change to MWK_COVER_MS moves every platform together or the four disagree
 * about which frame the post is meant to show.
 */
test('youtube uses the same offset as the platforms that take a timestamp', () => {
  const probe = { durationSec: 37.7, isImage: false };
  const was = process.env.MWK_COVER_MS;
  try {
    process.env.MWK_COVER_MS = '3000';
    const ms = platforms.coverMsFor(probe);
    assert.equal(ms, 3000);
    assert.equal(cover.wantsCover(YT, { isVideo: true, coverMs: ms }), true);
    assert.deepStrictEqual(platforms.coverFor('tiktok', ms).fields,
      { video_cover_timestamp_ms: 3000 }, 'one number, every platform');
  } finally {
    if (was === undefined) delete process.env.MWK_COVER_MS; else process.env.MWK_COVER_MS = was;
  }
});

/*
 * A real frame off a real file. Two seconds of colour bars is enough to prove
 * ffmpeg seeks, writes, and hands back a jpeg that exists and is not empty —
 * the three ways frameAt() can fail quietly.
 */
test('frameAt cuts a jpeg that exists and has bytes', (t) => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mwk-cover-test-'));
  const clip = path.join(dir, 'bars.mp4');
  try {
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=270x480:rate=30:duration=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip], { stdio: 'ignore' });
  } catch {
    t.skip('no ffmpeg on this box');
    return;
  }
  const jpg = cover.frameAt(clip, 2000);
  assert.ok(fs.existsSync(jpg), 'the frame was written');
  assert.ok(fs.statSync(jpg).size > 0, 'and it is not an empty file');
  assert.match(path.basename(jpg), /^cover-2000ms\.jpg$/,
    'named for the offset — media:upload reads the type off the extension');
  fs.rmSync(path.dirname(jpg), { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});
