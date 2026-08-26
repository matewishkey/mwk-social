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
const commentState = require('./lib/comment-state');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'node_modules', '.bin', 'zernio');

/*
 * Platforms whose platformSpecificData accepts firstComment (docs.zernio.com
 * platform guides). TikTok and Threads have no such field.
 *
 * DERIVED from the table, not typed out again. It was a hand-written literal
 * that happened to agree with `supportsFirstComment` — the same shape as the
 * watcher's own list, which is pinned to commentWatched() by a test precisely
 * because this kind of drift is expensive here. Flipping a platform's
 * supportsFirstComment would have changed flowFor(), the caption composition
 * and the "the watcher adds it" note, while publish() carried on sending
 * nothing: the wrong answer in three places and no error anywhere.
 */
const FIRST_COMMENT_PLATFORMS = new Set(Object.keys(platformTable.PLATFORMS)
  .filter((name) => platformTable.get(name).supportsFirstComment));

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

  /*
   * `avoidIndex` was wired on the watcher's path and nowhere else, so a queued
   * post never consulted it and two consecutive posts on one platform could
   * land the same variant. Rotation is deterministic off the post key, so they
   * usually differ anyway — this is the belt-and-braces that was missing, not a
   * bug being fixed.
   *
   * Same state file and same key the watcher uses, because "what went out last
   * on this platform" has to mean one thing whichever path published it.
   * An explicitly pinned --comment-variant is unaffected: voice.js applies the
   * nudge only when it is choosing for itself.
   */
  const state = commentState.load();
  const composed = voice.firstComment(postKey, {
    platform,
    topicTags: opts.topics,
    noTags: tagsInCaption(platform),
    variantIndex: opts.commentVariant,
    showUrl,
    linkLive: live,
    avoidIndex: state.__lastVariant?.[platform] ?? -1,
  });

  // Never on a dry run: it prints the body and publishes nothing, so recording
  // the variant would make the next real post avoid one that never went out.
  if (!opts.dryRun) {
    state.__lastVariant = { ...(state.__lastVariant || {}), [platform]: composed.index };
    commentState.save(state);
  }
  return composed.text;
}

async function waitForResults(postId) {
  let platforms = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const { post } = await api('GET', `/posts/${postId}`);
    platforms = post.platforms || [];
    /*
     * An EMPTY platforms[] is "not hydrated yet", never "everything settled".
     *
     * `[].every(...)` is true, so an empty array on the first poll returned
     * immediately with no outcomes at all — run-queue then records nothing for
     * the group and verdict() can mark a post that is on its way out as failed,
     * which is the state that offers a Re-queue button over live content.
     * Waiting costs at most a hundred seconds; being wrong costs a duplicate
     * post on platforms that cannot delete.
     */
    const settled = platforms.length
      && platforms.every((p) => p.status === 'published' || p.status === 'failed');
    if (settled) return platforms;
  }
  // Out of patience. Hand back whatever the last poll saw rather than [] — a
  // half-hydrated list is still the truth about the platforms it does name.
  return platforms;
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
 * Does the link go in a thread reply rather than the post itself?
 *
 * NOTHING today: X moved to linkPlacement 'caption' on 2026-08-24. Kept because
 * 'reply' is a legitimate value of a config field and reversing the decision is
 * one word in the platform table — not because this runs. Do not believe a
 * claim that it does.
 *
 * The original reason was never the 403s, which were `xCapabilities.inbox`, an
 * account toggle defaulting to off and on since 2026-08-22. It was that an
 * out-of-network reply never enters the For You candidate set, so the CTA only
 * ever reached existing followers. See platforms.js.
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
 *   - the link, when there is no comments API to put it in (TikTok), or when the
 *     platform carries its own (X, linkPlacement 'caption' since 2026-08-24 —
 *     it rode in a thread reply for three days before that). X's 280 is what
 *     makes the give-up order below load-bearing rather than theoretical
 *   - the hashtags, when the platform takes them in the body (FB, YT, LI and
 *     the two above). Instagram and Threads must NOT have them in the caption:
 *     we never spend Instagram's cap of 5 twice — defensive, not a rule Instagram
 *     states (retracted 2026-08-24, see CLAUDE.md) — so tags there
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

/*
 * How long is this caption where it is going?
 *
 * X counts every url as 23 characters however long it is — t.co wraps them all
 * — so measuring the raw string overstates our own short codes and would drop
 * a post that fits. Everywhere else a character is a character.
 */
function captionLength(platform, text) {
  if (platform !== 'twitter') return text.length;
  return text.replace(shortlink.URL_RE, 'x'.repeat(23)).length;
}

