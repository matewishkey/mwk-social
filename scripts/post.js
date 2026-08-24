#!/usr/bin/env node
/*
 * Publish through Zernio with the standard first comment attached natively.
 *
 * The CLI has no flag for it, so this talks to the REST API directly and sets
 * platformSpecificData.firstComment per platform entry — Zernio posts the
 * comment itself, seconds after the post goes live. Facebook, Instagram,
 * LinkedIn and YouTube support the field; TikTok doesn't, so it's left off
 * there (scripts/first-comment.js is what covers anything this path misses).
 *
 * Usage:
 *   scripts/post.js --text "..." --accounts <id1,id2> [--media <file|url>,...]
 *   scripts/post.js --text "..." --all --media clip.mp4 --title "Episode 3"
 *   scripts/post.js --text "..." --all --dry-run       # print the request body
 *
 *   --topics a,b,c       hashtags describing the clip, for the first comment
 *   --tiktok-privacy L   TikTok privacy level (default: PUBLIC_TO_EVERYONE)
 *   --comment-variant N  pin one plain variant instead of letting it rotate
 *   --no-first-comment   publish without the CTA comment
 *   --draft              save as a draft (Zernio skips firstComment on drafts)
 *   --schedule <ISO>     schedule instead of publishing now
 *   --no-wait            don't poll for per-platform results
 */
'use strict';

const { execFileSync } = require('child_process');
const { api } = require('./lib/api');
const voice = require('./lib/voice');
const platformTable = require('./lib/platforms');
const shortlink = require('./lib/shortlink');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'node_modules', '.bin', 'zernio');

// Platforms whose platformSpecificData accepts firstComment (docs.zernio.com
// platform guides). TikTok has no such field.
const FIRST_COMMENT_PLATFORMS = new Set(['facebook', 'instagram', 'linkedin', 'youtube']);

const VIDEO_RE = /\.(mp4|mov|avi|webm|m4v)$/i;

function parseArgs(argv) {
  const opts = { text: null, accounts: null, all: false, media: [], title: null,
    firstComment: true, draft: false, schedule: null, wait: true, dryRun: false,
    topics: [], commentVariant: null, comment: null, postKey: null,
    tiktokPrivacy: 'PUBLIC_TO_EVERYONE' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--text') opts.text = argv[++i];
    else if (a === '--accounts') opts.accounts = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--all') opts.all = true;
    else if (a === '--media') opts.media = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--title') opts.title = argv[++i];
    else if (a === '--topics') opts.topics = argv[++i].split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean);
    else if (a === '--comment-variant') opts.commentVariant = Number(argv[++i]);
    else if (a === '--comment') opts.comment = argv[++i];
    else if (a === '--tiktok-privacy') opts.tiktokPrivacy = argv[++i];
    else if (a === '--no-first-comment') opts.firstComment = false;
    else if (a === '--draft') opts.draft = true;
    else if (a === '--schedule') opts.schedule = argv[++i];
    else if (a === '--no-wait') opts.wait = false;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else { console.error(`unknown option: ${a}`); usage(); process.exit(2); }
  }
  if (!opts.text) { console.error('--text is required'); usage(); process.exit(2); }
  if (!opts.accounts && !opts.all) { console.error('pass --accounts <ids> or --all'); usage(); process.exit(2); }
  return opts;
}

function usage() {
  console.log('usage: post.js --text TEXT (--accounts id1,id2 | --all) [--media file|url,...]');
  console.log('               [--title TEXT] [--topics a,b,c] [--comment-variant N]');
  console.log('               [--no-first-comment] [--draft] [--schedule ISO]');
  console.log('               [--no-wait] [--dry-run]');
}

