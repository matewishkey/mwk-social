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

/* ------------------------------------------------ which clip earned the click */

/*
 * `clip_id` was declared on the link table from the beginning and never
 * written — 0 of 55 links carried one. The only way back from a click to a
 * video was a LIKE on the `post_key` prefix, which worked for 14 of them and
 * for none of the 25 minted outside the queue. Two of these tests exist because
 * of that; the third is the one that keeps it fixed.
 */
test('a mint carries the clip, the campaign and the placement', async () => {
  const shortlink = require('../scripts/lib/shortlink');
  const realFetch = global.fetch;
  const sent = [];
  process.env.MWK_LOG_URL = 'https://example.test/events';
  process.env.MWK_LOG_TOKEN = 'x';
  global.fetch = async (_u, o) => {
    sent.push(JSON.parse(o.body));
    return { ok: true, json: async () => ({ ok: true, url: 'https://mwkshow.com/aaaaa' }) };
  };
  try {
    await shortlink.mint({ platform: 'facebook', postKey: 'queue:01ABC', clipId: '01ABC',
      campaign: 'clip', medium: 'comment' });
    assert.equal(sent.length, 1);
    for (const k of ['platform', 'clipId', 'postKey', 'campaign', 'medium']) {
      assert.ok(sent[0][k], `${k} must reach the mint, or the click cannot be attributed`);
    }
    assert.equal(sent[0].clipId, '01ABC');
    assert.equal(sent[0].medium, 'comment');
  } finally { global.fetch = realFetch; }
});

test('every place post.js mints a link names where the link is going', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'post.js'), 'utf8');
  // linkFor's third argument IS the medium. A call without one stores null and
  // the link becomes unattributable to a placement, which is half the question.
  const calls = src.match(/linkFor\([^)]*\)/g) || [];
  const invocations = calls.filter((c) => !c.startsWith('linkFor(platform, opts, medium'));
  assert.ok(invocations.length >= 2, 'expected linkFor to be called at least twice');
  for (const c of invocations) {
    assert.match(c, /,\s*'(caption|comment|reply|profile)'\)$/, `${c} does not name a medium`);
  }
});

test('the queue passes its item id down as the clip', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'run-queue.js'), 'utf8');
  assert.match(src, /clipId:\s*item\.retryOf \|\| item\.id/,
    'run-queue must hand the item id down, or nothing can join a click to a video');
});

/*
 * YouTube is the one platform whose link is dead for SOME clips and live for
 * others: a vertical video under three minutes becomes a Short, and YouTube
 * deliberately makes urls in Shorts descriptions and Shorts comments plain
 * text. `shortsAreDead` sat on the platform table unread for a day — the same
 * declared-but-never-wired trap as linkPlacement, landscapeOk and
 * hashtagsInCaption before it.
 */
test('a vertical short kills the YouTube link, a landscape one does not', () => {
  const vertical = { aspect: 0.5625, durationSec: 22 };
  const landscape = { aspect: 1.777, durationSec: 22 };
  const longVertical = { aspect: 0.5625, durationSec: 600 };

  assert.equal(platforms.linkDeadFor('youtube', vertical), true);
  assert.equal(platforms.linkDeadFor('youtube', landscape), false, 'landscape is never a Short');
  assert.equal(platforms.linkDeadFor('youtube', longVertical), false, 'over 3 min is not a Short');
  assert.equal(platforms.linkDeadFor('youtube', null), false, 'no probe, no claim');
});

test('no other platform has a media-dependent link rule', () => {
  const vertical = { aspect: 0.5625, durationSec: 22 };
  for (const p of Object.keys(platforms.PLATFORMS)) {
    if (p === 'youtube') continue;
    assert.equal(platforms.linkDeadFor(p, vertical), false, `${p} must not claim a Shorts rule`);
  }
});

test('the queue works out which platforms have a dead link for the clip', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'run-queue.js'), 'utf8');
  assert.match(src, /linkDead:/, 'run-queue must pass linkDead, or the Shorts rule is unread again');
  assert.match(src, /platforms\.linkDeadFor\(/);
});

/* ------------------------------------------- the four mint sites, 2026-08-24 */

