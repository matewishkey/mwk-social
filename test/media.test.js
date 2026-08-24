/*
 * The media path. check() is pure and always runs; probe() needs a real file,
 * so it makes one with ffmpeg and skips if ffmpeg isn't installed.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const media = require('../scripts/lib/media');

const have = (cmd) => {
  try { execFileSync(cmd, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
};

// A real 9:16 reel, near enough: the shape everything in this pipeline is.
const REEL = { durationSec: 20, width: 720, height: 1280, aspect: 0.5625, bytes: 1 << 20,
  codec: 'h264', hasAudio: true, audioCodec: 'aac' };

test('a normal reel passes on every target', () => {
  for (const platform of ['threads', 'twitter', 'tiktok', 'instagram']) {
    assert.deepEqual(media.check(platform, REEL), [], platform);
  }
});

test('a clip too long for a platform is caught, per platform', () => {
  const long = { ...REEL, durationSec: 400 };
  assert.deepEqual(media.check('instagram', long), []);          // 15 minutes is fine
  assert.match(media.check('threads', long)[0], /over threads's 300s/);
  assert.deepEqual(media.check('tiktok', long), []);             // 10 minutes is fine
});

test('a clip too short for TikTok and Instagram is caught', () => {
  const problems = media.check('tiktok', { ...REEL, durationSec: 2 });
  assert.match(problems[0], /under tiktok's 3s/);
});

// The video range is inclusive at both ends: a square reel is legitimate. The
// "exactly 1.91:1 is rejected" edge that bit us live is an IMAGE rule, and
// applying it here would throw away good video.
test('the aspect range is inclusive at both ends, and landscape is out', () => {
  const [lo, hi] = require('../scripts/lib/platforms').get('instagram').aspectRange;
  assert.deepEqual(media.check('instagram', { ...REEL, aspect: lo }), []);
  assert.deepEqual(media.check('instagram', { ...REEL, aspect: hi }), []);
  assert.match(media.check('instagram', { ...REEL, aspect: 1.91 })[0], /aspect/);
  assert.match(media.check('instagram', { ...REEL, aspect: 0.4 })[0], /aspect/);
});

test('a silent or non-h264 file is flagged', () => {
  assert.deepEqual(media.check('tiktok', { ...REEL, hasAudio: false }), ['no audio track']);
  assert.deepEqual(media.check('tiktok', { ...REEL, codec: 'av01' }), ['codec av01, not h264']);
});

/*
 * 2026-08-21. yt-dlp was asked for avc1 video and plain "best audio", which on
 * YouTube is Opus, and --merge-output-format mp4 muxed it in. Facebook,
 * LinkedIn, YouTube, TikTok and Threads all published it. X uploaded the whole
 * 6.4 MB and failed at 99% with "media processing failed" — the expensive kind
 * of no. Every clip X has accepted was AAC.
 */
test('an Opus track is refused by X and by nobody else', () => {
  const opus = { ...REEL, audioCodec: 'opus' };
  assert.deepEqual(media.check('twitter', opus), ['audio is opus, and twitter only takes aac']);
  for (const platform of ['facebook', 'linkedin', 'youtube', 'tiktok', 'threads', 'instagram']) {
    assert.deepEqual(media.check(platform, opus), [], `${platform} should not care`);
  }
});

// The guard must not fire on a file we could not read an audio codec out of —
// "unknown" is not "wrong", and refusing on it would drop X for no reason.
test('an unknown audio codec is not treated as a wrong one', () => {
  assert.deepEqual(media.check('twitter', { ...REEL, audioCodec: null }), []);
});

test('probe reports what is actually in the file', { skip: !have('ffmpeg') || !have('ffprobe') }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwk-media-test-'));
  const file = path.join(dir, 'clip.mp4');
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=720x1280:d=3:r=30',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', file]);
    const p = media.probe(file);
    assert.equal(p.width, 720);
    assert.equal(p.height, 1280);
    assert.equal(p.aspect, 0.5625);
    assert.equal(p.codec, 'h264');
    assert.equal(p.hasAudio, true);
    assert.equal(p.audioCodec, 'aac');
    assert.ok(Math.abs(p.durationSec - 3) < 0.5, `duration was ${p.durationSec}`);
    assert.deepEqual(media.check('instagram', p), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-https media url is refused before curl ever sees it', () => {
  assert.throws(() => media.downloadDirect('file:///etc/passwd', '/dev/null'), /non-https/);
  assert.throws(() => media.downloadDirect('http://example.com/v.mp4', '/dev/null'), /non-https/);
});

/* ---------------------------------------------------------------- stills -- */

/*
 * A still picture is a different set of rules, not a lenient version of the
 * video ones.
 *
 * The first image ever queued here was dropped by all six platforms and the run
 * failed with "no account can take this post" — which reads like a connection
 * problem and is not one. A still presents as a video stream with one frame, so
 * every video rule fires at once: no audio track, codec png rather than h264,
 * nought seconds against a three-second minimum.
 */
const IMAGE = { isImage: true, durationSec: 0, width: 1200, height: 825, aspect: 1.4545,
  bytes: 1246686, codec: 'png', hasAudio: false, audioCodec: null };

test('a still is judged on image rules, not on audio and h264', () => {
  for (const platform of ['instagram', 'threads', 'facebook', 'linkedin', 'twitter']) {
    assert.deepStrictEqual(media.check(platform, IMAGE), [],
      `${platform} refused a perfectly ordinary picture`);
  }
});

test('imageOk is read, not decorative', () => {
  // Five fields on the platform table have shipped declared-but-never-wired.
  // This one says a platform cannot take a still at all, and it has to bite.
  for (const platform of ['youtube', 'tiktok']) {
    const problems = media.check(platform, IMAGE);
    assert.equal(problems.length, 1, `${platform} accepted a still picture`);
    assert.match(problems[0], /no way to post a still picture/);
  }
});

test("Instagram's image range is not its video range, and 1.91 is the edge", () => {
  const at = (aspect) => media.check('instagram', { ...IMAGE, aspect });
  assert.deepStrictEqual(at(1.78), [], 'a 16:9 picture should pass');
  assert.deepStrictEqual(at(0.8), [], 'a 4:5 picture should pass');
  // Exactly 1.91:1 is rejected live — a float edge, and the fix is to pad the
  // source to ~1.78, never to widen the tolerance.
  assert.equal(at(1.91).length, 1, 'exactly 1.91:1 must still be refused');
  assert.equal(at(0.5).length, 1, 'a 9:16 picture is outside the image range');
  // The VIDEO range tops out at square; conflating the two would reject this.
  assert.deepStrictEqual(media.check('instagram',
    { isImage: false, durationSec: 20, aspect: 1.0, codec: 'h264', hasAudio: true, audioCodec: 'aac' }),
  [], 'a square reel is legitimate and the image edge must not reach it');
});

test('a video is still judged on video rules', () => {
  const silent = { isImage: false, durationSec: 20, aspect: 0.5625, codec: 'h264',
    hasAudio: false, audioCodec: null };
  assert.ok(media.check('instagram', silent).includes('no audio track'),
    'the image branch swallowed the video rules');
});

test('ffprobe says a PNG is a still', { skip: !have('ffmpeg') || !have('ffprobe') }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'still-'));
  const file = path.join(dir, 'x.png');
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=1200x825',
      '-frames:v', '1', '-y', file], { stdio: 'ignore' });
    const p = media.probe(file);
    assert.equal(p.isImage, true, 'a PNG was not recognised as a still');
    assert.equal(p.hasAudio, false);
    assert.deepStrictEqual(media.check('facebook', p), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
