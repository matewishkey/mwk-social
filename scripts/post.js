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

// `cli` under its old local name: the CLI wrapper lived here as a second copy
// of lib/api's, minus the non-JSON guard and minus MWK_ZERNIO_CLI, so a shim
// that drove every other job could not drive this one.
const { api, cli: zernio } = require('./lib/api');
const voice = require('./lib/voice');
const platformTable = require('./lib/platforms');
// One implementation, shared with queue-add.js: the thing that QUEUES a post
// has to know what the publisher knows, or a platform gets dropped hours later
// with nobody watching (2026-09-21).
const { captionLength, titleLine, splitCredits } = require('./lib/captions');
const mediaLib = require('./lib/media');
const shortlink = require('./lib/shortlink');
const commentState = require('./lib/comment-state');
const fs = require('fs');
const path = require('path');


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
    topics: [], commentVariant: null, comment: null, postKey: null, link: null,
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
    // Where this post points, in full. Default: the show. See linkFor, below.
    else if (a === '--link') opts.link = argv[++i];
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
/*
 * A DESTINATION THAT IS NOT OURS STILL GETS THE SHOW IN THE COMMENT, AND THIS
 * IS WHY THE WHOLE POST DOES NOT DIE (found in review 2026-09-22).
 *
 * `voice.firstComment()` refuses to compose a comment carrying none of
 * `markers[]` — the duplicate guard could never recognise it again. So a
 * `--link` at a vendor's page (Elgato's marketplace, say) threw here, and
 * `commentFor` is called OUTSIDE the per-account catch: the throw took the
 * whole publish group with it, so nothing went out at all.
 *
 * `carriesCta()` is the right test and it is already the one definition of
 * "a link to him". The pin and the caption still point wherever he said; the
 * comment keeps the show, which is its job — a route back to HIM, not to
 * whoever is hosting the thing.
 */
const commentLink = (link) => (link && voice.carriesCta(link) ? link : null);

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
  // The post's own destination wins, whole (2026-09-22). On Instagram and
  // TikTok `live` is false and neither url can be followed, so the profile
  // phrase still stands in — an unclickable project page is no better than an
  // unclickable show page.
  const linkUrl = live
    ? (commentLink(opts.link) || await shortlink.mint({ ...where, label: opts.title || null }))
    : null;

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
    linkUrl,
    linkLive: live,
    // The platform's cap on a COMMENT, not on a caption — the native path
    // hands this to Zernio to post, so it overflows exactly the same way the
    // watcher's did (2026-09-18, Threads 502 on 580 characters).
    maxLength: platformTable.get(platform).commentMax || null,
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
/*
 * A LINK SLOT WANTS A URL, AND A CUSTOM COMMENT IS PROSE — THIS RETURNED THE
 * PROSE AND KILLED A PIN (2026-09-22).
 *
 * `if (opts.comment) return trackLinks(opts.comment)` ignored `medium`
 * entirely, so with --comment set every caller got the whole comment body
 * back. Both callers are link SLOTS: Pinterest's `link`, the destination a tap
 * opens, and X's caption link. Pinterest was handed "Everything it does:
 * https://mwkshow.com/dial\nInstall it: ...\n\nPrompt it yourself!" as its
 * destination url and answered `Invalid URL or request data` — its docs say
 * exactly that when the url is not one. The pin never went live.
 *
 * It had been unreachable until today because no post had ever combined a
 * custom comment with Pinterest or X. The comment path never came through
 * here at all: commentFor() composes its own, with trackLinks, and always did.
 * So the branch could only ever corrupt a slot, never serve one — it is gone
 * rather than narrowed.
 */
/*
 * AND THE SLOT POINTS AT WHAT THE POST IS ABOUT, NOT ALWAYS AT THE SHOW
 * (mate, 2026-09-22, on the pin that had just gone live pointing at /show:
 * "for these we can use always the original page with a link instead of the
 * show... this rule has to be generic").
 *
 * `opts.link` is the queue item's own destination. It goes out as its full
 * url and is deliberately not minted — mwk.show is the show's address and
 * shortlink.isShowLink() is where that rule lives.
 */
async function linkFor(platform, opts, medium) {
  if (opts.link) return opts.link;
  const postKey = opts.postKey || `new:${voice.hash(opts.text)}`;
  const where = { platform, postKey, clipId: opts.clipId || null,
    campaign: opts.campaign || 'clip', medium };
  return (await shortlink.mint({ ...where, label: opts.title || null }))
    || voice.config().links.show;
}

/*
 * The fields a PIN carries beside its description (Pinterest, since
 * 2026-09-20): `link`, the destination a tap opens — the only link slot on
 * the platform, minted with its own medium so a click says "the pin" —
 * `title`, the first line of his words under the platform's cap, and
 * `boardId`, without which Zernio pins to whichever board Pinterest lists
 * first. Boards are read off the account at publish time; MWK_PINTEREST_BOARD
 * names one by title, otherwise the first is taken. Null for every other
 * platform, so the caller can spread it without checking.
 */