/*
 * Twelve of the twenty-four videos on the channel are Shorts, and every one of
 * them had a tracked code written into its description — where YouTube renders
 * a url as plain text, deliberately, to cut spam. `linkDeadFor` was the rule and
 * it governed the publish path only; yt-description.js minted regardless. Same
 * declared-but-not-read shape as the four platform fields before it, in the one
 * file the fix never reached.
 */
test('a Short is minted a typeable code, not five random characters', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'yt-description.js'), 'utf8');
  assert.match(src, /platforms\.linkDeadFor\('youtube'/,
    'the Shorts rule still has to be decided by linkDeadFor, not guessed from the id');
  assert.match(src, /youtubeProbe\(/, 'the Shorts rule needs the video shape, not the platform alone');

  /*
   * A Short no longer skips the mint — it asks for a SHORT code. Nobody can
   * click a url under a Short, so the only way anyone follows it is by typing
   * it, and `mwkshow.com/8x2kq` is not a thing a person types.
   */
  const tail = src.slice(src.indexOf('async function tailFor'), src.indexOf('async function build'));
  assert.ok(tail.includes('shortlink.mint'), 'tailFor no longer mints at all — has this moved?');
  assert.match(tail, /codePrefix:\s*isShort\(id\)/,
    'the Short check has to feed the code prefix, or a Short gets an untypeable code');
});

test("a Short's address is short enough to type off a screen", () => {
  const short = voice.showBlurb('https://mwkshow.com/s3');
  assert.ok(short.includes('mwkshow.com/s3'), 'the typeable code must survive into the tail');
  assert.ok(voice.carriesCta(short), 'the guard must still recognise it as ours');
  // The point of the sequence is length. Five characters of base32 was the
  // thing being replaced, so a code that long is a regression.
  const code = short.match(/mwkshow\.com\/(\S+)/)[1];
  assert.ok(code.length <= 4, `a Short's code must stay typeable, got ${code}`);
});

/*
 * Mate, 2026-08-25: "why we are promoting twitch on the youtube live at all,
 * they are already on youtube". The blurb ended with
 * "Live on https://youtube.com/@matewishkey and https://twitch.tv/matewishkey"
 * — half of it pointing at the platform the reader is already on, the other
 * half sending them to a competitor. Worse, on a Short it printed two urls
 * directly under a CTA that had been DENIED a url on the grounds that urls do
 * not work there.
 *
 * One address in a description, and it is the one we want them to use.
 */
test('a YouTube description carries one address, and never another platform', () => {
  for (const tail of [voice.showBlurb(), voice.showBlurb('https://mwkshow.com/abcde'),
    voice.showBlurb('https://mwkshow.com/s3')]) {
    assert.ok(!/twitch/i.test(tail), `the tail still sends YouTube viewers to Twitch: ${tail}`);
    assert.ok(!/youtube\.com/i.test(tail),
      'the tail points a YouTube viewer back at YouTube');
    const urls = tail.match(/https?:\/\/\S+|\bmwkshow\.com\/\S+/g) || [];
    assert.equal(urls.length, 1, `exactly one address, found ${urls.length}: ${urls.join(', ')}`);
  }
});

test("the channel phrasing is YouTube's, not Instagram's", () => {
  assert.notEqual(voice.profileCta('youtube'), voice.profileCta('instagram'),
    '"link in my bio" is nonsense under a YouTube Short — the channel is the clickable thing');
  assert.equal(voice.profileCta('facebook'), voice.config().firstComment.profileCta,
    'a platform with no override falls back to the default');
});

/*
 * The plain, tracked and Short tails must all differ on exactly one line, or
 * the "one-line change" the dashboard shows him is a lie.
 */
test('every shape of the tail differs from the others on exactly one line', () => {
  const shapes = [voice.showBlurb(), voice.showBlurb('https://mwkshow.com/abcde'),
    voice.showBlurb('https://mwkshow.com/s3')];
  for (const a of shapes) {
    for (const b of shapes) {
      if (a === b) continue;
      const la = a.split('\n');
      const lb = b.split('\n');
      assert.equal(la.length, lb.length, 'the tails must have the same number of lines');
      assert.equal(la.filter((l, i) => l !== lb[i]).length, 1);
    }
  }
});

/*
 * findBlurb is what stops a third shape reading as "not ours" and taking the
 * full rebuild path — which would hand him a model-rewritten summary to
 * re-approve for every one of the twelve Shorts.
 */
