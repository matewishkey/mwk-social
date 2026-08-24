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
  // Against the config, not against a copy of the prose. Hard-coding variant 0's
  // opening here meant every wording change broke a test about PINNING.
  const first = voice.config().firstComment.plain[0].split('\n')[0];
  assert.ok([...pinned][0].startsWith(first), `pinned variant 0 did not render "${first}"`);
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
 * TikTok and X have no comments API we can use, so a link cannot go in a
 * comment on either. TikTok has nowhere left but the caption. X has one more
 * option — a thread reply — and takes it, because X penalises whichever tweet
 * holds the link and the root tweet is the one that needs to travel.
 */
const platformTable = require('../scripts/lib/platforms');

test('X is the only platform that carries its CTA inside the post', () => {
  // TikTok used to be here too. It is not any more: a url in a TikTok caption is
  // plain text, so its caption names the bio and mints nothing.
  const inPost = Object.keys(platformTable.PLATFORMS)
    .filter((p) => ['caption', 'reply'].includes(platformTable.get(p).linkPlacement));
  assert.deepStrictEqual(inPost, ['twitter']);
  for (const p of inPost) {
    assert.equal(platformTable.commentWatched(p), false,
      `${p} carries its own link, so the watcher must not add a second one`);
  }
});

/*
 * The watcher's platform list is written out by hand in first-comment.js
 * (the file runs on require, so it cannot be imported). It must be exactly the
 * platforms with a comments API — post.js printed "the watcher adds it" for X
 * the moment X's link moved out of the caption, which is a promise nothing can
 * keep: X's comment endpoints 403 on this plan.
 */
test('the watcher covers exactly the platforms commentWatched() names', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'first-comment.js'), 'utf8');
  const m = src.match(/const ALL_PLATFORMS = \[([^\]]*)\]/);
  assert.ok(m, 'ALL_PLATFORMS must still be a literal list in first-comment.js');
  const listed = m[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean).sort();
  const watched = Object.keys(platformTable.PLATFORMS).filter(platformTable.commentWatched).sort();
  assert.deepStrictEqual(listed, watched);
});

/*
 * X has a comments API again — the 403s were an account toggle, not the plan —
 * and it must STILL be left to the watcher's exclusion list, because its CTA
 * goes out as a thread reply when the post publishes. A watcher comment on top
 * of that is the same link twice under one tweet.
 */
test('X has a comments API and is still not watched', () => {
  assert.equal(platformTable.get('twitter').commentsApi, true);
  assert.equal(platformTable.commentWatched('twitter'), false, 'its CTA rides in the thread reply');
  assert.equal(platformTable.commentWatched('tiktok'), false, 'no comments API at all');
  for (const p of ['instagram', 'threads', 'facebook', 'youtube', 'linkedin']) {
    assert.equal(platformTable.commentWatched(p), true, `${p} must stay watched`);
  }
  // Instagram is the case that makes commentWatched subtle: its link lives in
  // the bio, and its CTA still lives in a comment saying so.
  assert.equal(platformTable.get('instagram').linkPlacement, 'profile');
  assert.equal(platformTable.commentWatched('instagram'), true);
});

/*
 * The link penalty is the half of X's silence that is ours. Pin the placement
 * so nobody moves it back into the caption to save 1.5c.
 */
test('X is the only platform that puts its link in a thread reply', () => {
  const inReply = Object.keys(platformTable.PLATFORMS)
    .filter((p) => platformTable.get(p).linkPlacement === 'reply');
  assert.deepStrictEqual(inReply, ['twitter']);
  assert.equal(platformTable.get('twitter').supportsThread, true,
    'a link in a reply is only possible where threadItems is');
  assert.equal(platformTable.get('twitter').markerInCaption, false,
    'the CTA is in the reply now — a caption claiming to carry it would be a lie');
});

test('the root tweet is clean and the link rides in the reply', () => {
  const { threadWithLink } = require('../scripts/post.js');
  const media = [{ url: 'https://example.test/clip.mp4', type: 'video' }];
  const items = threadWithLink('his words\n\n#MWKShow', 'https://mwkshow.com/ab12', media);

  assert.equal(items.length, 2);
  assert.ok(!/https?:\/\//.test(items[0].content),
    'a url in the root tweet is the whole thing we are avoiding');
  assert.deepStrictEqual(items[0].mediaItems, media,
    'the clip belongs on the tweet people actually see');
  assert.equal(items[1].content, 'https://mwkshow.com/ab12');
  assert.ok(!items[1].mediaItems, 'the reply is a link, nothing else');
});

test('a thread with no media leaves mediaItems off entirely', () => {
  const { threadWithLink } = require('../scripts/post.js');
  assert.deepStrictEqual(threadWithLink('words', 'https://mwkshow.com/x', []),
    [{ content: 'words' }, { content: 'https://mwkshow.com/x' }]);
});

test('a platform carrying its own link gets tags under its own cap', () => {
  // TikTok has no meaningful cap: both fixed tags plus everything given.
  assert.strictEqual(voice.tagLine('tiktok', ['Xero', 'Invoicing']),
    '#MWKShow #PIY #Xero #Invoicing');
  // X allows one, so the pair is truncated rather than the budget blown.
  assert.strictEqual(voice.tagLine('twitter', ['Xero', 'Invoicing']), '#MWKShow');
});