function zernio(args) {
  let out;
  try {
    // stderr is piped, not inherited: the CLI echoes its JSON error bodies there
    // and they would otherwise litter the journal alongside our own log lines.
    out = execFileSync(CLI, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    out = (err.stdout || '').toString();
    if (!out.trim()) throw new Error(`zernio ${args[0]} failed: ${err.message}`);
  }
  const json = JSON.parse(out);
  if (json && json.error) throw new Error(`zernio ${args[0]}: ${json.message || 'error'}`);
  return json;
}

function resolveAccounts(opts) {
  const all = zernio(['accounts:list']).accounts || [];
  if (opts.all) {
    // Same rule as run-queue's accountsFor: a connected account on a platform
    // the table does not describe is skipped, never fatal. "Everywhere" means
    // everywhere we know how to post, not everywhere Zernio happens to list.
    const active = all.filter((a) => a.isActive !== false && platformTable.known(a.platform));
    if (!active.length) throw new Error('accounts:list returned no active accounts');
    return active.map((a) => ({ id: a._id || a.id, platform: a.platform }));
  }
  return opts.accounts.map((id) => {
    const account = all.find((a) => (a._id || a.id) === id);
    if (!account) throw new Error(`account ${id} not found — run: zernio accounts:list`);
    return { id, platform: account.platform };
  });
}

/*
 * TikTok refuses a post that arrives without its six consent flags, and they do
 * NOT live in platformSpecificData — `tiktokSettings` sits at the top level of
 * the body, the one platform that works that way. The allowed privacy levels and
 * which interactions the creator permits are per-account and change, so they get
 * read from creator-info rather than assumed: an unsupported level fails the post.
 */
function tiktokSettings(accountId, privacy, hasVideo) {
  const info = zernio(['accounts:tiktok-creator-info', accountId, '--mediaType', hasVideo ? 'video' : 'photo']);
  if (info.creator && info.creator.canPostMore === false) {
    throw new Error('tiktok: the account has hit its posting limit — try again later');
  }
  const levels = (info.privacyLevels || []).map((l) => l.value);
  if (levels.length && !levels.includes(privacy)) {
    throw new Error(`tiktok: privacy ${privacy} not offered for this account (${levels.join(', ')})`);
  }
  // An interaction the creator has switched off cannot be turned back on here.
  const allowed = (info.postingLimits || {}).interactionSettings || {};
  const can = (name) => (allowed[name] ? allowed[name].enabled !== false : true);
  return {
    privacy_level: privacy,
    allow_comment: can('allow_comment'),
    allow_duet: hasVideo && can('allow_duet'),
    allow_stitch: hasVideo && can('allow_stitch'),
    content_preview_confirmed: true,
    express_consent_given: true,
  };
}

function resolveMedia(items) {
  return items.map((item) => {
    const url = /^https?:\/\//.test(item) ? item : zernio(['media:upload', item]).url;
    if (!url) throw new Error(`media:upload returned no url for ${item}`);
    return { type: VIDEO_RE.test(url.split('?')[0]) ? 'video' : 'image', url };
  });
}

// No post ID exists yet, so the rotation is keyed off the content itself:
// stable for a given post, different between posts. Topic tags cannot be derived
// here — the clip is a local file, not a published post with a media URL — so
// they come in on --topics, named by whoever watched the video.
/*
 * The first comment for ONE platform, with its own tracked links.
 *
 * Per platform, not per post: the codes are what say which channel a click came
 * from, and composing this once for the whole fan-out gave Facebook, Instagram,
 * LinkedIn, YouTube and Threads a single shared code — so a click told us which
 * link earned it but not which channel.
 */
async function commentFor(platform, text, opts) {
  const postKey = opts.postKey || `new:${voice.hash(text)}`;

  const live = !linkToProfile(platform, opts);

  const where = { platform, postKey, clipId: opts.clipId || null,
    campaign: opts.campaign || 'clip', medium: 'comment' };

  if (opts.comment) {
    // Every url in a custom comment gets its own code, on this platform — but
    // only where a url is clickable at all. On Instagram and TikTok a code
    // spent in a comment can never be followed, so his words go through as
    // written and the tracking happens on the bio link instead.
    const body = live ? await shortlink.trackLinks(opts.comment, where) : opts.comment;
    // Tags only if the caption is not already carrying them, or the post would
    // show the same list twice.
    const tags = tagsInCaption(platform) ? '' : voice.tagLine(platform, opts.topics || []);
    return tags ? `${body}\n\n${tags}` : body;
  }

  // The rotating comment used the plain sign-up url here — only the watcher
  // minted one — so a pipeline post's CTA was the one link we could not measure.
  // No mint at all where the url would be plain text: that is a code spent on a
  // click that cannot happen, and it reads in the numbers as indifference.
  const showUrl = live ? await shortlink.mint({ ...where, label: opts.title || null }) : null;
  return voice.firstComment(postKey, {
    platform,
    topicTags: opts.topics,
    noTags: tagsInCaption(platform),
    variantIndex: opts.commentVariant,
    showUrl,
    linkLive: live,
  }).text;
}

async function waitForResults(postId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const { post } = await api('GET', `/posts/${postId}`);
    const platforms = post.platforms || [];
    const settled = platforms.every((p) => p.status === 'published' || p.status === 'failed');
    if (settled || attempt === 19) return platforms;
  }
  return [];
}

