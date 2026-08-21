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
    const active = all.filter((a) => a.isActive !== false);
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
function commentFor(platform, text, opts) {
  if (opts.comment) {
    // The tag line is appended here rather than baked into the custom text, so
    // each platform still gets tags under its own cap. Without this a custom
    // comment went out with no hashtags at all.
    const tags = voice.tagLine(platform, opts.topics || []);
    return tags ? `${opts.comment}\n\n${tags}` : opts.comment;
  }
  return voice.firstComment(`new:${voice.hash(text)}`, {
    platform,
    topicTags: opts.topics,
    variantIndex: opts.commentVariant,
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
 * The caption for a platform that cannot carry a comment.
 *
 * TikTok and X have no comments API we can use, so a post there with a clean
 * caption is a dead end — nothing links back to the sign-up page and nothing
 * is measurable. His words stay first and untouched; the call to action and
 * the tags are appended, under that platform's own tag cap.
 */
async function captionFor(platform, opts) {
  // A custom comment cannot be posted here, so its links ride in the caption
  // instead — otherwise the one thing he wanted people to click is missing on
  // exactly the two platforms that cannot be commented on.
  const body = opts.comment
    ? await shortlink.trackLinks(opts.comment, { platform, postKey: opts.postKey || null })
    : await shortlink.mint({ platform, postKey: opts.postKey || null, label: opts.title || null })
      || voice.config().links.show;
  const tags = voice.tagLine(platform, opts.topics || []);
  return [opts.text, body, tags].filter(Boolean).join('\n\n');
}

async function publish(opts) {
  const accounts = resolveAccounts(opts);
  // Every url we are about to publish gets its own code, not just the CTA.
  if (opts.comment) {
    opts = { ...opts, comment: await shortlink.trackLinks(opts.comment,
      { postKey: opts.postKey || null }) };
  }
  const wantComment = opts.firstComment;
  const media = resolveMedia(opts.media);

  // Two shapes of post, and they cannot share a request: one caption is his
  // words alone with the link in a comment, the other has the link appended.
  // Sending one body would force the same caption on both.
  const commentGroup = accounts.filter((a) => !linkInCaption(a.platform));
  const captionGroup = accounts.filter((a) => linkInCaption(a.platform));

  const base = () => {
    const b = {};
    if (media.length) b.mediaItems = media;
    if (opts.title) b.title = opts.title;
    if (opts.draft) b.isDraft = true;
    else if (opts.schedule) b.scheduledFor = opts.schedule;
    else b.publishNow = true;
    return b;
  };

  const bodies = [];

  if (commentGroup.length) {
    const b = { ...base(), content: opts.text };
    b.platforms = commentGroup.map((a) => {
      const entry = { platform: a.platform, accountId: a.id };
      if (wantComment && FIRST_COMMENT_PLATFORMS.has(a.platform)) {
        entry.platformSpecificData = { firstComment: commentFor(a.platform, opts.text, opts) };
      }
      return entry;
    });
    bodies.push(b);
  }

  // One request per caption-link platform: they need different captions anyway,
  // since each gets its own tracked code and X's tag cap is 1 against TikTok's none.
  for (const a of captionGroup) {
    const b = { ...base(), content: await captionFor(a.platform, opts) };
    b.platforms = [{ platform: a.platform, accountId: a.id }];
    if (a.platform === 'tiktok') {
      b.tiktokSettings = tiktokSettings(a.id, opts.tiktokPrivacy, media.some((m) => m.type === 'video'));
    }
    bodies.push(b);
  }

  if (commentGroup.some((a) => a.platform === 'tiktok')) {
    const tt = commentGroup.find((a) => a.platform === 'tiktok');
    bodies[0].tiktokSettings = tiktokSettings(tt.id, opts.tiktokPrivacy, media.some((m) => m.type === 'video'));
  }

  // Only platforms that HAVE a comments API get picked up by the watcher. Saying
  // so for TikTok and X was wrong: nothing ever reaches them, which is exactly
  // why the link is in their caption instead.
  const later = commentGroup.filter((a) => wantComment && !FIRST_COMMENT_PLATFORMS.has(a.platform));
  if (later.length) {
    console.log(`note: ${later.map((a) => a.platform).join(', ')} take no native firstComment — the watcher adds it`);
  }
  if (captionGroup.length) {
    console.log(`note: ${captionGroup.map((a) => a.platform).join(', ')} cannot be commented on — the link goes in the caption`);
  }

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

module.exports = { publish, resolveAccounts, FIRST_COMMENT_PLATFORMS };
