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
const REEL = { durationSec: 20, width: 720, height: 1280, aspect: 0.5625, bytes: 1 << 20, codec: 'h264', hasAudio: true };

test('a normal reel passes on every target', () => {
  for (const platform of require('../scripts/lib/platforms').MIRROR_TARGETS) {
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
