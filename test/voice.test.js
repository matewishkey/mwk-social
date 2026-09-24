'use strict';
const test = require('node:test');
const assert = require('node:assert');
const voice = require('../scripts/lib/voice');

const KEYS = Array.from({ length: 20 }, (_, i) => `instagram:1814681423553${String(i).padStart(4, '0')}`);

/*
 * THE VARIANTS THE MACHINERY TESTS RUN AGAINST, as a fixture rather than
 * whatever config/voice.json happens to say today.
 *
 * It said nine prose variants and three episode ones this morning. By the
 * afternoon it said `{show}` and nothing else — mate, 2026-09-22: "we do not
 * have to ask a question, just the link... I do not want to push folks". Ten
 * tests went red, and not one of them was about the thing that changed: they
 * were rotation, pinning and the give-up order, all still in voice.js and all
 * still having to work the day a second variant comes back.
 *
 * So the CONTENT lives in config/voice.json and is asserted once, below, for
 * what it now is. The BEHAVIOUR is exercised here against a config that
 * cannot be edited out from under it.
 */
const FIXTURE = {
  plain: [
    'Why let others solve your problems with AI?\nPrompt it yourself!\n\n{show}',
    'Something you wish your computer did. That is the whole show.\n\n{show}',
    'You keep what we build, and you can change it without me.\n\n{show}',
    'Your problem, your computer, built while we talk.\n\n{show}',
    'Nobody who has been on the show had written a line of code before.\n\n{show}',
    'Every episode is online, start to finish: {episodes}\n\n{show}',
  ],
  episode: [
    '"{wish}"\n\nThat is what someone brought to the show. {episodeTitle}.\n\n{show}',
    'Someone turned up and said: "{wish}"\n\nWe built it, unedited: {episodeUrl}\n\n{show}',
  ],
  episodeMixRatio: 0.4,
};

/** A config file with the fixture variants in it, plus any override. */
function richConfig(extra = {}) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const cfg = JSON.parse(JSON.stringify(voice.config()));
  Object.assign(cfg.firstComment, JSON.parse(JSON.stringify(FIXTURE)));
  const mut = extra(cfg) ?? cfg;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voice-rich-')), 'voice.json');
  fs.writeFileSync(file, JSON.stringify(mut));
  return file;
}

/*
 * Run an expression against that config, in a child process — MWK_VOICE_CONFIG
 * is read once at require time, so there is no way to do it in-process.
 */
function inConfig(configPath, fnSource) {
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, ['-e',
    'const v=require(process.env.V);process.stdout.write(JSON.stringify((' + fnSource + ')(v)))'],
  { env: { ...process.env, MWK_VOICE_CONFIG: configPath, V: require.resolve('../scripts/lib/voice') },
    stdio: 'pipe', encoding: 'utf8' });
  return JSON.parse(out);
}


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
  const file = richConfig(() => {});
  const indexes = inConfig(file, `(v) => ${JSON.stringify(KEYS)}.reduce((acc, k) => {
    const r = v.firstComment(k, { platform: 'instagram', noEpisode: true, avoidIndex: acc.last });
    acc.pairs.push([acc.last, r.index]); acc.last = r.index; return acc;
  }, { last: -1, pairs: [] }).pairs`);
  for (const [last, got] of indexes) assert.notStrictEqual(got, last);
});

test('the rotation actually varies', () => {
  const file = richConfig(() => {});
  const seen = inConfig(file, `(v) => [...new Set(${JSON.stringify(KEYS)}
    .map((k) => v.firstComment(k, { platform: 'instagram', noEpisode: true }).text))].length`);
  assert.ok(seen >= 4, `only ${seen} distinct comments across 20 posts`);
});

/*
 * And the live config, which is the other half: one variant, no question, no
 * ask. Asserted on the RENDERED comment rather than on the file, because what
 * he objected to was what goes under the post.
 */
test('the comment is the link and nothing else', () => {
  const text = voice.firstComment('instagram:1', { platform: 'facebook', noTags: true,
    linkUrl: 'https://mwkshow.com/xxxxx', linkLive: true }).text;
  assert.strictEqual(text, 'https://mwkshow.com/xxxxx',
    'the comment grew prose again — mate, 2026-09-22: just the link');
  assert.strictEqual(voice.config().firstComment.plain.length, 1,
    'a second variant is a content decision and needs his word');
  assert.strictEqual((voice.config().firstComment.episode || []).length, 0,
    'the episode variants quoted a wish and asked for yours; that is the pushing he stopped');
});

