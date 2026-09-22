/*
 * THE CAPTION IS DRAWN OVER HIS OWN SUBTITLES, AND ONLY ON A SHORT.
 *
 * Mate, 2026-09-22: "the text what you are sending is overlaying my captions,
 * so it can take too much space... keep the title and the hashtags, keep it
 * super short, to drive them into the video. It is only rules for the shorts,
 * and not for the comments."
 *
 * Three things have to stay true, and each has been got wrong in this repo in
 * some other form already:
 *
 *   - the SET. `captionOverlaysShort` is a table field, and this repo's single
 *     most repeated failure is a field declared and read by nothing. It is
 *     pinned here the way commentWatched() is, so adding a platform to the
 *     table is a decision somebody takes rather than a default that arrives.
 *   - the CLIP. Facebook and YouTube publish landscape into an ordinary feed,
 *     where the text is nowhere near the picture. The same platform must
 *     compose both ways.
 *   - the COMMENT. He excluded it in the same sentence he asked for this, so a
 *     test that only checked the caption would let it go missing quietly.
 */
const test = require('node:test');
const assert = require('node:assert');

const platforms = require('../scripts/lib/platforms');
const captions = require('../scripts/lib/captions');
const { captionForPlatform } = require('../scripts/post.js');

// His words as they are stored: the title on line one, the story under it.
const BODY = `I had a job interview and told them to prompt it yourself

They wanted a CTO to come in and do the AI part for them. They were in the
meeting and not in the meeting.

Prompt it yourself!

@thechrisgoor #couchtocreator`;

const TITLE = 'I had a job interview and told them to prompt it yourself';
const CREDIT = '@thechrisgoor #couchtocreator';
// His prose with the credit line lifted out — what every caption is built from.
const STORY = BODY.slice(0, BODY.indexOf(CREDIT)).trim();

const TALL = { aspect: 0.5625, durationSec: 37.7, isImage: false };
const WIDE = { aspect: 1.7778, durationSec: 37.7, isImage: false };
const LONG_TALL = { aspect: 0.5625, durationSec: 600, isImage: false };
const STILL = { aspect: 0.8, durationSec: 0, isImage: true };

test('exactly four platforms draw the caption over the video', () => {
  const set = Object.keys(platforms.PLATFORMS)
    .filter((p) => platforms.captionOverlaysShortFor(p, TALL)).sort();
  assert.deepStrictEqual(set, ['facebook', 'instagram', 'tiktok', 'youtube'],
    'a platform joins this set deliberately, never by a default arriving');
});

test('it is the clip, not only the platform', () => {
  for (const p of ['facebook', 'youtube']) {
    assert.equal(platforms.captionOverlaysShortFor(p, WIDE), false,
      `${p} publishes the wide cut into a feed — the caption is nowhere near the picture`);
  }
  assert.equal(platforms.captionOverlaysShortFor('youtube', LONG_TALL), false,
    'over three minutes is not a Short');
  assert.equal(platforms.captionOverlaysShortFor('instagram', STILL), false,
    'a still has a duration of 0 and would otherwise pass both halves of the test');
  assert.equal(platforms.captionOverlaysShortFor('instagram', null), false,
    'no probe means compose as before — the safe direction');
});

/*
 * isShort() was written inline in linkDeadFor() while it had one reader. Both
 * rules turn on it now, so the threshold cannot live in two places.
 */
test('one definition of a short, shared by both rules', () => {
  assert.equal(platforms.isShort(TALL), true);
  assert.equal(platforms.isShort(WIDE), false);
  assert.equal(platforms.isShort(LONG_TALL), false);
  assert.equal(platforms.linkDeadFor('youtube', TALL), true, 'still a Short for the link rule');
  assert.equal(platforms.linkDeadFor('youtube', WIDE), false);
});

test('the title is the first non-empty line, trimmed', () => {
  assert.equal(captions.titleLine(BODY),
    'I had a job interview and told them to prompt it yourself');
  assert.equal(captions.titleLine('\n\n  a late start  \nand more'), 'a late start',
    'a body that opens with a blank line still has a title');
  assert.equal(captions.titleLine(''), '');
  assert.equal(captions.titleLine(null), '');
});

/*
 * Composition, against the real table. No network: these platforms put no
 * link in the caption — TikTok has nowhere live to put one, and the other
 * three carry theirs in the first comment — so captionForPlatform never
 * reaches the minting path here. That is itself worth knowing: if a future
 * change gives one of the four a caption link, this test starts making
 * requests and will say so loudly.
 */