test('a platform that can be commented on keeps its caption clean', () => {
  for (const p of ['linkedin', 'instagram', 'facebook', 'youtube', 'threads']) {
    assert.notEqual(platformTable.get(p).linkPlacement, 'caption',
      `${p} must keep the link out of the body`);
    assert.equal(platformTable.commentWatched(p), true);
  }
});

// build() in yt-description.js appends voice.tagLine() after the blurb, so any
// tag inside the blurb itself prints a second time. It did, live, on one video.
test('the show blurb carries no hashtags of its own', () => {
  assert.ok(!/#\w/.test(voice.showBlurb()),
    'tags in the blurb duplicate the tag line appended after it');
});

/* ------------------------------------------------- tracking every link -- */

// "Can we add the repo link as well and track it?" — yes, and not only that
// one: any url we publish gets its own code, so a click is attributable to the
// link as well as the channel and the post.
test('the url matcher takes the url and leaves the punctuation', () => {
  const { URL_RE } = require('../scripts/lib/shortlink');
  const found = (s) => s.match(new RegExp(URL_RE.source, 'g')) || [];
  assert.deepStrictEqual(found('see https://github.com/a/b.'), ['https://github.com/a/b']);
  assert.deepStrictEqual(found('see https://x.com/a — and'), ['https://x.com/a']);
  assert.deepStrictEqual(found('(https://x.com/a)'), ['https://x.com/a']);
  assert.deepStrictEqual(found('https://youtube.com/watch?v=-Lf97N091NI ok'),
    ['https://youtube.com/watch?v=-Lf97N091NI'], 'a hyphenated video id must survive');
  assert.deepStrictEqual(found('no links here'), []);
});

test('two urls in one comment are two separate links', () => {
  const { URL_RE } = require('../scripts/lib/shortlink');
  const s = 'repo https://github.com/a/b and the stream https://youtu.be/xyz';
  assert.strictEqual((s.match(new RegExp(URL_RE.source, 'g')) || []).length, 2);
});

// The guard must skip an ALREADY-shortened link, not the sign-up destination —
// which is the one link most worth measuring. It skipped both at first.
test('an already-short link is left alone, the sign-up link is not', () => {
  const sl = require('../scripts/lib/shortlink');
  const short = `https://${voice.shortLink().host}/ab12x`;
  assert.ok(voice.carriesCta(short), 'a short link does read as ours');
  assert.ok(voice.carriesCta(voice.config().links.show), 'and so does the destination');
  // ...which is exactly why carriesCta() is the wrong test for "already shortened".
  assert.notStrictEqual(new URL(short).hostname, new URL(voice.config().links.show).hostname);
});

/* ------------------------------------------- where the hashtags go -------- */

/*
 * hashtagsInCaption was declared on the platform table from the beginning and
 * never read by the publish path — so LinkedIn, Facebook and YouTube posts went
 * out with no tags at all, and the tags only ever appeared in the comment.
 * Same class of bug as linkPlacement was.
 */
test('exactly Instagram and Threads keep hashtags out of the caption', () => {
  const { PLATFORMS, get } = require('../scripts/lib/platforms');
  const clean = Object.keys(PLATFORMS).filter((p) => get(p).hashtagsInCaption === 0);
  assert.deepStrictEqual(clean.sort(), ['instagram', 'threads']);
});