test('instagram never exceeds five hashtags', () => {
  const line = voice.tagLine('instagram', ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.strictEqual(line.split(' ').length, 5);
});

test('a cap tighter than the always-on set truncates the set', () => {
  // X allows one tag. Truncating beats blowing the budget, and the first of
  // his three is the one that survives — he ordered them.
  assert.strictEqual(voice.tagLine('twitter', ['A', 'B']), '#mwkshow');
});

/*
 * Threads makes the FIRST hashtag of a post its one topic tag and leaves every
 * other one as plain text. Measured 2026-09-23 off our own comments: each read
 * back as "piyshow #mwkshow #PromptItYourself ..." with the first # consumed.
 */
test('threads gets one tag, because it only ever links one', () => {
  assert.strictEqual(voice.tagLine('threads', ['A', 'B']), '#mwkshow');
});

test('the brand tag is on every post that has room for it', () => {
  for (const p of ['instagram', 'tiktok', 'facebook']) {
    assert.ok(voice.tagLine(p, ['Trading']).includes('#mwkshow'), `${p} lost the brand tag`);
  }
});

/*
 * Reversed 2026-09-22. "Prompt it Yourself is a sentence, not a tag" was the
 * 2026-08 call and this test pinned it; he then named #PromptItYourself as one
 * of the three always-on tags outright. The spelling is his, CamelCase.
 */
test('promptityourself is a tag, spelled his way (lowercase since 2026-09-24)', () => {
  assert.ok(voice.tagLine('facebook', ['Trading']).includes('#promptityourself'));
});

test('blocked tags never get through', () => {
  const line = voice.tagLine('facebook', ['ai', 'viral', 'Trading', 'fyp']);
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
  const file = richConfig(() => {});
  const out = inConfig(file, `(v) => {
    const texts = ['a','b','c'].flatMap((k) => ['instagram','facebook','youtube']
      .map((p) => v.firstComment(k, { platform: p, variantIndex: 0 }).text));
    return { texts: [...new Set(texts)], first: v.config().firstComment.plain[0].split('\\n')[0] };
  }`);
  assert.strictEqual(out.texts.length, 1, 'pinning still varied the comment');
  assert.ok(out.texts[0].startsWith(out.first), `pinned variant 0 did not render "${out.first}"`);
});

test('pinning a variant that does not exist is refused', () => {
  assert.throws(() => voice.firstComment('k', { platform: 'facebook', variantIndex: 99 }));
  assert.throws(() => voice.firstComment('k', { platform: 'facebook', variantIndex: -1 }));
});

test('the motto tag rides along wherever there is room', () => {
  for (const p of ['instagram', 'tiktok', 'facebook', 'youtube', 'linkedin']) {
    assert.ok(voice.tagLine(p, ['VPN']).includes('#promptityourself'), `${p} lost the motto tag`);
  }
  // Instagram's budget is the binding one: three always-on leaves two topic
  // slots. That is the cost of his three, and he chose it.
  assert.strictEqual(voice.tagLine('instagram', ['A', 'B', 'C', 'D']).split(' ').length, 5);
  assert.strictEqual(voice.tagLine('instagram', ['A', 'B', 'C', 'D']), '#mwkshow #piy #promptityourself #A #B');
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
  assert.ok(!voice.carriesCta('this is brilliant, where can I get it'));
  assert.ok(!voice.carriesCta('https://elgato.com/marketplace/whatever'),
    'somebody else\'s site is not our CTA, however relevant it is');
});

/*
 * A LINK TO HIS OWN SITE COUNTS AS OURS, WHOEVER TYPED IT — and that is a
 * deliberate trade, not an oversight (2026-09-22). Since a post can point at
 * its own page rather than at the show, the comment under it carries
 * matewishkey.com/projects/... and no marker would have matched it; the
 * watcher would then add a SECOND comment under every such post, for ever.
 *
 * The cost is the other direction: a viewer who links his site in a comment
 * makes the watcher skip that post. That is a missing comment, which we can
 * add by hand, against a duplicate one, which on Instagram cannot even be
 * deleted. The cheap failure was chosen on purpose.
 */
test('any link to his own site reads as the CTA already being there', () => {
  assert.ok(voice.carriesCta('https://matewishkey.com/projects/dial-countdown/'));
  assert.ok(voice.carriesCta('https://matewishkey.com/episodes/e010/'));
  assert.ok(voice.config().markers.includes('matewishkey.com/'),
    'drop this marker and every post pointing at its own page gets commented on twice');
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
    linkUrl: 'https://mwkshow.com/ab12x' });
  assert.match(short.text, /mwkshow\.com\/ab12x/);
  assert.ok(!short.text.includes('matewishkey.com/show'));
  assert.ok(voice.carriesCta(short.text), 'and it still reads as ours');
});

test('without a short link it falls back to the plain URL rather than failing', () => {
  const plain = voice.firstComment('k1', { platform: 'threads', noEpisode: true, linkUrl: null });
  assert.match(plain.text, /matewishkey\.com\/show/);
  assert.ok(voice.carriesCta(plain.text));
});

