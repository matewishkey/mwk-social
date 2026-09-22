/*
 * WHICH FRAME THE PLATFORMS SHOW BEFORE ANYBODY PRESSES PLAY.
 *
 * Mate, 2026-09-22: "the key frames are incorrect". Nothing had failed — we
 * simply never sent a cover, so each platform used its own default, and the
 * defaults disagree: Instagram 0 ms, TikTok 1,000 ms, Pinterest 0 s. On a clip
 * that opens on an empty field, frame 0 is a picture of nothing.
 *
 * What these pin, in the order they can go wrong:
 *
 *   - the UNIT. Pinterest counts seconds, the other two milliseconds. Sending
 *     2000 where 2 is meant asks for a frame 33 minutes into a 38-second clip.
 *   - the DESTINATION. TikTok's field lives in the top-level tiktokSettings,
 *     not on the platform entry — the same trap the six consent flags carry,
 *     and platformSpecificData accepts any key you send it, so getting it
 *     wrong is SILENT.
 *   - the SET. Only three platforms document a cover field. YouTube takes an
 *     image and not a timestamp, and not on a Short at all; the rest document
 *     nothing. A field invented for them would echo back and do nothing.
 */
const test = require('node:test');
const assert = require('node:assert');

const platforms = require('../scripts/lib/platforms');

const CLIP = { durationSec: 37.7, isImage: false, aspect: 0.5625 };
const STILL = { durationSec: 0, isImage: true, aspect: 0.8 };

test('exactly three platforms take a cover timestamp', () => {
  const set = Object.keys(platforms.PLATFORMS)
    .filter((p) => platforms.coverFor(p, 2000)).sort();
  assert.deepStrictEqual(set, ['instagram', 'pinterest', 'tiktok'],
    'a platform joins this set from its own Zernio page, never by assumption');
});

test('the unit is converted per platform, from one number in milliseconds', () => {
  assert.deepStrictEqual(platforms.coverFor('instagram', 2000),
    { where: 'platformSpecificData', fields: { thumbOffset: 2000 } });
  assert.deepStrictEqual(platforms.coverFor('tiktok', 2000),
    { where: 'tiktokSettings', fields: { video_cover_timestamp_ms: 2000 } });
  assert.deepStrictEqual(platforms.coverFor('pinterest', 2000),
    { where: 'platformSpecificData', fields: { coverImageKeyFrameTime: 2 } },
    'SECONDS here — 2000 would be half an hour into a 38-second clip');
});

/*
 * TikTok's is the one that cannot go on the entry. platformSpecificData
 * stores any key it is given, so a misplaced cover field would be echoed back
 * in the create response and change nothing at all.
 */
test('tiktok wants it at the top level and the others on the entry', () => {
  assert.equal(platforms.coverFor('tiktok', 1000).where, 'tiktokSettings');
  for (const p of ['instagram', 'pinterest']) {
    assert.equal(platforms.coverFor(p, 1000).where, 'platformSpecificData');
  }
});

test('a platform that documents no cover gets no field invented for it', () => {
  for (const p of ['youtube', 'facebook', 'linkedin', 'twitter', 'threads']) {
    assert.equal(platforms.coverFor(p, 2000), null, `${p} documents none`);
  }
});

test('the offset is a duration, and it is clamped to inside the clip', () => {
  assert.equal(platforms.coverMsFor(CLIP), platforms.COVER_MS);
  assert.equal(platforms.coverMsFor({ durationSec: 1.2, isImage: false }), 600,
    'a clip shorter than the offset takes its own midpoint, never a frame past the end');
  assert.equal(platforms.coverMsFor(STILL), null, 'a still has no frame to choose');
  assert.equal(platforms.coverMsFor(null), null);
});

test('MWK_COVER_MS moves it, and a typo in it does not stop a publish', () => {
  const was = process.env.MWK_COVER_MS;
  try {
    process.env.MWK_COVER_MS = '3500';
    assert.equal(platforms.coverMsFor(CLIP), 3500);
    process.env.MWK_COVER_MS = 'two seconds';
    assert.equal(platforms.coverMsFor(CLIP), platforms.COVER_MS, 'falls back, never throws');
    process.env.MWK_COVER_MS = '0';
    assert.equal(platforms.coverMsFor(CLIP), 0, 'zero is a real answer — the first frame');
  } finally {
    if (was === undefined) delete process.env.MWK_COVER_MS; else process.env.MWK_COVER_MS = was;
  }
});

/*
 * A FRAME INDEX IS NOT A TIME, and that is why the setting is a duration.
 * "The tenth frame" is 167 ms at 60 fps and 333 ms at 30 — on the clip this
 * came from, both land on the empty field the complaint was about.
 */
test('the default is inside the window the frames actually showed', () => {
  assert.ok(platforms.COVER_MS >= 1000 && platforms.COVER_MS <= 4000,
    'measured on the 2026-09-22 clip: nobody in shot before ~1s, title card gone by 10s');
});

/*
 * The whole point of this being on the table rather than in post.js: the
 * dashboard's workflow page renders the table, and a capability that only
 * exists inside the publisher cannot be read anywhere.
 */
test('a still gets no cover field at all', () => {
  assert.equal(platforms.coverMsFor(STILL), null);
  assert.equal(platforms.coverFor('instagram', null), null,
    'null offset means no field, not thumbOffset: null');
});
