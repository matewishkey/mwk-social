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

/*
 * The SET comes off the table, not a literal in cover.js. Every other
 * platform's Zernio page was read on 2026-09-22 and none documents a cover of
 * any kind — including X, whose page is /platforms/twitter (the /x URL 404s,
 * which briefly got written down as "X has no page").
 */
test('youtube is the only platform that takes a cover image', () => {
  const set = Object.keys(platforms.PLATFORMS)
    .filter((p) => platforms.coverImageFor(p)).sort();
  assert.deepStrictEqual(set, ['youtube']);
});

/*
 * THE LIBRARY BEING RIGHT IS NOT THE PUBLISHER CALLING IT.
 *
 * `cover.js` was exercised by hand on msRZswGIkCY before the wiring landed, so
 * the REST call is proven — but no publish had run since, and a cover step
 * nothing invokes prints nothing and looks exactly like a clip that did not
 * need one. That is this repo's most repeated failure wearing its other face:
 * five table fields shipped declared-and-never-read, and here the reader is
 * what would be missing. Source-read, like the dashboard's SQL and mint()'s
 * ordering, because the behaviour needs a live publish.
 */
test('run-queue actually calls the cover step, after the publish and inside a catch', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-queue.js'), 'utf8');

  assert.ok(s.includes("require('./lib/cover')"), 'run-queue must load the cover library');
  const callAt = s.indexOf('cover.setYoutubeCover(');
  assert.ok(callAt > 0, 'run-queue must actually push a cover — the library is not the feature');

  // AFTER the publish: the video has to exist before a thumbnail can be set,
  // and `outcome` is what proves the publish returned.
  const outcomeAt = s.indexOf('for (const o of outcome)');
  assert.ok(outcomeAt > 0 && outcomeAt < callAt, 'the cover goes on after the publish, not before');

  // The offset comes off the table, never a literal here — MWK_COVER_MS has to
  // move this without a deploy, and a second copy of 2000 would not notice.
  assert.ok(s.includes('platforms.coverMsFor('), 'the offset must come from the table');
  assert.ok(!/setYoutubeCover\(\{[^}]*ms:\s*\d/.test(s), 'the offset must not be a literal at the call');

  // The post is already live: a failed cover is a journal line, never the
  // item's verdict. Pin that the call sits inside its own try/catch.
  const tryAt = s.lastIndexOf('try {', callAt);
  const catchAt = s.indexOf('catch', callAt);
  assert.ok(tryAt > outcomeAt, 'the cover needs its OWN try, not the publish\'s');
  assert.ok(catchAt > callAt && s.slice(callAt, catchAt).length < 400,
    'the catch has to be the one wrapping this call');
});

test('the two mechanisms do not overlap', () => {
  for (const p of Object.keys(platforms.PLATFORMS)) {
    const both = platforms.coverFor(p, 2000) && platforms.coverImageFor(p);
    assert.ok(!both, `${p} would be sent a cover twice, by two different routes`);
  }
});

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