// Same post, same rendering — or the guard sees a different comment each run.
test('the same post renders the identical comment twice running', () => {
  const a = voice.firstComment('post-42', { platform: 'instagram', noEpisode: true, linkUrl: 'https://mwkshow.com/zz' });
  const b = voice.firstComment('post-42', { platform: 'instagram', noEpisode: true, linkUrl: 'https://mwkshow.com/zz' });
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
 * A 403 ON A LIVE STREAM'S COMMENTS IS TRANSIENT, AND RECORDING IT AS PERMANENT
 * COST TWO STREAMS THEIR CTA (2026-09-13). YouTube closes the comments endpoint
 * while a stream is live, so the 10:00 run on a stream that ended at 10:18 wrote
 * "closed" for ever; at 21:55 the comments read fine and neither video had one.
 *
 * The invariant worth pinning is the pair: a 403 inside the window writes a
 * retryUntil, and the pending filter reads it. Either half alone is the
 * declared-and-never-read trap. And the window must stay UNDER the default
 * collection window, or the retry falls due after the post has left the sweep.
 */
test('a 403 on the comment read is retried, not written off for ever', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'first-comment.js'), 'utf8');

  const retry = src.match(/const COMMENTS_403_RETRY_HOURS = Number\(process\.env\.\w+ \|\| (\d+)\)/);
  assert.ok(retry, 'the 403 retry window must stay a named constant in first-comment.js');

  // The 403 branch has to record the deadline, or nothing ever comes back to it.
  const closed = src.slice(src.indexOf('if (closed) {'), src.indexOf('if (done) {'));
  assert.ok(/retryUntil/.test(closed), 'the 403 branch must write a retryUntil');
  assert.ok(/COMMENTS_403_RETRY_HOURS/.test(closed), 'the deadline must come from the constant');

  // ...and the pending filter has to read it back.
  const pending = src.match(/const pending = posts\.filter\(([^;]*)\);/);
  assert.ok(pending, 'the pending filter must still be a one-liner over state');
  assert.ok(/isRetryable/.test(pending[1]),
    'a state entry inside its retry window must come back as pending');
  assert.ok(/retryUntil/.test(src.match(/const isRetryable = [^;]*;/)[0]),
    'isRetryable must key off retryUntil');

  // Positive control on the same parse: the caption grace is a sibling constant
  // and this regex finds it, so failing to find the 403 one means it is gone.
  const caption = src.match(/const CAPTION_GRACE_HOURS = Number\(process\.env\.\w+ \|\| (\d+)\)/);
  assert.ok(caption, 'positive control: CAPTION_GRACE_HOURS parses the same way');

  const hours = src.match(/opts = \{ hours: (\d+)/);
  assert.ok(hours, 'the default collection window must stay readable');
  assert.ok(Number(retry[1]) < Number(hours[1]),
    `a ${retry[1]}h retry never comes due inside a ${hours[1]}h sweep`);
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
/*
 * X's link is in the TWEET now (2026-08-24). The thread existed to dodge a
 * penalty that is not in the open-sourced ranker, and it cost something
 * certain: oon_retweet_reply_filter.rs drops an out-of-network reply before the
 * For You candidate set, so the CTA reached followers only.
 *
 * threadWithLink() was kept for three weeks "in case"; it went on 2026-09-14
 * with the rest of the dead code. git has it (f8a2490 and before) if X ever
 * makes a reply reach a non-follower again.
 */
test('no platform posts its link as a thread reply any more', () => {
  const inReply = Object.keys(platformTable.PLATFORMS)
    .filter((p) => platformTable.get(p).linkPlacement === 'reply');
  assert.deepStrictEqual(inReply, [], 'the thread CTA is back — was that deliberate?');
  assert.equal(platformTable.get('twitter').linkPlacement, 'caption',
    "X's link belongs in the tweet, where a non-follower can see it");
  // 'reply' is no longer a placement anything builds: a platform set to it
  // would place its link nowhere. The table check is what refuses that.
  assert.ok(!('reply' in platformTable.SLOT) || platformTable.SLOT.reply === 'caption',
    'reply must stay a synonym of caption in SLOT, or be removed with the code that read it');
});

test('a platform carrying its own link gets tags under its own cap', () => {
  // TikTok has no meaningful cap: all three fixed tags plus everything given.
  assert.strictEqual(voice.tagLine('tiktok', ['Xero', 'Invoicing']),
    '#mwkshow #piy #promptityourself #Xero #Invoicing');
  // X allows one, so the set is truncated rather than the budget blown.
  assert.strictEqual(voice.tagLine('twitter', ['Xero', 'Invoicing']), '#mwkshow');
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
  assert.ok(!/#mwkshow/.test(withTags.text), 'the always-on tags must not repeat');
  assert.ok(!/#Branding/.test(withTags.text));
  assert.ok(voice.carriesCta(withTags.text), 'but it is still recognisably ours');
});

test('a comment does carry tags when its caption does not', () => {
  const ig = voice.firstComment('k', { platform: 'instagram', noEpisode: true,
    topicTags: ['Branding', 'SocialMedia', 'CreatingImages'] });
  // Three always-on plus three topics is six; Instagram's five drops the last topic.
  assert.match(ig.text, /#mwkshow #piy #promptityourself #Branding #SocialMedia(?! #CreatingImages)/);
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
    /*
     * TODAY'S BLURB, not a copy of its words. This asserted the phrase
     * "curious people taking their first steps" and went red on 2026-09-22
     * when the blurb was rewritten — the change was correct and the test was
     * a transcript of the old prose, which is the dangerous direction: the
     * obvious reading is that the edit broke something. The invariant is that
     * the swap lands whatever showBlurb() currently says.
     */
    assert.ok(swapped.includes(voice.showBlurb('https://mwkshow.com/abcde')),
      "today's wording did not land");
  }
});

/*
 * The 2026-08-25 blurb ends with its link slot, and the one it retired shares
 * every word before that slot — they differ only by the trailing "Live on ..."
 * line. So BOTH patterns match a description still carrying that line, and the
 * newer one matches a strict PREFIX of the older.
 *
 * First-match-wins returned the shorter one, and the swap then replaced the
 * prose and left the Live line sitting underneath, orphaned — the exact line
 * the change exists to delete, surviving the change. Longest wins instead.
 */
test('swapping an old description swallows its Live line rather than orphaning it', () => {
  const past = voice.config().youtubeDescription.showBlurbPast || [];
  const retired = past.find((b) => /twitch/i.test(b));
  assert.ok(retired, 'the blurb carrying the Live line must stay in showBlurbPast');

  const old = retired.split('{show}').join('https://mwkshow.com/abcde');
  const doc = `The video's own summary.\n\n${old}\n\n#MWKShow #PIY`;

  const found = voice.findBlurb(doc);
  assert.ok(/twitch/i.test(found),
    'findBlurb stopped short of the Live line — the swap would leave it behind');

  const swapped = doc.replace(found, voice.showBlurb('https://mwkshow.com/s3'));
  assert.ok(!/twitch/i.test(swapped), 'Twitch survived the swap');
  assert.ok(!/youtube\.com\/@/i.test(swapped), 'the channel line survived the swap');
  assert.ok(swapped.startsWith("The video's own summary."), 'his words were disturbed');
  assert.ok(swapped.endsWith('#MWKShow #PIY'), 'the tags were disturbed');
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

/*
 * The archive line, and the rule it forced.
 *
 * A variant carrying a second url is dead weight on Instagram and TikTok, where
 * nothing in a comment is clickable. That drop used to test for `{episodeUrl}`
 * by name, which was right for exactly as long as that was the only variant
 * with a link in it — this one would have printed a dead matewishkey.com URL
 * under every Instagram post, the same mistake the pipeline was fixed for on
 * 2026-08-22. The test is now any url in any form.
 */
test('the archive line renders its address, and only where a link works', () => {
  const file = richConfig(() => {});
  const cfg = voice.config();
  const idx = FIXTURE.plain.findIndex((v) => v.includes('{episodes}'));
  assert.ok(idx >= 0, 'the fixture has no {episodes} variant — this would pass vacuously');

  const rendered = inConfig(file,
    `(v) => v.firstComment('k', { platform: 'facebook', variantIndex: ${idx} }).text`);
  assert.ok(rendered.includes(cfg.links.episodes), 'the archive address did not render');

  // Where urls are dead the whole variant leaves the pool, so no key can draw
  // it. This one holds for the LIVE config too and is the more important half:
  // a code spent where nobody can click it reads as indifference.
  const dead = inConfig(file, `(v) => ['instagram','tiktok'].flatMap((platform) =>
    ['a','b','c','d','e','f','g','h','i','j'].map((key) =>
      [platform, v.firstComment(key, { platform, linkLive: false }).text,
       v.tagLine(platform, [])]))`);
  for (const [platform, t, tags] of dead) {
    assert.ok(!t.includes(cfg.links.episodes),
      `${platform} drew a comment carrying a url nobody can click: ${t}`);
    assert.ok(!/https?:\/\//.test(t.replace(tags, '')),
      `${platform} drew a comment with a url in it: ${t}`);
  }
});

test('a variant asking for {episodes} with no address configured is refused', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  // The fixture, because the guard only fires when a variant ASKS for the
  // address and the live config no longer has one.
  const bad = richConfig((cfg) => { delete cfg.links.episodes; });
  const { execFileSync } = require('child_process');
  assert.throws(() => execFileSync(process.execPath, ['-e', 'require(process.env.V).config()'],
    { env: { ...process.env, MWK_VOICE_CONFIG: bad, V: require.resolve('../scripts/lib/voice') },
      stdio: 'pipe' }));
});

test('nothing claims a terminal is not needed — it is', () => {
  // Mate, 2026-08-24: "B is incorrect they do need terminal lol". The claim was
  // live on all 23 videos when he said it. History in showBlurbPast is exempt:
  // that is the record of what WAS written, not something we would write now.
  const cfg = voice.config();
  const live = JSON.stringify({ ...cfg, youtubeDescription: { showBlurb: cfg.youtubeDescription.showBlurb } });
  assert.ok(!/terminal/i.test(live.replace(/"blocked":\[[^\]]*\]/, '')),
    'something we say out loud mentions a terminal again');
});

/*
 * The workflow page cannot claim the watcher reaches a platform it does not.
 *
 * This exact claim has now been wrong three times: post.js printed it keyed off
 * !linkInCaption, then off commentsApi, and flowFor() was still keyed off
 * commentsApi as of 2026-08-24 — so social.matewishkey.com/config listed X
 * under "the hourly watcher posts it" when the watcher has never touched X.
 * commentWatched() is the one definition; anything that answers this question
 * has to go through it.
 */
test('the workflow page names the watcher exactly where the watcher runs', () => {
  const platforms = require('../scripts/lib/platforms');
  const watcher = new Set();
  const covered = new Set();
  for (const name of Object.keys(platforms.PLATFORMS)) {
    const step = platforms.flowFor(name).steps.find((s) => s.step === 'first comment');
    if (step && step.by === 'watcher') watcher.add(name);
    if (platforms.commentWatched(name)) covered.add(name);
  }
  assert.ok(watcher.size > 0, 'nothing claims the watcher — this would pass vacuously');
  for (const name of watcher) {
    assert.ok(covered.has(name),
      `the workflow page says the watcher comments on ${name}, and commentWatched() says it does not`);
  }
  // X is the case that made this necessary: a comments API, and still not watched.
  assert.equal(platforms.get('twitter').commentsApi, true, 'X lost its comments API — recheck this test');
  assert.ok(!watcher.has('twitter'), 'the page claims the watcher comments on X again');
});

/*
 * Every publish request is caught for itself.
 *
 * run-queue.js catches per CUT; publish() then splits again by CAPTION, and one
 * cut is up to four requests. A throw escaping this inner loop marked every
 * account in the group failed — including the ones already live — and the queue
 * page then offers a Re-queue button over published content. TikTok has no
 * delete API and Instagram cannot delete or edit through any API, so that click
 * is not recoverable.
 */
test('a failed publish request cannot take the published ones down with it', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'post.js'), 'utf8');
  const loop = src.slice(src.indexOf('for (const body of bodies)'));
  const body = loop.slice(0, loop.indexOf('\n  return {'));
  assert.ok(/try\s*{/.test(body), 'the per-request loop does not catch');
  assert.ok(/catch\s*\(err\)/.test(body), 'the per-request loop does not catch');
  assert.match(body, /status:\s*'failed'/,
    'a failed request must name its own platforms failed, not throw the group away');
  // Since 2026-09-14 a timed-out request is UNKNOWN, not failed, and unknown
  // is not thrown: it may be out, so it is reported. A total failure that the
  // platform actually reported still throws.
  assert.match(body, /if \(!posts\.length && failures\.length && !platforms\.some\(\(p\) => p\.status === 'unknown'\)\) throw/,
    'a total failure must still throw — nothing is live, so there is nothing to protect — unless it is unknown');
  // The catch has to sit INSIDE the loop, or it is the same bug one line out.
  assert.ok(body.indexOf('try {') < body.indexOf("api('POST', '/posts'"),
    'the try opens after the request it is meant to guard');
});

/*
 * captionMax became load-bearing the day X's link moved into the tweet.
 *
 * It had sat on the platform table since the beginning enforced by nothing —
 * the seventh field here to be decorative — which was harmless while X's
 * caption was his words alone. 280 is not a lot once a tracked link and a tag
 * are in it, and X counts every url as 23 characters however long it is.
 *
 * The order things are given up in is the point: ours first, his never.
 */
const { captionForPlatform } = require('../scripts/post.js');

test('a long X caption gives up our parts, in order, and never his words', async () => {
  const opts = (text) => ({ text, topics: ['Invoicing'], postKey: 'test:len',
    campaign: 'clip', clipId: null, title: null });

  // Comfortable: his words, the link and a tag all fit.
  const small = await captionForPlatform('twitter', opts('Short thought.'));
  assert.ok(small.startsWith('Short thought.'), 'his words must lead');
  assert.ok(/#\w/.test(small), 'a tag should survive at this length');

  // 250 characters: his words plus a 23-char link fit, the tag line does not.
  const tight = await captionForPlatform('twitter', opts('w'.repeat(250)));
  assert.ok(tight.startsWith('w'.repeat(250)), 'his words were altered');
  assert.ok(!/#\w/.test(tight), 'the tags should have been given up first');

  // 275: not even the link fits. His words still go out whole.
  const tighter = await captionForPlatform('twitter', opts('w'.repeat(275)));
  assert.strictEqual(tighter, 'w'.repeat(275), 'his words must survive untouched');

  // Over the limit on his words alone: the platform is refused, never truncated.
  await assert.rejects(() => captionForPlatform('twitter', opts('w'.repeat(300))),
    /his words alone are 300 characters and twitter takes 280/);
});

test('a url counts as 23 on X, so a short code does not cost us a tag', async () => {
  // Measuring the raw string would make our own mwkshow.com code look longer
  // than X counts it and drop a tag line that actually fits.
  const caption = await captionForPlatform('twitter', { text: 'w'.repeat(230),
    topics: ['Invoicing'], postKey: 'test:url', campaign: 'clip', clipId: null, title: null });
  assert.ok(caption.startsWith('w'.repeat(230)));
  assert.ok(caption.length > 280 || /#\w/.test(caption),
    'either the raw string exceeds 280 (proving urls are discounted) or a tag survived');
});

/*
 * THE SHOW NOTES NARRATED HIS OWN SHOW IN THE THIRD PERSON, AND THE PROMPT IS
 * WHY (found 2026-08-25, by reading what was actually live rather than by a
 * test). Five of the fourteen long-form openings said "The host walks his
 * sister through…", "Host Mate helps his friend Peter…", "The host guides a
 * beginner…" — press-release voice on a show whose brand page says first
 * person. The cause was in the prompt's own rule list: "The host teaches rather
 * than doing it for the guest" put the phrase in front of the model, and the
 * model used it. Nothing asked for first person at all, so it came out
 * whichever way the transcript leaned.
 *
 * A sixth was worse than voice: "Istvan walks through his plans for finishing a
 * custom timer application for his Stream Deck" — those are HIS projects, and
 * Istvan is not in that video. The stream title was left over from another
 * session and the model trusted it over the transcript.
 */
test('the show-notes prompt asks for first person and never seeds "the host"', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'yt-description.js'), 'utf8');
  const prompt = src.slice(src.indexOf('Voice rules'), src.indexOf('TITLE:'));
  assert.ok(prompt, 'the voice rules block has to still be findable');

  assert.match(prompt, /FIRST PERSON/, 'the rule that was missing has to be stated');
  assert.match(prompt, /NEVER "the host"/,
    'banning the phrase is the fix — the old rule handed the model "the host" to copy');
  assert.match(prompt, /THE TRANSCRIPT WINS OVER THE TITLE/,
    'a left-over stream title is what put a guest in a video he is not in');
  assert.match(prompt, /This walkthrough covers/,
    'the throat-clearing list has to name the one that actually got through');

  /*
   * The positive control for the ban: the old seeding rule must be gone.
   * Restoring it ("The host teaches rather than doing it for the guest") fails
   * this line, which is the whole point — the rule read as guidance and worked
   * as an example.
   */
  assert.ok(!/- The host teaches/.test(prompt),
    'the third-person seed must not come back as a rule');
});

/*
 * --repropose exists because sync() cannot reach an opening it already wrote:
 * a recognisably-ours description takes the swap path, which is right for a
 * stale tail and useless for a wrong voice. It must never take the shortcut of
 * writing directly — these are words he approved once.
 */
test('--repropose files a proposal and never writes a description itself', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'yt-description.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function repropose'), src.indexOf('async function main'));
  assert.ok(fn, 'repropose() has to exist for a voice change to reach what is already written');
  assert.match(fn, /\/youtube\/propose/, 'it files for approval');
  assert.ok(!/setDescription|update-metadata/.test(fn),
    'it must not write to YouTube — replacing words he approved is his call, on the dashboard');
});