const boardsSeen = new Map();
async function boardFor(accountId) {
  if (!boardsSeen.has(accountId)) {
    // REST, not the CLI: `zernio connect:get-pinterest-boards <id>` answered
    // 405 Method Not Allowed on 2026-09-20 while this GET returned the list.
    const res = await api('GET', `/accounts/${accountId}/pinterest-boards`);
    boardsSeen.set(accountId, res.boards || res.data || []);
  }
  const boards = boardsSeen.get(accountId);
  if (!boards.length) throw new Error('Pinterest requires a board and the account has none — create one in Pinterest first');
  const want = (process.env.MWK_PINTEREST_BOARD || '').trim().toLowerCase();
  const chosen = want ? boards.find((b) => String(b.name || '').toLowerCase() === want) : null;
  if (want && !chosen) throw new Error(`no Pinterest board named "${process.env.MWK_PINTEREST_BOARD}" — have ${boards.map((b) => b.name).join(', ')}`);
  return (chosen || boards[0]).id;
}

async function pinFields(account, opts) {
  let p;
  try { p = platformTable.get(account.platform); } catch { return null; }
  if (p.linkPlacement !== 'link') return null;
  return {
    link: await linkFor(account.platform, opts, 'link'),
    // The same title line YouTube takes and the short caption is made of —
    // captions.titleLine() is the one definition of it.
    title: titleLine(opts.text).slice(0, p.titleMax || 100),
    boardId: await boardFor(account.id),
  };
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
 *
 * ON A SHORT, HIS WORDS ARE THE TITLE LINE — and that is not this rule
 * bending. Nothing is truncated: the rest of his words are not squeezed to
 * fit a cap, they are deliberately not sent, because the player would print
 * them over the subtitles burned into his own clip (mate, 2026-09-22). The
 * first comment is untouched and still carries the lot; he excluded it in the
 * same sentence. A line of pure @mentions and #tags rides along with the
 * title — "tag Chris" was the same instruction as "keep the hashtags", and
 * dropping the credit is exactly what the title-only rule would have done.
 *
 * THE CREDIT IS COMPOSED LAST, AFTER OUR TAGS, on every platform (mate,
 * 2026-09-22: "put my tags first not chris one"). Our tag line is appended
 * after everything of his, so that is the only order in which his brand tags
 * precede somebody else's handle. It is never given up to make a caption
 * fit: he asked for the tag, so it ranks with his words, and the hashtags
 * and then the link go first exactly as before. `platforms.captionOverlaysShortFor` is the one decision, and
 * it needs `opts.probe` — with no probe nothing changes, which is the safe
 * direction: a full caption on a Short is what we were already doing.
 */
async function captionForPlatform(platform, opts) {
  const max = platformTable.get(platform).captionMax || Infinity;
  const join = (xs) => xs.filter(Boolean).join('\n\n');

  const overlaid = platformTable.captionOverlaysShortFor(platform, opts.probe);
  const { prose, credits } = splitCredits(opts.text);
  const words = overlaid ? titleLine(prose) : prose;

  const link = linkInCaption(platform) ? await linkFor(platform, opts, 'caption')
    : (profileCtaInCaption(platform, opts) ? voice.profileCta(platform) : null);
  const tags = tagsInCaption(platform) ? voice.tagLine(platform, opts.topics || []) : null;

  for (const [caption, dropped] of [
    [join([words, link, tags, credits]), null],
    [join([words, link, credits]), 'the hashtags'],
    [join([words, credits]), 'the hashtags and the tracked link'],
  ]) {
    if (captionLength(platform, caption) <= max) {
      if (dropped) console.log(`note: ${platform} caption is over ${max} — dropped ${dropped}`);
      return caption;
    }
  }
  throw new Error(`his words alone are ${captionLength(platform, join([words, credits]))} characters `
    + `and ${platform} takes ${max}`);
}

/*
 * The probe of this post's video, for the caption rules that depend on the
 * CLIP and not only on the platform.
 *
 * run-queue has already probed every cut and passes its own in, so the
 * pipeline never probes twice. A hand-run publish probes the local file
 * itself rather than going without: a rule that applies through the queue and
 * silently not by hand is the worse half of every bug in this repo. A URL
 * cannot be probed here and gives null, which means "compose as before".
 */
function probeFor(opts) {
  if (opts.probe !== undefined) return opts.probe;
  for (const item of opts.media || []) {
    if (/^https?:\/\//.test(item)) continue;
    try { return mediaLib.probe(item); } catch { /* not a file we can read */ }
  }
  return null;
}

async function publish(opts) {
  const accounts = resolveAccounts(opts);
  const wantComment = opts.firstComment;
  // Before resolveMedia, which uploads and hands back urls: the probe wants
  // the local file.
  const compose = { ...opts, probe: probeFor(opts) };
  // The caller's number wins; a hand-run publish works it out from the clip,
  // so the cover is not something only the queue remembers to set.
  if (!Number.isFinite(opts.coverMs)) opts.coverMs = platformTable.coverMsFor(compose.probe);
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
      composed.push({ account: a, caption: await captionForPlatform(a.platform, compose) });
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

  const video = media.some((m) => m.type === 'video');

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
      const pin = await pinFields(a, opts);
      if (pin) entry.platformSpecificData = { ...(entry.platformSpecificData || {}), ...pin };
      /*
       * THE COVER FRAME. Only where the platform documents one, and never on
       * a still — a picture has no frame to pick, and thumbOffset on an image
       * post is a field the platform has no use for.
       */
      const cover = video ? platformTable.coverFor(a.platform, opts.coverMs) : null;
      if (cover && cover.where === 'platformSpecificData') {
        entry.platformSpecificData = { ...(entry.platformSpecificData || {}), ...cover.fields };
      }
      b.platforms.push(entry);
    }
    const tt = accts.find((a) => a.platform === 'tiktok');
    if (tt) {
      b.tiktokSettings = tiktokSettings(tt.id, opts.tiktokPrivacy, video);
      // TikTok's cover is the one that does NOT live on the entry: its
      // settings object sits at the top level of the request, the same trap
      // the six consent flags carry.
      const ttCover = video ? platformTable.coverFor('tiktok', opts.coverMs) : null;
      if (ttCover) b.tiktokSettings = { ...b.tiktokSettings, ...ttCover.fields };
    }
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
  const covered = video
    ? accounts.filter((a) => platformTable.coverFor(a.platform, opts.coverMs)) : [];
  if (covered.length) {
    console.log(`note: cover frame at ${opts.coverMs} ms on `
      + `${covered.map((a) => a.platform).join(', ')} — nowhere else documents one`);
  }
  const overlaid = accounts.filter((a) => platformTable.captionOverlaysShortFor(a.platform, compose.probe));
  if (overlaid.length) {
    console.log(`note: ${overlaid.map((a) => a.platform).join(', ')} play this as a short — `
      + 'the caption is his title line and the tags, and nothing else would be read anyway '
      + 'under the words already on the picture. The first comment is unchanged');
  }
  const toProfile = accounts.filter((a) => linkToProfile(a.platform, opts));
  if (toProfile.length) {
    console.log(`note: ${toProfile.map((a) => a.platform).join(', ')} make no url clickable — the CTA points at the bio, and no code is minted`);
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
      /*
       * A TIMEOUT IS NOT A FAILURE. The request aborted at our end; Zernio
       * keeps processing, and the notes said "reconcile by searching
       * posts:list for the caption just composed" for three weeks without
       * any code doing it. So: look. If the post is there, wait on it like any
       * other. If it is not, the platforms are UNKNOWN — recorded as such,
       * never as failed, because failed is what gets re-queued and a second
       * copy on Instagram or TikTok cannot be deleted.
       */
      if (timedOut(err)) {
        console.error(`  ${targets.join('+')} timed out at our end — checking whether Zernio has it`);
        const found = reconcile(body);
        if (found) {
          posts.push(found);
          console.log(`post ${found._id} — found by its caption after the timeout`);
          for (const p of await waitForResults(found._id)) {
            console.log(`  ${p.platform.padEnd(10)} ${p.status.padEnd(10)} ${p.platformPostUrl || p.errorMessage || ''}`);
            platforms.push(p);
          }
        } else {
          for (const platform of targets) {
            platforms.push({ platform, status: 'unknown', platformPostId: null,
              platformPostUrl: null, errorMessage: 'timed out; Zernio may still publish it' });
          }
        }
        continue;
      }
      console.error(`  ${targets.join('+')} failed: ${err.message}`);
      failures.push(err);
      for (const platform of targets) {
        platforms.push({ platform, status: 'failed', platformPostId: null,
          platformPostUrl: null, errorMessage: err.message });
      }
    }
  }
  // Nothing got out at all — no partial success to protect, so say so loudly.
  // An unknown is not nothing: it may be out, so it is reported, not thrown.
  if (!posts.length && failures.length && !platforms.some((p) => p.status === 'unknown')) throw failures[0];
  return { post: posts[0], posts, platforms };
}

const timedOut = (err) => /timeout|timed out|aborted/i.test(`${err && err.name} ${err && err.message}`);

/**
 * The post we just tried to create, if Zernio made it despite our timeout —
 * matched on the exact caption, and only if it is minutes old, so an older
 * post with the same words (a retry, a re-queue) is never mistaken for it.
 */
function reconcile(body, { withinMinutes = 15 } = {}) {
  let res;
  try { res = zernio(['posts:list', '--limit', '10']); } catch { return null; }
  const since = Date.now() - withinMinutes * 60_000;
  return (res.posts || []).find((p) => (p.content || '') === (body.content || '')
    && Date.parse(p.createdAt || 0) >= since) || null;
}

async function main() {
  await publish(parseArgs(process.argv.slice(2)));
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { publish, resolveAccounts, captionForPlatform, FIRST_COMMENT_PLATFORMS };