test('our tail is recognised whatever went into its link slot', () => {
  const doc = (tail) => `something happened in this video.\n\n${tail}\n\n#MWKShow #PIY`;
  for (const tail of [voice.showBlurb(), voice.showBlurb('https://mwkshow.com/abcde'),
    voice.showBlurb('https://mwkshow.com/zzzzz'), voice.showBlurb('https://mwkshow.com/s3')]) {
    assert.equal(voice.findBlurb(doc(tail)), tail);
  }
});

test('findBlurb says no to a description that is not ours', () => {
  assert.equal(voice.findBlurb('subscribe for more content!'), null);
  assert.equal(voice.findBlurb(''), null);
});

test('swapping a Short onto its typeable code touches nothing else', () => {
  const doc = `we looked at the invoice thing.\n\n${voice.showBlurb('https://mwkshow.com/abcde')}\n\n#MWKShow #PIY #Invoicing`;
  const swapped = doc.replace(voice.findBlurb(doc), voice.showBlurb('https://mwkshow.com/s3'));
  const changed = doc.split('\n').filter((l, i) => l !== swapped.split('\n')[i]);
  assert.equal(changed.length, 1, `a swap changed ${changed.length} lines: ${changed.join(' / ')}`);
  assert.ok(swapped.startsWith('we looked at the invoice thing.'));
  assert.ok(swapped.endsWith('#MWKShow #PIY #Invoicing'));
});

/*
 * The watcher is the fourth mint site and was the only one no test covered. It
 * minted with campaign, medium and clip all null, and — worse — it would write
 * a live mwkshow.com code into an Instagram comment, which is the exact mistake
 * post.js was fixed for on 2026-08-22.
 */
test('the watcher asks whether a url can be followed before minting', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'first-comment.js'), 'utf8');
  assert.match(src, /platformTable\.linkIsLive\(target\.platform\)/,
    'the watcher must not print a url where none is clickable');
  assert.match(src, /linkLive: live/, 'and it must tell voice.firstComment so the CTA names the bio');
  assert.match(src, /linkDeadFor\('youtube'/, 'a Short is dead for the comment too, not only the description');
});

test('every code the watcher mints names its campaign and its placement', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'first-comment.js'), 'utf8');
  const call = src.slice(src.indexOf('await shortlink.mint({'), src.indexOf('const composed'));
  for (const field of ['campaign:', 'medium:']) {
    assert.ok(call.includes(field), `${field} must reach the mint, or the click has no placement`);
  }
  assert.match(src, /noTags: platformTable\.get\(target\.platform\)\.hashtagsInCaption/,
    'a caption that already carries the tags must not get them again underneath');
});

/*
 * The company page has 2 followers; the two personal profiles hold 7,192
 * between them and until 2026-08-24 their reposts carried no CTA and no code at
 * all — the entire LinkedIn audience with nothing to follow and nothing to
 * measure.
 */
test('a LinkedIn repost carries its own tracked CTA', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'lib', 'reshare.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function reshareComment'), src.indexOf('/**\n * @param {string} postUrl'));
  assert.match(fn, /campaign: 'reshare'/);
  assert.match(fn, /medium: 'comment'/);
  assert.match(fn, /accountId/, 'the code has to be per ACCOUNT, or three audiences share one number');
  assert.match(src, /platformData\.firstComment = firstComment/,
    'the comment must reach platformSpecificData, same place a native post puts it');
});

test('the queue hands the reshare its clip, so a repost click joins to a video', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'run-queue.js'), 'utf8');
  const call = src.slice(src.indexOf('reshare.reshareAll('), src.indexOf('catch (err)', src.indexOf('reshare.reshareAll(')));
  assert.match(call, /clipId:/);
  assert.match(call, /firstComment:/);
});

/*
 * `--no-first-comment` used to hold for about an hour: post.js sent none, and
 * then the watcher found a published post with no CTA anywhere and filled the
 * "gap" in. Nothing told it the absence was a decision.
 */
test('a post queued with no first comment is recorded so the watcher leaves it', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'run-queue.js'), 'utf8');
  assert.match(src, /commentState\.suppress\(/,
    'the decision has to be written down, or the watcher reverses it an hour later');
  assert.match(src, /postId: p\.platformPostId/,
    'the suppression key is the PLATFORM post id — the Zernio one 404s on every inbox: command');
});