/*
 * THE ROTATION'S BELT-AND-BRACES WAS WIRED ON ONE PATH ONLY. `avoidIndex` was
 * passed by first-comment.js and by nothing else, so a queued post never
 * consulted it and two consecutive posts on one platform could land the same
 * variant. Deterministic rotation off the post key means they usually differ
 * anyway — which is exactly why nobody noticed.
 *
 * Both writers must use the same state file and the same key, or "what went out
 * last on this platform" means two different things depending on who published.
 */
test('the publish path consults and records the last variant, like the watcher does', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const post = read('scripts', 'post.js');
  const watcher = read('scripts', 'first-comment.js');

  assert.match(post, /require\('\.\/lib\/comment-state'\)/,
    'post.js must read the same state file the watcher writes');
  assert.match(post, /avoidIndex: state\.__lastVariant/,
    'it has to pass the last index, or the pool is chosen blind');
  assert.match(post, /__lastVariant = \{ \.\.\.\(state\.__lastVariant \|\| \{\}\), \[platform\]: composed\.index \}/,
    'and record what it chose, or the next post is blind again');
  assert.match(watcher, /__lastVariant/, 'the watcher is the other writer of that key');

  /*
   * A dry run prints a body and publishes nothing. Recording there would make
   * the next REAL post avoid a variant that never went out — a rotation skipping
   * over a comment nobody ever saw.
   */
  assert.match(post, /if \(!opts\.dryRun\)[\s\S]{0,160}__lastVariant/,
    'a dry run must not move the rotation on');
});