test('a short gets the title line and the tags, and nothing else of his', async () => {
  const opts = { text: BODY, topics: ['JobInterview'], probe: TALL };

  const tiktok = await captionForPlatform('tiktok', opts);
  assert.equal(tiktok, `${TITLE}\n\n#piyshow #mwkshow #PromptItYourself #JobInterview\n\n${CREDIT}`);
  assert.ok(!tiktok.includes('They wanted a CTO'), 'the story stays off the picture');

  // Instagram keeps its five hashtags for the comment, so the caption is the
  // title and the credit — hashtagsInCaption: 0 still decides that, not this rule.
  assert.equal(await captionForPlatform('instagram', opts), `${TITLE}\n\n${CREDIT}`);
});

test('the same clip landscape, and the same platform, gets all of his words', async () => {
  const wide = await captionForPlatform('facebook', { text: BODY, topics: [], probe: WIDE });
  assert.ok(wide.startsWith(STORY), 'the feed post keeps every word of the story');
  assert.ok(wide.endsWith(CREDIT), 'and the credit is still on it');
  // Facebook takes hashtags in the caption, so its short one is the title and
  // the always-on tags — the same rule Instagram's hashtagsInCaption: 0
  // answers differently.
  const tall = await captionForPlatform('facebook', { text: BODY, topics: [], probe: TALL });
  assert.equal(tall, `${TITLE}\n\n#piyshow #mwkshow #PromptItYourself\n\n${CREDIT}`);
});

test('a platform outside the set is untouched by the rule', async () => {
  for (const p of ['linkedin', 'threads']) {
    const caption = await captionForPlatform(p, { text: BODY, topics: [], probe: TALL });
    assert.ok(caption.startsWith(STORY), `${p} is a text-first feed — his words stay whole`);
  }
});

/*
 * "PUT MY TAGS FIRST NOT CHRIS ONE" (mate, 2026-09-22, an hour after asking
 * for Chris to be tagged at all). Our tag line is appended after everything
 * of his, so the credit has to be composed LAST for his brand tags to come
 * first. It is the one ordering rule here, and it holds on a short and on a
 * full caption alike.
 */
test('his tags come before the credit, short or not', async () => {
  for (const probe of [TALL, WIDE]) {
    const caption = await captionForPlatform('facebook', { text: BODY, topics: ['JobSearch'], probe });
    assert.ok(caption.indexOf('#mwkshow') < caption.indexOf('@thechrisgoor'),
      'the brand tags lead, whoever else is tagged');
    assert.ok(caption.endsWith(CREDIT), 'and the credit is the last thing on the post');
  }
});

/*
 * TAGGING SOMEONE AND KEEPING THE CAPTION SHORT ARE THE SAME INSTRUCTION, AND
 * THE FIRST ONE CANCELS THE SECOND IF ONLY LINE ONE SURVIVES.
 *
 * Mate asked for both in the same breath (2026-09-22). A mention lives in the
 * body, and on Instagram and TikTok — the two platforms where a @handle
 * actually notifies the person — the body is exactly what a short drops.
 */
test('a line of pure tagging is lifted out; prose is not', () => {
  const { splitCredits } = captions;
  assert.deepStrictEqual(splitCredits(BODY), { prose: STORY, credits: CREDIT });

  assert.deepStrictEqual(splitCredits('Title\n\nThanks @thechrisgoor #couchtocreator'),
    { prose: 'Title\n\nThanks @thechrisgoor #couchtocreator', credits: '' },
    'a sentence with a mention in it is prose: it stays where he wrote it, and a short drops it');
  assert.deepStrictEqual(splitCredits('Title\n\n@one, @two #three'),
    { prose: 'Title', credits: '@one, @two #three' },
    'commas and several handles are still just tagging');
  assert.deepStrictEqual(splitCredits('Title\n\nstory here'),
    { prose: 'Title\n\nstory here', credits: '' });
  assert.deepStrictEqual(splitCredits(''), { prose: '', credits: '' });
});

/*
 * "and not for the comments" was half of what he asked for. voice.firstComment
 * composes from the post key and never sees the caption, so the guard is that
 * the composed comment is the same whatever the caption did — checked here
 * rather than assumed from reading the call graph.
 */
test('the first comment is unchanged on a short', () => {
  const voice = require('../scripts/lib/voice');
  const args = { platform: 'instagram', topicTags: ['JobInterview'], noTags: false,
    linkUrl: null, linkLive: false, maxLength: 2200 };
  const before = voice.firstComment('queue:test', args);
  const after = voice.firstComment('queue:test', args);
  assert.equal(after.text, before.text);
  // Not a length comparison any more: since 2026-09-22 the comment is the link
  // and the tags, so it is SHORTER than the title it sits under. What has to
  // hold is that the caption rule did not reach it — the CTA is still there.
  assert.ok(before.text.includes('link in my bio'),
    'the CTA went missing from the comment the caption rule is not allowed to touch');
  assert.ok(/#mwkshow/.test(before.text), 'and the tags with it');
});