/*
 * Fit the caption to the platform, giving up OUR parts first and never his.
 *
 * This became load-bearing the day X's link moved into the tweet: `captionMax`
 * had sat on the platform table since the beginning enforced by nothing, which
 * was harmless while X's caption was his words alone and is not now. 280 is not
 * a lot once a link and a tag are in it.
 *
 * The order is the whole point. The tags are ours, so they go first. The link
 * is ours, so it goes second — a post nobody can act on still beats no post.
 * His words are never touched, never truncated, never re-wrapped: if they alone
 * do not fit, the platform was never going to take this post and it is dropped
 * with a reason rather than mangled into fitting.
 */
async function captionForPlatform(platform, opts) {
  const max = platformTable.get(platform).captionMax || Infinity;
  const join = (xs) => xs.filter(Boolean).join('\n\n');

  const link = linkInCaption(platform) ? await linkFor(platform, opts, 'caption')
    : (profileCtaInCaption(platform, opts) ? voice.profileCta(platform) : null);
  const tags = tagsInCaption(platform) ? voice.tagLine(platform, opts.topics || []) : null;

  for (const [caption, dropped] of [
    [join([opts.text, link, tags]), null],
    [join([opts.text, link]), 'the hashtags'],
    [join([opts.text]), 'the hashtags and the tracked link'],
  ]) {
    if (captionLength(platform, caption) <= max) {
      if (dropped) console.log(`note: ${platform} caption is over ${max} — dropped ${dropped}`);
      return caption;
    }
  }
  throw new Error(`his words alone are ${captionLength(platform, opts.text)} characters `
    + `and ${platform} takes ${max}`);
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
  /*
   * Composition is caught per account too. captionForPlatform throws when his
   * words alone will not fit — and a throw here is BEFORE the request loop, so
   * without this one over-long post would take every platform down with it,
   * which is the same mistake as the uncaught request loop below, one step
   * earlier. The platform that cannot carry the post is dropped; the rest go.
   */
  const composed = [];
  for (const a of accounts) {
    try {
      composed.push({ account: a, caption: await captionForPlatform(a.platform, opts) });
    } catch (err) {
      console.log(`skip  ${a.platform} — ${err.message}`);
    }
  }
  if (!composed.length) throw new Error('no platform can carry this post');

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
  // ships inside the post itself (its caption, since 2026-08-24).
  // platforms.commentWatched() is the single definition; this filter has now
  // been wrong twice, once keyed off !linkInCaption and once off commentsApi
  // alone, and the REASON printed here has been stale twice more.
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
  /*
   * EVERY REQUEST IS CAUGHT FOR ITSELF, and this is the same lesson run-queue.js
   * learned expensively on 2026-08-21 — one layer further in.
   *
   * run-queue catches per CUT. publish() then splits again, by CAPTION, and
   * today that is up to four requests for one cut. A throw here escaped both
   * loops, so run-queue's catch marked every account in the group `failed` —
   * including the ones already live. With a single cut that meant the whole
   * item recorded as failed, and the queue page then offered a **Re-queue**
   * button over content that was already published. One click would repost the
   * lot to platforms that cannot delete: TikTok has no delete API at all and
   * Instagram cannot delete or edit through any API.
   *
   * X is the request that actually does this: its media upload dies at 99%
   * after the bytes are paid for, and it is the last of the four.
   *
   * So a failed request now names its own platforms as failed and the others
   * keep their real outcome. Only a total failure throws, because then nothing
   * is live and there is nothing to protect.
   */
  const posts = [];
  const platforms = [];
  const failures = [];
  for (const body of bodies) {
    const targets = (body.platforms || []).map((t) => t.platform);
    try {
      const { post } = await api('POST', '/posts', { body, timeout: 240000 });
      posts.push(post);
      console.log(`post ${post._id} — ${post.status}`);
      if (!opts.wait || opts.draft || opts.schedule) continue;
      for (const p of await waitForResults(post._id)) {
        const where = p.platformPostUrl || p.errorMessage || '';
        console.log(`  ${p.platform.padEnd(10)} ${p.status.padEnd(10)} ${where}`);
        platforms.push(p);
      }
    } catch (err) {
      console.error(`  ${targets.join('+')} failed: ${err.message}`);
      failures.push(err);
      for (const platform of targets) {
        platforms.push({ platform, status: 'failed', platformPostId: null,
          platformPostUrl: null, errorMessage: err.message });
      }
    }
  }
  // Nothing got out at all — no partial success to protect, so say so loudly.
  if (!posts.length && failures.length) throw failures[0];
  return { post: posts[0], posts, platforms };
}

async function main() {
  await publish(parseArgs(process.argv.slice(2)));
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { publish, resolveAccounts, threadWithLink, captionForPlatform, FIRST_COMMENT_PLATFORMS };