/*
 * An explicitly pinned variant is a decision, and the nudge must not overrule
 * it — otherwise `--comment-variant 2` could silently publish variant 3.
 */
test('a pinned variant ignores avoidIndex', () => {
  // Against the fixture: pinning index 1 needs a second variant to exist, and
  // the live config has one variant by decision.
  const file = richConfig(() => {});
  const pinned = inConfig(file,
    "(v) => v.firstComment('rotation:pin', { platform: 'facebook', variantIndex: 1, avoidIndex: 1 })");
  assert.strictEqual(pinned.index, 1, 'the pinned index must survive a colliding avoidIndex');
});

/*
 * THE GATE ON HIS WORDS (2026-09-14). Restream's auto-caption — a question hook
 * with emoji — went out under his name on five platforms through the queue,
 * because the CTA, the link slot and the aspect ratio were all checked and the
 * body was not. Two mechanical rules, both his, on both doors: the dashboard
 * form (web/src/lib/words.js) and queue-add.js (scripts/lib/words.js). Two
 * runtimes, one rule — so the fixtures run through both and any disagreement
 * fails here rather than in a caption.
 */
test('the gate on his words refuses emoji and a question-hook first line, on both doors', async () => {
  const box = require('../scripts/lib/words.js');
  const worker = await import(require('node:path').join(__dirname, '..', 'web', 'src', 'lib', 'words.js'));
  const cases = [
    ['Ever thought about how much a customer really costs? 🤔💰', 2],
    ['Ever thought about how much a customer really costs?', 1],
    ['Someone came in wanting a website built and left able to build it themselves.', 0],
    ['A website for her practice.\n\nWhat did it take? Two hours.', 0],   // a question later is fine
    ['Three thousand of the right people to call 📞', 1],
    ['', 0],
    ['\n\n  Is this a hook?  \n', 1],                                     // the first NON-BLANK line
  ];
  for (const [body, n] of cases) {
    const a = box.wordProblems(body);
    const b = worker.wordProblems(body);
    assert.deepStrictEqual(a, b, `the two copies disagree on ${JSON.stringify(body)}`);
    assert.equal(a.length, n, `${JSON.stringify(body)} → ${JSON.stringify(a)}`);
  }
  // Positive control on the fixtures: the case the gate exists for is refused
  // for both reasons, by name.
  const why = box.wordProblems(cases[0][0]);
  assert.match(why[0], /emoji/);
  assert.match(why[1], /hook/);
});