test('the watcher and the publisher read the same state file', () => {
  const readFileSync = require('node:fs').readFileSync;
  const join = require('node:path').join;
  for (const f of ['first-comment.js', 'run-queue.js']) {
    assert.match(readFileSync(join(__dirname, '..', 'scripts', f), 'utf8'), /lib\/comment-state/,
      `${f} must use the shared state module, or the two keep separate ideas of what is done`);
  }
});

test('suppressing a post makes the watcher skip it, and never rewrites a real comment', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwk-state-'));
  const before = process.env.MWK_COMMENT_STATE;
  process.env.MWK_COMMENT_STATE = path.join(dir, 'first-comments.json');
  try {
    delete require.cache[require.resolve('../scripts/lib/comment-state')];
    const state = require('../scripts/lib/comment-state');
    assert.equal(state.suppress([{ platform: 'facebook', postId: '123', url: 'u' }]), 1);
    assert.equal(state.load()['facebook:123'].commentedAt, null);
    // A post already commented on must survive a later suppression untouched.
    const s = state.load();
    s['facebook:456'] = { commentedAt: '2026-08-24T00:00:00Z', variant: 'plain/1' };
    state.save(s);
    assert.equal(state.suppress([{ platform: 'facebook', postId: '456' }]), 0);
    assert.equal(state.load()['facebook:456'].commentedAt, '2026-08-24T00:00:00Z');
  } finally {
    if (before === undefined) delete process.env.MWK_COMMENT_STATE;
    else process.env.MWK_COMMENT_STATE = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/*
 * A description that is genuinely out of date has to be able to come BACK for a
 * decision. The upsert guarded on state alone, which stopped the churn it was
 * written for and then silently stopped this too: 19 of 22 re-proposals were
 * dropped on 2026-08-24 while the response still said they were filed, twelve of
 * them Shorts carrying a link YouTube renders as plain text.
 */
test('an out-of-date description can be re-proposed; an unchanged one cannot', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'web', 'src', 'api.js'), 'utf8');
  const sql = src.slice(src.indexOf('INSERT INTO yt_proposal'), src.indexOf(').bind(i.videoId'));
  assert.match(sql, /yt_proposal\.proposed <> excluded\.proposed/,
    'comparing the text is what stops the churn — a state check alone drops real changes');
  assert.match(sql, /state IN \('approved', 'applied'\)/,
    'an approved-but-unwritten row carries the OLD words and must be reopened too');
  assert.ok(!/'rejected'/.test(sql), 'he said no — asking again is not what no means');
  assert.match(sql, /state = 'proposed', decided_at = NULL/,
    'a reopened row has to lose its old decision, or it looks approved');
});

test('the propose endpoint reports what landed, not what was sent', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'web', 'src', 'api.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function propose'), src.indexOf('const pending'));
  assert.match(fn, /meta\.changes/, '"filed: 22" when nineteen were dropped is a number somebody believes');
  assert.ok(!/filed: items\.length/.test(fn));
});

/*
 * A connected account on a platform this pipeline has never described must be
 * skipped, never fatal.
 *
 * 2026-08-24: a Reddit account was connected in Zernio on 2026-08-22 and
 * `accounts:list` started returning it. Nothing in the platform table describes
 * Reddit, so `get('reddit')` threw and took the whole queue run with it — every
 * five minutes, on the only item in the queue, until someone read the journal.
 * Same shape as the LinkedIn find-vs-filter bug: an account arrives, no error
 * anybody reads, and posting quietly stops everywhere.
 */
test('the table knows what it describes and admits what it does not', () => {
  // The positive control comes first: a predicate that answers false to
  // everything would pass the real assertion below without meaning anything.
  for (const name of Object.keys(platforms.PLATFORMS)) {
    assert.equal(platforms.known(name), true, `${name} is in the table and known() denies it`);
  }
  assert.equal(platforms.known('reddit'), false);
  assert.equal(platforms.known('mastodon'), false);
  assert.equal(platforms.known('__proto__'), false, 'known() must not inherit from Object.prototype');
});