/*
 * Build the request body and publish it. Exported so the queue runner shares
 * this exact path rather than growing a second one — the first comment, the
 * TikTok consent flags and the platform routing are all decided here, and a
 * copy of that logic would drift the first time one of them changed.
 */
/** Does this platform take the link in its caption, because it has nowhere else? */
const linkInCaption = (platform) => {
  try { return platformTable.get(platform).linkPlacement === 'caption'; } catch { return false; }
};

/*
 * Does the link go in a thread reply rather than the post itself? Only X, and
 * only because its comment endpoints 403: threadItems is the one way to get a
 * link out of the root tweet without a comments API. See platforms.js for why
 * that is worth 1.5c a post.
 */
const linkInReply = (platform) => {
  try { return platformTable.get(platform).linkPlacement === 'reply'; } catch { return false; }
};

/*
 * The root tweet and the reply that carries the link, as threadItems.
 *
 * Pure on purpose — the media and the link are resolved by the caller, so the
 * shape that goes on the wire is testable without a network. The media rides on
 * the ROOT: threadItems[0] is the tweet people see, and the reply is a link.
 */
function threadWithLink(caption, link, media) {
  const root = { content: caption };
  if (media && media.length) root.mediaItems = media;
  return [root, { content: link }];
}

/*
 * Is this a platform where no url in a POST is clickable, so the CTA has to
 * point at the bio instead? Instagram and TikTok, both verified: caption, Reel
 * and comment are all plain text there.
 */
const linkToProfile = (platform, opts = {}) => {
  // `linkDead` is passed in by the caller for a platform whose link is dead for
  // THIS clip rather than always — today that is YouTube given a vertical cut,
  // which YouTube turns into a Short, where a url in the comment is plain text.
  if ((opts.linkDead || []).includes(platform)) return true;
  try { return platformTable.get(platform).linkPlacement === 'profile'; } catch { return false; }
};

/*
 * ...and is there no comment path to say that in? Then it goes in the caption.
 * TikTok has no comments API at all, so a caption with nothing in it is a post
 * with no route to the sign-up page. Instagram gets it in its native first
 * comment instead, which keeps the caption clean for the 5-hashtag cap.
 */
const profileCtaInCaption = (platform, opts = {}) => {
  if (!linkToProfile(platform, opts)) return false;
  const p = platformTable.get(platform);
  return !p.supportsFirstComment && !platformTable.commentWatched(platform);
};

/** Does this platform take hashtags in the caption, or must they stay out of it? */
const tagsInCaption = (platform) => {
  try { return platformTable.get(platform).hashtagsInCaption !== 0; } catch { return false; }
};

/*
 * The caption for one platform. Three things vary, and every one of them is a
 * platform rule rather than a choice:
 *
 *   - the link, when there is no comments API to put it in (TikTok). X has
 *     none either, but takes its link in a thread reply instead — see
 *     linkInReply — so its caption stays as clean as anyone else's
 *   - the hashtags, when the platform takes them in the body (FB, YT, LI and
 *     the two above). Instagram and Threads must NOT have them in the caption:
 *     Instagram's cap of 5 counts caption and comments together, so tags there
 *     would spend the budget twice over
 *   - his words, which never vary
 */
/*
 * The tracked link this platform's post carries, wherever it ends up. A custom
 * comment goes through whole, with every url in it given its own code; the
 * default is the CTA short link. Never fatal — with no dashboard to mint
 * against, the plain sign-up url goes out instead.
 */
async function linkFor(platform, opts, medium) {
  const postKey = opts.postKey || `new:${voice.hash(opts.text)}`;
  const where = { platform, postKey, clipId: opts.clipId || null,
    campaign: opts.campaign || 'clip', medium };
  if (opts.comment) return shortlink.trackLinks(opts.comment, where);
  return (await shortlink.mint({ ...where, label: opts.title || null }))
    || voice.config().links.show;
}

async function captionForPlatform(platform, opts) {
  const parts = [opts.text];
  const postKey = opts.postKey || `new:${voice.hash(opts.text)}`;

  if (linkInCaption(platform)) parts.push(await linkFor(platform, opts, 'caption'));
  else if (profileCtaInCaption(platform, opts)) parts.push(voice.profileCta(platform));
  if (tagsInCaption(platform)) {
    const tags = voice.tagLine(platform, opts.topics || []);
    if (tags) parts.push(tags);
  }
  return parts.filter(Boolean).join('\n\n');
}