test('the dashboard form refuses held words before anything is uploaded, and says why', async () => {
  const { queueAction, queuePage } = await import(require('node:path').join(__dirname, '..', 'web', 'src', 'pages', 'queue.js'));
  let inserted = false, put = false;
  const env = { DB: { prepare() { return { bind() { inserted = true; return { run: async () => {} }; } }; } },
    MEDIA: { put: async () => { put = true; } } };
  const form = new FormData();
  form.set('do', 'add');
  form.set('body', 'Ever thought about how much a customer really costs? 🤔💰');
  form.set('media', new File(['x'], 'clip.mp4', { type: 'video/mp4' }));
  const res = await queueAction(new Request('https://social.example/queue', { method: 'POST', body: form }), env, 'm@x.com');
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /\/queue\?held=/);
  assert.match(decodeURIComponent(res.headers.get('location')), /emoji/);
  assert.equal(inserted, false, 'nothing is written');
  assert.equal(put, false, 'nothing is uploaded either — the gate is before the R2 put');

  const html = queuePage({ email: 'm@x.com', tz: 'Australia/Brisbane', waiting: [], done: [], total: 0,
    pace: { perDay: 6, today: 0, minGapMinutes: 90, tz: 'Australia/Brisbane', nextAt: null, why: null },
    held: 'emoji — nothing the show says out loud carries one' });
  assert.match(html, /Not queued:/);
  assert.match(html, /carries one/);
});