test('every platform known() admits can actually be described', () => {
  // known() is the gate accountsFor uses before anything calls get(), so the two
  // must never disagree — a name that passes the gate and then throws would be
  // the same outage wearing a different hat.
  for (const name of Object.keys(platforms.PLATFORMS)) {
    assert.doesNotThrow(() => platforms.get(name), `get(${name}) throws behind a true known()`);
  }
});

/* ------------------------------------------------------- personal shares -- */

/*
 * mwkshow.com/<code>/<name> — one code, a name per person, nothing minted.
 *
 * The parsing matters more than it looks: the redirect took the WHOLE path as
 * the code, so `/abcde/natalie` matched nothing and quietly sent the visitor to
 * the fallback. It looked like it worked, which is the worst way for a link to
 * fail.
 */
test('a name on the end of a link normalises to something storable', async () => {
  const { normaliseTag } = await import('../web/src/links.js');
  assert.equal(normaliseTag('Natalie'), 'natalie');
  assert.equal(normaliseTag('Book Club!'), 'book-club');
  // Hungarian names are the reason accents are folded rather than stripped:
  // without it Ödön becomes "d-n" and József becomes "j-zsef".
  assert.equal(normaliseTag('Ödön'), 'odon');
  assert.equal(normaliseTag('József'), 'jozsef');
  // Anyone can append anything to a public url, so it is capped and bounded.
  assert.equal(normaliseTag('a'.repeat(60)).length, 24);
  assert.match(normaliseTag('a'.repeat(60)), /^[a-z0-9-]+$/);
  // Unreadable is not recorded, and must never break the link.
  assert.equal(normaliseTag('---'), null);
  assert.equal(normaliseTag(''), null);
  assert.equal(normaliseTag(null), null);
});

test('the redirect splits the code from the name instead of swallowing both', async () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'web', 'src', 'links.js'), 'utf8');
  const fn = src.slice(src.indexOf('export async function redirect'));
  assert.match(fn, /split\('\/'\)/, 'the path is still taken whole — /code/name would 404 to fallback');
  assert.match(fn, /normaliseTag\(decodeSafe\(second\)\)/,
    'the name is not percent-decoded — "Ödön" would store as c3-96d-c3-b6n');
  assert.match(fn, /INSERT INTO click \(code, at, referer_host, bot, tag\)/,
    'the name is parsed and then not stored');
});

/*
 * A code he chose, not five random characters.
 *
 * mwkshow.com/mmm/natalie is a link he can type into a message from memory;
 * mwkshow.com/6kc0k/natalie is one he has to copy from somewhere, and that
 * difference decides whether the habit survives contact with a phone.
 */
test('a chosen code is normalised, and nonsense is refused', async () => {
  const { normaliseCode } = await import('../web/src/api.js');
  assert.equal(normaliseCode('mmm'), 'mmm');
  assert.equal(normaliseCode('MMM'), 'mmm', 'typed with caps in a message');
  assert.equal(normaliseCode(' /mmm/ '), 'mmm', 'pasted with the slashes still on');
  assert.equal(normaliseCode('my-talk'), 'my-talk');

  assert.equal(normaliseCode('a'), null, 'one character is a typo, not a code');
  assert.equal(normaliseCode('favicon.ico'), null, 'the redirect special-cases this one');
  assert.equal(normaliseCode('123'), null, 'a bare number reads as a mistake in a message');
  assert.equal(normaliseCode('-x'), null);
  assert.equal(normaliseCode('x-'), null);
  assert.equal(normaliseCode('Ödön'), null, 'a url path is not the place for an accent');
  assert.equal(normaliseCode('a'.repeat(30)), null);
});

test('a chosen code skips the attribute dedupe, or he would not get the one he asked for', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'web', 'src', 'api.js'), 'utf8');
  const fn = src.slice(src.indexOf('export async function mint(env,'));
  const named = fn.indexOf('if (wanted)');
  const dedupe = fn.indexOf('SELECT code FROM link\n      WHERE target = ?');
  assert.ok(named > -1 && dedupe > -1, 'one of the two branches has moved — recheck this test');
  assert.ok(named < dedupe,
    'the attribute dedupe runs first, so asking for "mmm" would hand back an existing random code');
  assert.match(fn, /is already taken, and it points somewhere else/,
    'a taken code must say so rather than silently hand over somebody else\'s');
});
