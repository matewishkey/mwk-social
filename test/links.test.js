/*
 * Where a link may be placed, and where it may not.
 *
 * For three weeks the pipeline minted tracked short codes for Instagram
 * comments and TikTok captions. A url is plain text on both — the whole
 * link-in-bio industry exists because of it — so those codes could never be
 * followed. Five TikTok codes took zero human clicks between them, which reads
 * in the numbers as "posted, nobody cared" rather than "never reachable".
 * These tests are the thing that stops it happening again.
 */
const test = require('node:test');
const assert = require('node:assert');

const platforms = require('../scripts/lib/platforms');
const voice = require('../scripts/lib/voice');

test('no platform places its link somewhere it is not clickable', () => {
  assert.deepStrictEqual(platforms.linkProblems(), []);
});

test('every platform states where a url is clickable', () => {
  for (const name of Object.keys(platforms.PLATFORMS)) {
    const c = platforms.get(name).linkClickable;
    assert.ok(c, `${name} has no linkClickable`);
    for (const slot of ['caption', 'comment', 'profile']) {
      assert.equal(typeof c[slot], 'boolean', `${name}.linkClickable.${slot} must be stated`);
    }
  }
});

/*
 * The two that bite. Verified against the platforms themselves, not inferred:
 * Instagram's caption-link test is Meta Verified only and a Reel has no link
 * surface at all; TikTok allows a live link in the bio and nowhere else.
 */
test('Instagram and TikTok are the platforms with no clickable link in a post', () => {
  const dead = Object.keys(platforms.PLATFORMS).filter((p) => {
    const c = platforms.get(p).linkClickable;
    return !c.caption && !c.comment;
  });
  assert.deepStrictEqual(dead.sort(), ['instagram', 'tiktok']);
  for (const p of dead) {
    assert.equal(platforms.get(p).linkPlacement, 'profile',
      `${p} must point at the bio rather than print a url nobody can follow`);
  }
});

test('a platform that can carry a live link never points at the bio instead', () => {
  for (const p of Object.keys(platforms.PLATFORMS)) {
    if (platforms.get(p).linkPlacement !== 'profile') continue;
    const c = platforms.get(p).linkClickable;
    assert.ok(!c.caption && !c.comment,
      `${p} points at the bio although a link in the post would work`);
  }
});

/* ------------------------------------------------ the CTA on a dead-link platform */

test('the bio CTA carries no url at all', () => {
  const t = voice.firstComment('k', { platform: 'instagram', noEpisode: true, linkLive: false }).text;
  assert.ok(!/https?:\/\//.test(t), `a url survived into a bio CTA: ${t}`);
  assert.ok(t.includes(voice.config().firstComment.profileCta));
});

/*
 * If the guard cannot recognise these comments, the hourly watcher re-comments
 * on every Instagram post it can see, for ever. That is not hypothetical: it is
 * the documented failure mode of changing the CTA wording, and the bio phrasing
 * removed the url the guard used to match on.
 */
test('the duplicate guard recognises a bio CTA', () => {
  const t = voice.firstComment('k', { platform: 'instagram', noEpisode: true, linkLive: false }).text;
  assert.ok(voice.carriesCta(t), 'the watcher would re-comment on every one of these');
  assert.ok(voice.config().markers.includes(voice.config().firstComment.profileCta),
    'the bio phrasing must be a marker, or the guard stops seeing its own work');
});

test('an episode variant carrying a url is dropped where urls are dead', () => {
  // The episode link is exactly as unclickable as the CTA one would have been.
  for (let i = 0; i < 40; i++) {
    const t = voice.firstComment(`k${i}`, { platform: 'tiktok', linkLive: false }).text;
    assert.ok(!/https?:\/\//.test(t), `variant ${i} leaked a url: ${t}`);
  }
});

test('a live-link platform still gets the url', () => {
  const t = voice.firstComment('k', { platform: 'linkedin', noEpisode: true,
    showUrl: 'https://mwkshow.com/ab12' }).text;
  assert.ok(t.includes('https://mwkshow.com/ab12'));
  assert.ok(!t.includes(voice.config().firstComment.profileCta));
});

/* ----------------------------------------------------------- campaign plumbing */

/*
 * The redirect hands NOTHING to the destination. The code already carries the
 * platform, the placement and the campaign, so appending utm_ parameters would
 * count the same click twice — once here and once in somebody else's analytics
 * — and would make the redirect look like more tracking than it does. Mate's
 * call, 2026-08-22: keep it slim, and do not appear to over-track.
 */
test('the redirect passes the target through untouched', async () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'web', 'src', 'links.js'), 'utf8');
  assert.ok(!/utm_source|utm_medium|utm_campaign/.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')),
    'no utm parameter may be added to a destination');
  assert.ok(!/withCampaign/.test(src), 'the utm builder should be gone, not just unused');
});

/*
 * Campaign and medium stay in the KEY, though — that is ours, on our side, and
 * it is what makes "which placement earned this" answerable at all.
 */
test('campaign and medium are part of what makes a code unique', async () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'web', 'src', 'api.js'), 'utf8');
  const sel = src.slice(src.indexOf('SELECT code FROM link'), src.indexOf('if (existing)'));
  for (const col of ['target', 'platform', 'clip_id', 'post_key', 'campaign', 'medium']) {
    assert.ok(sel.includes(col), `${col} must be part of the mint key`);
  }
});