/*
 * THE ONE ALERT PATH (2026-09-14). Three dead-man checks pinged from jobs that
 * already run; an unset URL is a no-op so a job never fails because the
 * alerting did; a failure pings /fail with the reason. Tested with a curl shim
 * on PATH, so the ping is exercised and not merely declared.
 */
test('health.ping is a no-op unset, pings when set, and /fail on a failure', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const health = require('../scripts/lib/health.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwk-curl-'));
  const log = path.join(dir, 'calls');
  fs.writeFileSync(path.join(dir, 'curl'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n`, { mode: 0o755 });
  const savedPath = process.env.PATH;
  const savedUrl = process.env.MWK_HC_POSTED_URL;
  try {
    process.env.PATH = `${dir}:${savedPath}`;
    delete process.env.MWK_HC_POSTED_URL;
    assert.equal(health.ping('posted'), false, 'unset is a no-op');
    assert.ok(!fs.existsSync(log), 'and curl is never called');

    process.env.MWK_HC_POSTED_URL = 'https://hc.example/abc';
    assert.equal(health.ping('posted', { message: 'posted q1' }), true);
    assert.equal(health.ping('posted', { ok: false, message: 'nothing' }), true);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(calls.length, 2);
    assert.match(calls[0], /https:\/\/hc\.example\/abc$/, 'ok pings the bare url');
    assert.match(calls[0], /posted q1/, 'the message rides along');
    assert.match(calls[1], /https:\/\/hc\.example\/abc\/fail$/, 'a failure pings /fail');
    assert.match(calls[0], /-m 10/, 'ten seconds, never longer');
  } finally {
    process.env.PATH = savedPath;
    if (savedUrl === undefined) delete process.env.MWK_HC_POSTED_URL; else process.env.MWK_HC_POSTED_URL = savedUrl;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Each job that should ping does, by name — declared-and-never-read is the
// repo's favourite failure and a check nobody pings is an alert that never fires.
test('every check has exactly the job that pings it', () => {
  const read = (f) => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'scripts', f), 'utf8');
  assert.match(read('ship-events.js'), /health\.ping\('heartbeat'/);
  assert.match(read('run-queue.js'), /if \(anyLive\) health\.ping\('posted'/);
  assert.match(read('ship-stats.js'), /health\.ping\('accounts', \{ ok: !broken\.length/);
  assert.doesNotMatch(read('first-comment.js'), /process\.env\.MWK_COMMENT_HC_URL/, 'the private hook set nowhere is gone');
});

/* ------------------------------------------------ the comment has to fit */

/*
 * AN EPISODE VARIANT QUOTES A GUEST VERBATIM, SO ITS LENGTH IS WHATEVER THE
 * GUEST SAID — 580 characters against Threads' 500 on 2026-09-18. Zernio
 * answers an over-length reply with a 502, which reads like a platform having
 * a bad minute, so it was written off as theirs twice before anybody measured
 * the body. These drive the composition against a LOCAL feed (curl reads
 * file://) so the fixture is the wish, not whatever the show published today.
 */
const capFixture = (wish, extra = {}) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-cap-'));
  const feed = path.join(dir, 'feed.xml');
  fs.writeFileSync(feed, `<rss><channel><item>` +
    `<title>An episode</title><link>https://matewishkey.com/episodes/fixture/</link>` +
    `<description><![CDATA[${wish} — the rest of the blurb]]></description>` +
    `</item></channel></rss>`);
  const cfg = JSON.parse(JSON.stringify(voice.config()));
  cfg.feed = `file://${feed}`;
  // The fixture's variants, not the live ones: the live comment is a bare link
  // since 2026-09-22 and there is no quote left to give up.
  Object.assign(cfg.firstComment, JSON.parse(JSON.stringify(FIXTURE)));
  cfg.firstComment.episodeMixRatio = 1;          // force the quote path
  Object.assign(cfg.firstComment, extra);
  const file = path.join(dir, 'voice.json');
  fs.writeFileSync(file, JSON.stringify(cfg));
  return file;
};