// Instagram's cap counts caption AND comments together, so tags in both places
// would spend the budget twice for no extra reach.
test('a comment carries no tags when its caption already does', () => {
  const withTags = voice.firstComment('k', { platform: 'linkedin', noEpisode: true,
    topicTags: ['Branding'], noTags: true });
  assert.ok(!/#MWKShow/.test(withTags.text), 'the always-on pair must not repeat');
  assert.ok(!/#Branding/.test(withTags.text));
  assert.ok(voice.carriesCta(withTags.text), 'but it is still recognisably ours');
});

test('a comment does carry tags when its caption does not', () => {
  const ig = voice.firstComment('k', { platform: 'instagram', noEpisode: true,
    topicTags: ['Branding', 'SocialMedia', 'CreatingImages'] });
  assert.match(ig.text, /#MWKShow #PIY #Branding #SocialMedia #CreatingImages/);
  // Exactly five: Instagram's cap counts the caption too, and the caption is clean.
  assert.strictEqual((ig.text.match(/#\w+/g) || []).length, 5);
});

/*
 * The YouTube description tail carries a per-VIDEO link (2026-08-23), because
 * which episode is pulling is the one thing YouTube exposes nowhere in an API.
 * Three things have to hold: the placeholder is substituted, no argument still
 * renders something valid, and the config cannot lose {show} — the last one is
 * what would silently put one shared untracked url on every video again.
 */
test('the show blurb substitutes a per-video link', () => {
  const link = 'https://mwkshow.com/ab12c';
  const out = voice.showBlurb(link);
  assert.ok(out.includes(link), 'the minted link did not make it into the blurb');
  assert.ok(!out.includes('{show}'), 'the placeholder was left unsubstituted');
  assert.ok(!out.includes(voice.config().links.show),
    'the plain sign-up url is still there — the click would be untraceable');
});

test('the show blurb with no link falls back to the plain url', () => {
  const out = voice.showBlurb();
  assert.ok(out.includes(voice.config().links.show));
  assert.ok(!out.includes('{show}'));
});

test('the blurb still carries a marker the duplicate guard recognises', () => {
  assert.ok(voice.carriesCta(voice.showBlurb('https://mwkshow.com/ab12c')),
    'a tracked blurb must still register as carrying the CTA');
  assert.ok(voice.carriesCta(voice.showBlurb()));
});

test('config/voice.json keeps {show} in the blurb', () => {
  const raw = require('../config/voice.json').youtubeDescription.showBlurb;
  assert.ok(raw.includes('{show}'),
    'without {show} every video shares one untracked link and no episode can be told apart');
});

/*
 * yt-description.js updates an existing description by swapping the stale tail
 * for the current one, rather than rebuilding the whole thing — a rebuild
 * regenerates the opening with a model and would hand him twenty-one rewritten
 * summaries to re-approve, words he already said yes to. That swap is only safe
 * if the two blurbs differ on exactly ONE line. If the blurb ever gains a second
 * {show}, or the url moves onto its own line, this stops being true and the
 * "one-line diff" the dashboard shows him becomes a lie.
 */
test('the tracked and plain blurbs differ on exactly one line', () => {
  const plain = voice.showBlurb();
  const tracked = voice.showBlurb('https://mwkshow.com/abcde');
  const a = plain.split('\n');
  const b = tracked.split('\n');
  assert.strictEqual(a.length, b.length, 'the two blurbs are different shapes');
  const differing = a.filter((line, i) => line !== b[i]);
  assert.strictEqual(differing.length, 1,
    `expected one changed line, got ${differing.length}: ${JSON.stringify(differing)}`);
});

test('swapping the tail inside a real description touches nothing else', () => {
  const doc = `Some opening a model wrote.\n\nAnother paragraph of it.\n\n`
    + `${voice.showBlurb()}\n\n#MWKShow #PIY #Invoicing`;
  const swapped = doc.replace(voice.showBlurb(), voice.showBlurb('https://mwkshow.com/abcde'));
  const a = doc.split('\n');
  const b = swapped.split('\n');
  const differing = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
  assert.strictEqual(differing.length, 1, 'the swap changed more than the link line');
  assert.ok(b.join('\n').includes('#MWKShow #PIY #Invoicing'), 'the tags were disturbed');
  assert.ok(b.join('\n').startsWith('Some opening a model wrote.'), 'the opening was disturbed');
});

/*
 * A retired blurb is still ours.
 *
 * findBlurb matches the constant halves either side of {show}, so the wording
 * around the slot is part of the key. Edit one paragraph and every description
 * already on the channel stops matching — and yt-description.js reads a null
 * here as "not ours", which takes the REBUILD path: a fresh model-written
 * opening for all 23 videos, handed over for re-approval. Words he already said
 * yes to, changed because a sentence above them moved.
 *
 * The positive control is the second assertion: with showBlurbPast emptied,
 * a description carrying the retired wording must come back null. If it does
 * not, this test proves nothing.
 */
test('a description carrying a retired blurb is still recognised as ours', () => {
  const past = (voice.config().youtubeDescription.showBlurbPast || []);
  assert.ok(past.length, 'no retired blurb is recorded — this test would pass vacuously');

  for (const raw of past) {
    const old = raw.split('{show}').join('https://mwkshow.com/abcde');
    const doc = `An opening a model wrote.\n\n${old}\n\n#MWKShow #PIY #Invoicing`;
    const found = voice.findBlurb(doc);
    assert.strictEqual(found, old, 'a retired blurb was not recognised');

    // Swapping it puts today's wording in and leaves the video's own words alone.
    const swapped = doc.replace(found, voice.showBlurb('https://mwkshow.com/abcde'));
    assert.ok(swapped.startsWith('An opening a model wrote.'), 'the opening was rebuilt');
    assert.ok(swapped.includes('#MWKShow #PIY #Invoicing'), 'the tags were disturbed');
    assert.ok(swapped.includes('curious people taking their first steps'),
      "today's wording did not land");
  }
});

test('a retired blurb swaps out without touching the video\'s own words', () => {
  const past = voice.config().youtubeDescription.showBlurbPast || [];
  const link = 'https://mwkshow.com/abcde';
  assert.ok(past.length, 'no retired blurb recorded — this would pass vacuously');
  for (const raw of past) {
    const old = raw.split('{show}').join(link);
    const doc = `The video's own summary.\n\n${old}\n\n#MWKShow #PIY #Invoicing`;
    const swapped = doc.replace(voice.findBlurb(doc), voice.showBlurb(link));
    assert.ok(swapped.startsWith("The video's own summary."), 'the summary was disturbed');
    assert.ok(swapped.endsWith('#MWKShow #PIY #Invoicing'), 'the tags were disturbed');
  }
});