async function publish(opts) {
  const accounts = resolveAccounts(opts);
  const wantComment = opts.firstComment;
  const media = resolveMedia(opts.media);

  /*
   * One request carries one caption, so platforms are grouped BY THE CAPTION
   * THEY GET rather than by any fixed split. That falls out of the rules above:
   * Instagram and Threads share a clean caption, Facebook/YouTube/LinkedIn
   * share a tagged one, and TikTok and X each get their own because each
   * carries its own tracked link.
   */
  const composed = [];
  for (const a of accounts) {
    composed.push({ account: a, caption: await captionForPlatform(a.platform, opts) });
  }

  const groups = new Map();
  for (const c of composed) {
    if (!groups.has(c.caption)) groups.set(c.caption, []);
    groups.get(c.caption).push(c.account);
  }

  const bodies = [];
  for (const [caption, accts] of groups) {
    const b = { content: caption };
    if (media.length) b.mediaItems = media;
    if (opts.title) b.title = opts.title;
    if (opts.draft) b.isDraft = true;
    else if (opts.schedule) b.scheduledFor = opts.schedule;
    else b.publishNow = true;

    b.platforms = [];
    for (const a of accts) {
      const entry = { platform: a.platform, accountId: a.id };
      if (wantComment && FIRST_COMMENT_PLATFORMS.has(a.platform)) {
        entry.platformSpecificData = { firstComment: await commentFor(a.platform, opts.text, opts) };
      }
      if (linkInReply(a.platform) && !linkToProfile(a.platform, opts)) {
        // threadItems REPLACES the top-level content for this platform — the
        // caption is published as threadItems[0], not as the post body.
        entry.platformSpecificData = Object.assign(entry.platformSpecificData || {},
          { threadItems: threadWithLink(caption, await linkFor(a.platform, opts, 'reply'), media) });
      }
      b.platforms.push(entry);
    }
    const tt = accts.find((a) => a.platform === 'tiktok');
    if (tt) b.tiktokSettings = tiktokSettings(tt.id, opts.tiktokPrivacy, media.some((m) => m.type === 'video'));
    bodies.push(b);
  }

  // Only platforms the watcher actually covers. That is not "has a comments
  // API" — X has one since 2026-08-22 and is still not covered, because its CTA
  // goes out as a thread reply at publish time. platforms.commentWatched() is
  // the single definition; this filter has now been wrong twice, once keyed off
  // !linkInCaption and once off commentsApi alone.
  const later = accounts.filter((a) => wantComment
    && !FIRST_COMMENT_PLATFORMS.has(a.platform) && platformTable.commentWatched(a.platform));
  if (later.length) {
    console.log(`note: ${later.map((a) => a.platform).join(', ')} take no native firstComment — the watcher adds it`);
  }
  const inCaption = accounts.filter((a) => linkInCaption(a.platform));
  if (inCaption.length) {
    console.log(`note: ${inCaption.map((a) => a.platform).join(', ')} cannot be commented on — the link goes in the caption`);
  }
  const toProfile = accounts.filter((a) => linkToProfile(a.platform, opts));
  if (toProfile.length) {
    console.log(`note: ${toProfile.map((a) => a.platform).join(', ')} make no url clickable — the CTA points at the bio, and no code is minted`);
  }
  const inReply = accounts.filter((a) => linkInReply(a.platform));
  if (inReply.length) {
    console.log(`note: ${inReply.map((a) => a.platform).join(', ')} publish as a thread — clean root tweet, link in the reply`);
  }
  console.log(`${bodies.length} request(s): ${bodies.map((b) => b.platforms.map((p) => p.platform).join('+')).join(' | ')}`);

  if (opts.dryRun) {
    for (const b of bodies) console.log(JSON.stringify(b, null, 2));
    return { bodies, dryRun: true };
  }

  // A publish carrying video regularly outlives the request. Zernio keeps
  // going after the caller gives up, so a timeout here is *unknown*, never
  // failure — the caller reconciles by searching for the caption it composed.
  const posts = [];
  const platforms = [];
  for (const body of bodies) {
    const { post } = await api('POST', '/posts', { body, timeout: 240000 });
    posts.push(post);
    console.log(`post ${post._id} — ${post.status}`);
    if (!opts.wait || opts.draft || opts.schedule) continue;
    for (const p of await waitForResults(post._id)) {
      const where = p.platformPostUrl || p.errorMessage || '';
      console.log(`  ${p.platform.padEnd(10)} ${p.status.padEnd(10)} ${where}`);
      platforms.push(p);
    }
  }
  return { post: posts[0], posts, platforms };
}

async function main() {
  await publish(parseArgs(process.argv.slice(2)));
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { publish, resolveAccounts, threadWithLink, FIRST_COMMENT_PLATFORMS };