// Composition runs in a child process because MWK_VOICE_CONFIG is read once,
// at require time — the same reason the bad-config test above spawns one.
const compose = (configPath, opts) => {
  const { execFileSync } = require('child_process');
  const out = execFileSync(process.execPath,
    ['-e', 'const v=require(process.env.V);' +
      'process.stdout.write(JSON.stringify(v.firstComment(process.env.KEY, JSON.parse(process.env.OPTS))))'],
    { env: { ...process.env, MWK_VOICE_CONFIG: configPath, V: require.resolve('../scripts/lib/voice'),
      KEY: 'threads:18026309231883654', OPTS: JSON.stringify(opts) }, stdio: 'pipe', encoding: 'utf8' });
  return JSON.parse(out);
};

test('an over-long quote gives up the quote, never the link', () => {
  const file = capFixture(`"${'She wanted her invoices filed by themselves. '.repeat(12).trim()}"`);
  // The positive control, in the same fixture: uncapped, this composition IS
  // over the cap. Without it a shortening test passes on a wish that fits.
  const uncapped = compose(file, { platform: 'threads' });
  assert.strictEqual(uncapped.variant, 'episode', 'the fixture stopped taking the quote path');
  assert.ok(uncapped.text.length > 500, `the fixture is only ${uncapped.text.length} characters — it proves nothing`);

  const capped = compose(file, { platform: 'threads', maxLength: 500 });
  assert.ok(capped.text.length <= 500, `composed ${capped.text.length} characters for a 500 cap`);
  assert.strictEqual(capped.variant, 'plain', 'it kept the quote and blew the cap');
  assert.ok(capped.fellBack, 'gave up the quote without saying so');
  assert.ok(capped.text.includes(voice.marker()), 'shortening cost the comment its CTA');
});

test('the tags are given up before the quote is', () => {
  const file = capFixture('"A short wish, quoted back."');
  const withTags = compose(file, { platform: 'threads', topicTags: ['Invoices', 'Paperwork'] });
  assert.strictEqual(withTags.variant, 'episode');
  assert.ok(/#/.test(withTags.text), 'the fixture never carried tags to give up');

  // A cap between the two lengths: the quote survives, the tag line does not.
  const noTagsLength = withTags.text.split('\n\n').slice(0, -1).join('\n\n').length;
  const capped = compose(file, { platform: 'threads', topicTags: ['Invoices', 'Paperwork'],
    maxLength: withTags.text.length - 1 });
  assert.strictEqual(capped.variant, 'episode', 'dropped the quote when dropping the tags was enough');
  assert.ok(capped.droppedTags, 'dropped the tags without saying so');
  assert.ok(!/#/.test(capped.text));
  assert.strictEqual(capped.text.length, noTagsLength);
});

test('a cap nothing fits is refused rather than truncated', () => {
  const file = capFixture('"A short wish, quoted back."');
  assert.throws(() => compose(file, { platform: 'threads', maxLength: 40 }),
    /refusing to truncate/, 'a truncated comment can carry half a url');
});

test('every platform we can comment on says how long a comment may be', () => {
  const platforms = require('../scripts/lib/platforms');
  assert.deepStrictEqual(platforms.commentProblems(), []);
  // Threads is the one that has actually bitten, and its cap is Zernio's own
  // number from validate:post-length (read 2026-09-18), not a blog's.
  assert.strictEqual(platforms.get('threads').commentMax, 500);
  for (const name of Object.keys(platforms.PLATFORMS).filter(platforms.commentWatched)) {
    assert.ok(platforms.get(name).commentMax > 0, `${name} is watched with no comment cap`);
  }
});

test('both paths that compose a comment hand it the cap', () => {
  const fs = require('fs');
  for (const file of ['../scripts/first-comment.js', '../scripts/post.js']) {
    const src = fs.readFileSync(require.resolve(file), 'utf8');
    const call = src.slice(src.indexOf('voice.firstComment('));
    const body = call.slice(0, call.indexOf('});') + 3);
    assert.ok(/maxLength:/.test(body), `${file} composes a comment without a length budget`);
  }
});
