/*
 * What each platform will and won't allow. One table, so a rule is stated once.
 *
 * Everything publishes through this pipeline now, so the fields that existed to
 * work out whether a copy of a clip was ALREADY somewhere are gone with the
 * mirror that needed them. What is left describes what a platform will accept
 * and what it reports back.
 */
'use strict';

/*
 * THE COMMENT CAP IS NOT THE CAPTION CAP, and where it is, it is a coincidence.
 * Threads caps a reply at the same 500 as a post; LinkedIn caps a comment at
 * 1,250 against a post's 3,000; YouTube's comment runs to 10,000 where its
 * description stops at 5,000. voice.firstComment() composes within this number,
 * so an episode variant quoting a long guest wish gives up its tags and then
 * the quote rather than being refused by the platform. Sources: the caption
 * numbers and Threads' 500 are Zernio's own `validate:post-length` (read
 * 2026-09-18); the LinkedIn and YouTube comment numbers are the platforms'
 * published limits and have NOT been exercised from here — they are both lower
 * than anything we compose, so they cost nothing if they are a little wrong.
 */

/*
 * `coverFrame` — WHICH FRAME THE PLATFORM SHOWS BEFORE ANYBODY PRESSES PLAY.
 *
 * Mate, 2026-09-22: "the key frames are incorrect". They were, and not
 * because anything failed: we never sent a cover, so every platform used its
 * own default, and the defaults are documented and different.
 *   Instagram  thumbOffset defaults to 0 — the very first frame.
 *   TikTok     video_cover_timestamp_ms defaults to 1000.
 *   Pinterest  coverImageKeyFrameTime defaults to 0.
 * On a clip that opens on an empty shot, frame 0 is a picture of nothing.
 *
 * Each entry says where the field goes and what unit it is in, because the
 * three disagree on both: TikTok's lives in the top-level `tiktokSettings`
 * and counts milliseconds, Instagram's is `platformSpecificData.thumbOffset`
 * in milliseconds, Pinterest's is `platformSpecificData.coverImageKeyFrameTime`
 * in SECONDS. Sending seconds where milliseconds are expected is a cover
 * 1,000x further into the clip than intended, which on a 38-second video is
 * silently the last frame.
 *
 * Read off docs.zernio.com/platforms/{tiktok,instagram,pinterest} on
 * 2026-09-22. Every other platform's page was read the same day and NONE of
 * them documents a cover of any kind: facebook, linkedin, threads, and
 * twitter — whose page is /platforms/twitter, not /platforms/x, which 404s
 * and briefly had this note claiming X has no page at all.
 *
 * YouTube is the exception that is not a timestamp: it takes an IMAGE, and it
 * has its own field below (`coverImage`). Everything about which of its
 * surfaces that actually changes is there.
 *
 * `imageUrl` names the field that OVERRIDES the timestamp with a picture on
 * the three below. Nothing here sends one, and on TikTok that is deliberate:
 * ⚠ for an account not connected through the TikTok for Business app, Zernio
 * "downloads the image, rehosts it, STITCHES IT IN AS A SINGLE FRAME AT THE
 * START OF THE VIDEO" — a cover image there edits the video itself. A
 * timestamp does not. Read the platform page before reaching for one.
 */

/*
 * `captionOverlaysShort` — THE CAPTION IS DRAWN OVER HIS OWN SUBTITLES.
 *
 * Mate, 2026-09-22: "the text what you are sending is overlaying my captions,
 * so it can take too much space... keep the title and the hashtags, keep it
 * super short, to drive them into the video. It is only rules for the shorts,
 * and not for the comments."
 *
 * A short-form player puts the caption ON the video, bottom-left, over the
 * burned-in subtitles he cuts into every clip. Everywhere else the text sits
 * in the feed ABOVE or BESIDE the video and costs him nothing, which is why
 * this is a per-platform field and not a rule about all captions. What it
 * changes is the CAPTION only — the first comment carries the full CTA
 * exactly as before, because he excluded it in the same sentence.
 *
 * True here, and how each one was established (2026-09-22):
 *   tiktok     the only player it has.
 *   instagram  a single video IS a Reel (videoMaxSec above says so), and the
 *              published post URL is instagram.com/reel/<id>.
 *   facebook   MEASURED, because it was the one in doubt: the refund clip was
 *              posted as facebook.com/watch/?v=981201988355763 and Facebook's
 *              own og:url on that page is facebook.com/reel/981201988355763/.
 *              A 9:16 video on the page is a Reel whatever we called it.
 *   youtube    vertical under three minutes is a Short — the same test
 *              shortsAreDead already relies on.
 *
 * False for threads, linkedin, twitter and pinterest: all four are text-first
 * surfaces where the words sit outside the frame. Not measured with a ruler —
 * if he says the text covers a clip on one of those, add it here.
 */
const PLATFORMS = {
  instagram: {
    landscapeOk: false,           // aspectRange rejects it outright — reels are vertical
    captionOverlaysShort: true,   // a single video is a Reel; the caption sits on it
    // Default 0 — the FIRST frame, which is why Instagram's covers were the
    // worst of the three.
    coverFrame: { field: 'thumbOffset', where: 'platformSpecificData', unit: 'ms',
      imageUrl: 'instagramThumbnail' },
    commentsApi: true,             // inbox:* works; the watcher can reach it
    reshare: 'none',
    metrics: { views:'yes', reach:'yes', impressions:'yes', likes:'yes', comments:'yes',
               shares:'rare', saves:'partial', clicks:'no', watchTime:'yes' },
    captionMax: 2200,
    commentMax: 2200,              // a comment gets the same 2,200 as a caption
    foldAt: 125,
    hashtagsInCaption: 0,          // never spend the 5-cap twice (defensive, not a stated rule)
    // NOTHING is clickable on Instagram — not the caption, not a comment, not a
    // Reel. The link-in-bio industry exists because of this. Caption links are
    // in a Meta Verified test as of 2026; a Reel has no link surface at all.
    linkClickable: { caption: false, comment: false, profile: true },
    linkPlacement: 'profile',      // say where the link is; do not print a dead one
    supportsFirstComment: true,    // native platformSpecificData.firstComment
    deletable: false,              // nothing can be removed via the API — ever
    videoMinSec: 3,
    // 90, not the 900 this said until 2026-09-20. Zernio's Instagram page puts
    // a Reel at 90 seconds and a single video IS a Reel there (no contentType
    // makes it one). Nothing over 90 s has ever been sent, so the higher
    // number was never tested — a 2-minute clip would have passed this check
    // and failed at Instagram with the item already claimed. Raise it only
    // after a longer clip has actually published.
    videoMaxSec: 90,
    aspectRange: [0.5, 1.0],
    imageOk: true,
    imageMax: 10,            // carousel; Zernio's Instagram page, 2026-08-27
    // The IMAGE range, which is not the video one above. Exactly 1.91:1 is
    // rejected (float edge, bitten live) — pad a wide screenshot to about 1.78
    // with its own background colour rather than cropping it.
    imageAspectRange: [0.75, 1.91],
  },
  threads: {
    imageOk: true,           // same Meta surface as Instagram; a still posts fine
    imageMax: 10,            // carousel; Zernio's Threads page, 2026-08-27
    landscapeOk: false,           // an IG-shaped surface; vertical is what performs
    commentsApi: true,             // readable and repliable, same Meta auth as IG
    reshare: 'none',
    metrics: { views:'yes', reach:'no', impressions:'yes', likes:'no', comments:'partial',
               shares:'no', saves:'no', clicks:'no', watchTime:'no' },
    captionMax: 500,               // the #1 cross-posting failure
    commentMax: 500,               // a reply IS a post here — same 500 (Zernio validate:post-length)
    hashtagsInCaption: 0,
    // Threads is an Instagram-shaped surface that does NOT share Instagram's
    // link rule: a url in a post or a reply is a live link. It is the only Meta
    // property here where the comment mechanic actually reaches anybody.
    linkClickable: { caption: true, comment: true, profile: true },
    linkPlacement: 'comment',
    supportsFirstComment: false,   // no native field; the watcher does it
    deletable: true,
    videoMaxSec: 300,
  },
  tiktok: {
    // TikTok's API DID gain photo posts (4 Aug 2026). This stays false because
    // nothing here has ever sent one — contentType photo is a different request
    // shape with its own consent flags. False is "not built", not "impossible" —
    // and mate declined building them (2026-08-26, closing #27), so do not read
    // this as an open to-do.
    imageOk: false,
    imageMax: 0,             // imageOk is false — no still at all, so no gallery either
    landscapeOk: false,           // a vertical surface by definition
    captionOverlaysShort: true,   // the caption is drawn on the video; there is no other player
    // Lives in tiktokSettings at the TOP LEVEL, not platformSpecificData —
    // the same trap the six consent flags carry. Default 1000.
    coverFrame: { field: 'video_cover_timestamp_ms', where: 'tiktokSettings', unit: 'ms',
      imageUrl: 'video_cover_image_url' },
    commentsApi: false,            // no comments API at all — a first comment is impossible
    reshare: 'none',
    metrics: { views:'yes', reach:'no', impressions:'no', likes:'yes', comments:'partial',
               shares:'no', saves:'no', clicks:'no', watchTime:'no' },
    captionMax: 2200,
    hashtagsInCaption: 'all',
    // Nothing is clickable on TikTok — caption or comment, it is plain text.
    // Five short codes were minted for TikTok captions and took ZERO human
    // clicks, which is what a dead url looks like in the data.
    //
    // AND THE BIO IS NOT CLICKABLE EITHER. A website link in a TikTok bio is
    // tappable on a Business account, or on a personal one past 1,000
    // followers; this is a personal account with three (mate, 2026-09-14: "I
    // have less than 1000 follower, so not tapable"). For three weeks every
    // TikTok caption said "link in my bio" about a line of plain text. So the
    // placement is 'none': his words and the tags, and no claim about a link
    // at all. An honest nothing beats a lie. Flip `profile` back to true the
    // day the account is Business or past the threshold — and check it in the
    // app, because no logged-out fetch can read a TikTok profile.
    linkClickable: { caption: false, comment: false, profile: false },
    linkPlacement: 'none',         // no live slot anywhere — say nothing about a link
    supportsFirstComment: false,
    deletable: false,              // posts:unpublish → "TikTok does not support post deletion
                                   // via API" (2026-08-21, against two real duplicates). Same as
                                   // Instagram: every mistake here is permanent.
    consent: true,                 // six required flags, read from creator-info
    videoMinSec: 3,
    videoMaxSec: 3600,        // creator-info's live value; read it per account rather than trusting this
  },
  twitter: {
    imageOk: true,
    imageMax: 4,             // X's own cap; Zernio's X page, 2026-08-27
    landscapeOk: true,
    // Read and reply both 403'd until 2026-08-22, and we had that written down
    // as a limit of the plan. It was not: `xCapabilities.inbox` is a per-account
    // opt-in that defaults to OFF because it meters X API cost. Switched on, the
    // comment endpoints answer normally. The CTA still goes out as a thread
    // reply at publish time rather than through the watcher — see linkPlacement.
    commentsApi: true,
    reshare: 'none',
    metrics: { views:'no', reach:'no', impressions:'yes', likes:'no', comments:'no',
               shares:'no', saves:'no', clicks:'no', watchTime:'no' },
    captionMax: 280,               // Premium raises this, but 280 keeps it portable
    commentMax: 280,               // a reply is a tweet; unused, X is not watched
    hashtagsInCaption: 1,
    linkClickable: { caption: true, comment: true, profile: true },
    /*
     * The link goes in the TWEET, not in a thread reply (changed 2026-08-24,
     * mate's call, after reading xai-org/x-algorithm rather than the reporting).
     *
     * The thread existed to keep an external link out of the tweet that has to
     * travel, on the understanding that X demotes a post carrying one. That
     * premise is not in the open-sourced ranker: grepping has_url, url_penalty,
     * link_penalty, contains_link and external_link finds only USER features
     * measuring dwell time on a link, plus an ads threshold — engagement
     * signals, not a demotion. Positive control on the same search: `favorite`
     * hits 68 files.
     *
     * And the reply had a cost that was certain rather than theoretical.
     * home-mixer/filters/oon_retweet_reply_filter.rs drops any out-of-network
     * reply before it reaches the For You candidate set, so the CTA was only
     * ever SURFACED to people already following us — 8 of them. It stayed
     * readable to anyone who opened the root tweet, and nobody else.
     *
     * Cheaper too: a URL tweet is 20c flat and the fee REPLACES the base charge,
     * so one tweet is 20c against the thread's 1.5c + 20c.
     *
     * Reversing this is one word — 'reply' — plus the threadWithLink() that
     * git holds (deleted 2026-09-14 with the rest of the dead code; f8a2490
     * carries it). The evidence for the change is an absence in a code
     * release, which is weaker than a presence, and that is why the note stays.
     */
    linkPlacement: 'caption',
    supportsFirstComment: false,
    deletable: true,
    // X is the only platform that refuses a non-AAC audio track, and it does so
    // at 99% of the upload rather than up front (2026-08-21). Everything else
    // published the same Opus-in-MP4 file without comment.
    audioCodecs: ['aac'],
    // Measured off usage:stats, not inferred: 2 content_create + 5
    // content_create_with_url came to xSpendCents 103, so a URL tweet is 20c
    // FLAT — the fee REPLACES the 1.5c base charge rather than adding to it.
    // It was 21.5 while the link rode in a thread reply: a clean root at 1.5c
    // plus a reply carrying the url at 20c. One tweet, one fee, since
    // 2026-08-24.
    estCostCents: 20,
  },
  /*
   * PINTEREST (added 2026-09-20, ahead of the connection — mate is connecting
   * it himself). Zernio's Pinterest page is the source for every number here.
   *
   * It is a search engine wearing a feed: a pin keeps surfacing for months,
   * and the thing that drives traffic is `platformSpecificData.link`, the
   * destination a tap on the pin opens. That is a slot none of the others
   * have — not the caption (a url in a description is plain text), not a
   * comment (there is no comments API at all) — so it gets its own
   * linkPlacement, 'link', and post.js fills it with a tracked code minted
   * with medium 'link'. The title is the first line of his words, 100 max,
   * the same rule YouTube already imposes. Every pin needs a board; post.js
   * reads the account's boards at publish time and takes
   * MWK_PINTEREST_BOARD by name, or the first one.
   */
  pinterest: {
    imageOk: true,
    imageMax: 1,             // one image or one video per pin, no carousel
    landscapeOk: false,      // 2:3, 1:1 or 9:16 — the wide cut has no shape here
    // SECONDS here, where the other two count milliseconds. Default 0.
    coverFrame: { field: 'coverImageKeyFrameTime', where: 'platformSpecificData',
      unit: 's', imageUrl: 'coverImageUrl' },
    commentsApi: false,      // Pinterest exposes no comments and no DMs
    reshare: 'none',
    metrics: { views:'no', reach:'no', impressions:'yes', likes:'no', comments:'no',
               shares:'no', saves:'yes', clicks:'yes', watchTime:'no' },
    captionMax: 800,         // the description; the title is a separate 100
    titleMax: 100,
    hashtagsInCaption: 'all',
    linkClickable: { caption: false, comment: false, profile: true, link: true },
    linkPlacement: 'link',
    supportsFirstComment: false,
    // Not read from the docs either way. A pin's title, media, link and board
    // cannot be changed after publishing, so treat one as permanent until an
    // unpublish has been exercised.
    deletable: false,
    videoMinSec: 4,
    videoMaxSec: 900,
    aspectRange: [0.5, 1.0],
  },
  facebook: {
    imageOk: true,
    imageMax: 10,            // Zernio's Facebook page, 2026-08-27
    landscapeOk: true,           // feed takes landscape; Reels need the vertical cut
    captionOverlaysShort: true,  // a 9:16 post canonicalises to facebook.com/reel/<id> — measured
    commentsApi: true,
    // Personal timelines are impossible via any API (Meta rule). This was
    // 'manual' — a "share it yourself" row filed on the dashboard per post —
    // until 2026-09-14: twelve filed, none done, and the tile that would carry
    // a real alarm read 13 for three weeks. If he shares one, he shares one.
    reshare: 'none',
    metrics: { views:'partial', reach:'yes', impressions:'yes', likes:'yes', comments:'yes',
               shares:'yes', saves:'no', clicks:'yes', watchTime:'no' },
    captionMax: 63206,
    commentMax: 8000,              // a comment is capped far below a post
    hashtagsInCaption: 'all',
    // A url in a Facebook post or comment is a live link. Reach is the
    // constraint here, not clickability — hence the comment rather than the body.
    linkClickable: { caption: true, comment: true, profile: true },
    linkPlacement: 'comment',
    supportsFirstComment: true,
    deletable: true,
  },
  youtube: {
    imageOk: false,          // a video platform; there is nothing a still picture can be posted AS
    imageMax: 0,
    landscapeOk: true,           // vertical under 3 min auto-classifies as a Short
    captionOverlaysShort: true,  // ...and the Shorts player draws the title over the video
    /*
     * A PICTURE, NOT A TIMESTAMP — AND IT WORKS ON A SHORT, WHICH THE DOCS
     * DENY. Zernio's YouTube page says "custom thumbnails work on videos
     * only, not Shorts"; exercised 2026-09-22 on msRZswGIkCY, a Short, the
     * served maxresdefault.jpg changed to the frame we sent and stayed
     * changed. lib/cover.js carries the measurement.
     *
     * `how: 'update-metadata'` is the path that was EXERCISED, after the
     * video exists. Zernio also documents `thumbnail` on the media item at
     * publish time, which would avoid the minutes where YouTube's own pick
     * is live — documented, NOT exercised, so it is recorded and not used.
     *
     * ⚠ It sets the 16:9 thumbnail only: search, the channel grid, embeds,
     * share cards. The vertical cover inside the Shorts feed stays YouTube's
     * own (`oar1/2/3.jpg` are three of ITS candidates, none of them ours) and
     * no API sets it — that is the mobile app's Edit cover. Checked again
     * twenty minutes later, in case it was a cache: the 16:9 had changed
     * inside a minute and the vertical set still held YouTube's three.
     */
    coverImage: { field: 'thumbnailUrl', how: 'update-metadata',
      atPublish: 'thumbnail on the media item (documented, never exercised)',
      sets: '16:9 only — not the Shorts feed cover' },
    commentsApi: true,             // 403s on PRIVATE videos; unlisted is fine
    reshare: 'none',
    metrics: { views:'yes', reach:'no', impressions:'no', likes:'yes', comments:'yes',
               shares:'no', saves:'no', clicks:'no', watchTime:'no' },
    captionMax: 5000,
    commentMax: 10000,             // a comment runs to twice the description
    hashtagsInCaption: 'all',
    // TRUE FOR LONG-FORM ONLY. YouTube makes urls in SHORTS descriptions and
    // SHORTS comments non-clickable, deliberately, to cut spam — its own help
    // page says so outright. This pipeline only ever sends YouTube the wide
    // cut (landscapeOk), and a landscape video is never classified as a Short,
    // so the comment link is live. Send a vertical here and it silently is not.
    linkClickable: { caption: true, comment: true, profile: true },
    shortsAreDead: true,
    linkPlacement: 'comment',
    supportsFirstComment: true,
    deletable: true,
  },
  linkedin: {
    imageOk: true,
    imageMax: 20,            // the highest of the lot; Zernio's LinkedIn page, 2026-08-27
    landscapeOk: true,
    commentsApi: true,
    reshare: 'api',                // platformSpecificData.reshareUrl — his post, page + other profile repost
    metrics: { views:'no', reach:'yes', impressions:'yes', likes:'yes', comments:'yes',
               shares:'partial', saves:'no', clicks:'rare', watchTime:'no' },
    captionMax: 3000,
    commentMax: 1250,              // NOT the post cap — a comment stops at 1,250
    hashtagsInCaption: 'all',
    linkClickable: { caption: true, comment: true, profile: true },
    linkPlacement: 'comment',      // links in the body cut reach 40-50%
    supportsFirstComment: true,
    deletable: true,
  },
};


const get = (name) => {
  const p = PLATFORMS[name];
  if (!p) throw new Error(`unknown platform: ${name}`);
  return p;
};

/*
 * Whether this table knows a platform at all.
 *
 * THE RULE THIS COST US (2026-08-24): a Reddit account was connected to Zernio
 * on 2026-08-22 and `accounts:list` started returning it. Nothing in this table
 * describes Reddit, so `get('reddit')` threw and took the WHOLE queue run with
 * it — every five minutes, on the only item in the queue, for an hour before
 * anyone looked. Exactly the shape of the LinkedIn `find`-vs-`filter` bug: a new
 * account arrives, no error anybody reads, and the pipeline quietly stops.
 *
 * Connecting an account must never be able to break posting to the others. An
 * unknown platform is skipped and said out loud; whether it BECOMES a target is
 * a content decision, made by adding it to this table deliberately.
 */
const known = (name) => Object.prototype.hasOwnProperty.call(PLATFORMS, name);


/*
 * The posting shape for one platform, DERIVED from the capability fields above
 * rather than written out a second time. The dashboard's workflow page renders
 * this, so the page cannot drift from what the publish path actually does.
 */
function flowFor(name) {
  const p = get(name);
  const steps = [{ step: 'post', how: `media + caption${p.consent ? ', with the six TikTok consent flags' : ''}`,
    // So the caption rule is visible on the workflow page rather than only in
    // the composed output. It is conditional on the clip, which flowFor cannot
    // see, so it is worded as the condition rather than as a fact.
    note: p.captionOverlaysShort
      ? 'on a vertical clip under three minutes the caption is the title line and the tags only — '
        + 'the player draws it over his subtitles'
      : null }];

  if (p.supportsFirstComment) {
    steps.push({ step: 'first comment', how: 'native — Zernio posts it seconds after publish',
      by: 'native', note: name === 'youtube' ? 'posted and pinned' : null });
  } else if (commentWatched(name)) {
    /*
     * commentWatched(), not commentsApi. This keyed off the API alone and said
     * "the hourly watcher posts it" about X — which the watcher has never
     * touched, because X's CTA ships INSIDE the post: in its caption since
     * 2026-08-24, in a thread reply before that. Either way, not a comment. That is
     * the THIRD time this exact claim has been made about a platform the
     * watcher cannot reach: post.js printed it wrongly twice, once keyed off
     * !linkInCaption and once off commentsApi, which is why commentWatched()
     * exists twenty lines above this. It renders on the dashboard's workflow
     * page, so the wrong answer was live and readable.
     */
    steps.push({ step: 'first comment', how: 'the hourly watcher posts it', by: 'watcher' });
  } else {
    steps.push({ step: 'first comment',
      how: p.commentsApi
        ? 'none — the CTA ships with the post itself, so a comment would repeat it'
        : 'impossible — no comments API we can use',
      by: 'none',
      note: p.commentsApi ? 'a comments API exists; the link simply does not go there' : 'no comments API at all' });
  }

  if (p.linkPlacement === 'none') {
    steps.push({ step: 'the link', how: 'none — nothing here is clickable, the bio included',
      note: 'a url is plain text in the caption and in a comment, and the bio link is plain '
        + 'text too on a personal account under 1,000 followers. So the post carries no link '
        + 'and says nothing about one; a claim nobody can act on is worse than silence' });
  } else if (p.linkPlacement === 'profile') {
    steps.push({ step: 'the link', how: 'the bio — the post says so, and no code is minted',
      note: 'a url is plain text here, in the caption and in a comment alike. A tracked code '
        + 'spent on a click that cannot happen reads as indifference rather than as unreachable' });
  } else if (p.linkPlacement === 'caption') {
    steps.push({ step: 'the link', how: 'appended to the caption, with its own tracked code',
      note: 'there is nowhere else — no comments API, so a clean caption would be a dead end' });
  } else if (p.linkPlacement === 'link') {
    steps.push({ step: 'the link', how: 'the pin\'s own destination field, with its own tracked code',
      note: 'a tap on the pin opens it; a url in the description would be plain text' });
  } else if (p.linkPlacement === 'reply') {
    steps.push({ step: 'the link', how: 'a second tweet in the same call, with its own tracked code',
      note: 'an out-of-network reply never enters the For You candidate set, so this CTA '
        + 'reaches existing followers only. Not in use since 2026-08-24 — the link is in the tweet' });
  } else {
    steps.push({ step: 'the link', how: 'in the first comment, to keep it out of the body' });
  }

  if (p.reshare === 'api') steps.push({ step: 'reshare', how: 'posted from his profile; the page reposts it with the CTA, the other profile plain', by: 'api' });

  return { platform: name, steps, capabilities: p };
}

const flows = () => Object.keys(PLATFORMS).map(flowFor);

/*
 * Does the hourly first-comment watcher cover this platform?
 *
 * Two conditions, and BOTH matter. A comments API is necessary but not
 * sufficient: X has one now, and the watcher still must not touch it, because
 * X's CTA ships inside the post itself — its caption since 2026-08-24, a thread
 * reply before that — and a second one would be the same link twice. Stated once, here, because
 * post.js decides what to print from it and first-comment.js's own list is
 * pinned against it in a test — the promise "the watcher adds it" has been
 * printed wrongly twice already.
 */
const commentWatched = (name) => {
  try {
    const p = get(name);
    // Not `linkPlacement === 'comment'`: Instagram's CTA is still a comment, it
    // just names the bio instead of carrying a url, because no url on Instagram
    // is clickable. What excludes a platform is carrying its CTA in the POST —
    // X does, in its caption since 2026-08-24; TikTok did, before it moved to
    // the profile. 'reply' stays in the list because reversing X is one word.
    return p.commentsApi === true && !['caption', 'reply'].includes(p.linkPlacement);
  } catch { return false; }
};

/*
 * Which surface a platform's link actually lands on. `reply` is a post of its
 * own on X, so it is governed by the caption rule, not the comment one.
 */
// 'none' is a placement with no slot: the platform has nowhere a link is live,
// so the post carries no link and makes no claim about one.
// 'link' is Pinterest's destination field: not text anywhere, a property of
// the pin itself. It is live by construction, which is why it has its own slot
// rather than borrowing 'caption'.
const SLOT = { caption: 'caption', reply: 'caption', comment: 'comment', profile: 'profile', link: 'link', none: null };

/*
 * Is the link we place on this platform a LIVE link, or plain text?
 *
 * This exists because for three weeks the pipeline minted tracked short codes
 * for Instagram comments and TikTok captions, where a url is not clickable on
 * either — five TikTok codes took zero human clicks between them. A code spent
 * somewhere nobody can click it is worse than no code: it reads in the numbers
 * as "posted, no interest" rather than "never reachable".
 */
const linkIsLive = (name) => {
  try {
    const p = get(name);
    return !!(p.linkClickable || {})[SLOT[p.linkPlacement]];
  } catch { return false; }
};

/*
 * IS THIS CLIP A SHORT? One definition, because two rules now turn on it.
 *
 * Vertical and under three minutes — YouTube's own auto-classification, and
 * the same shape every other short-form player takes. It was written inline
 * in linkDeadFor() while it had one reader; captionOverlaysShort is the
 * second, and two copies of a threshold is how one of them drifts.
 *
 * A still is never a Short: it has a duration of 0 and would otherwise pass
 * both halves of the test.
 */
const isShort = (probe) => !!probe && !probe.isImage
  && probe.aspect <= 1 && probe.durationSec < 180;

/*
 * Will a link in this platform's post actually be clickable FOR THIS CLIP?
 *
 * Separate from linkIsLive because it depends on the media, not just the
 * platform. YouTube is the only case today: a vertical video under three
 * minutes is auto-classified as a Short, and YouTube deliberately makes urls in
 * Shorts descriptions and Shorts comments plain text. `shortsAreDead` was added
 * to the table on 2026-08-22 and read by nothing, which is the same
 * declared-but-never-wired trap as linkPlacement, landscapeOk and
 * hashtagsInCaption before it — so it is wired here.
 */
function linkDeadFor(name, probe) {
  try {
    return !!get(name).shortsAreDead && isShort(probe);
  } catch { return false; }
}

/*
 * HOW FAR INTO THE CLIP THE COVER SITS, in milliseconds, for every platform
 * that takes one.
 *
 * 2,000 ms, and it is a measurement rather than a taste. On the clip that
 * prompted this (2026-09-22, 37.7 s at 60 fps) the frames read: 0 ms and
 * 167 ms — the title card up and an EMPTY FIELD, nobody in shot; 1,000 ms —
 * he has walked in, title still up; 2,000 ms — in shot, title up, steady.
 * By 10,000 ms the title card is gone. So the window that works is roughly
 * one to four seconds, and 2,000 sits in the middle of it.
 *
 * ⚠ "THE TENTH FRAME" DOES NOT DO WHAT IT SOUNDS LIKE. He asked for frame 10
 * to keep it simple; at 60 fps that is 167 ms, which on this clip is the
 * empty field — the exact picture the complaint was about. A frame index is
 * not a time: the same index is 167 ms at 60 fps and 333 ms at 30. This is
 * why the setting is a duration.
 *
 * MWK_COVER_MS overrides it with no deploy. An unparseable value falls back
 * rather than throwing — a typo in an env var must not stop a publish.
 */
const COVER_MS = 2000;

/**
 * The cover offset for THIS clip, clamped to something inside it.
 *
 * A clip shorter than the offset would otherwise ask for a frame past the
 * end, and what a platform does with that is undocumented on all three. Half
 * way in is always inside.
 *
 * @param {object|null} probe the media probe, or null when there is none.
 * @returns {number|null} milliseconds, or null when there is no video to
 *   take a frame from.
 */
function coverMsFor(probe) {
  if (!probe || probe.isImage || !Number.isFinite(probe.durationSec)) return null;
  const asked = Number(process.env.MWK_COVER_MS);
  const want = Number.isFinite(asked) && asked >= 0 ? asked : COVER_MS;
  const durationMs = probe.durationSec * 1000;
  return want < durationMs ? want : Math.round(durationMs / 2);
}

/**
 * Does this platform take a cover as an IMAGE pushed after publishing?
 *
 * YouTube alone, today. Separate from coverFor() because it is a different
 * mechanism at a different time: the timestamp platforms carry theirs in the
 * publish, and this one needs the video to exist first.
 */
function coverImageFor(name) {
  try { return get(name).coverImage || null; } catch { return null; }
}

/**
 * The cover-frame field this platform wants, ready to spread into a request.
 *
 * Returns the destination as well as the value, because the three platforms
 * that take one disagree about both: TikTok's goes in the top-level
 * `tiktokSettings`, the other two in the entry's `platformSpecificData`, and
 * Pinterest counts SECONDS where the others count milliseconds. The caller
 * passes ONE number in milliseconds and this converts it, so a unit mistake
 * cannot be made at a call site.
 *
 * @param {string} name
 * @param {number} ms how far into the clip the cover frame sits.
 * @returns {{where: string, fields: object}|null} null when the platform
 *   documents no cover field — which is most of them.
 */
function coverFor(name, ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  let cf;
  try { cf = get(name).coverFrame; } catch { return null; }
  if (!cf) return null;
  // Pinterest takes seconds. Rounded, not floored: 1500 ms is nearer 2 s than
  // 1, and the difference is a frame nobody can see.
  const value = cf.unit === 's' ? Math.round(ms / 1000) : Math.round(ms);
  return { where: cf.where, fields: { [cf.field]: value } };
}

/*
 * Will this platform draw the caption OVER the video for this clip?
 *
 * Then the caption is his title line and the hashtags, and nothing else — the
 * rest of his words would sit on top of the subtitles he burned into the clip
 * (mate, 2026-09-22; the field's own comment at the top of this file carries
 * his words and how each platform was established).
 *
 * Both halves matter. The platform decides whether there is a short-form
 * player at all; the CLIP decides whether it goes into it. Facebook and
 * YouTube publish landscape into an ordinary feed or watch page, where the
 * text is nowhere near the picture and a full caption is right.
 */
function captionOverlaysShortFor(name, probe) {
  try {
    return !!get(name).captionOverlaysShort && isShort(probe);
  } catch { return false; }
}

/*
 * How many of a gallery a platform will actually take.
 *
 * A still is the only thing that can ride in a set: ONE VIDEO PER POST is a hard
 * limit everywhere (Facebook's docs are explicit, and images and videos cannot
 * be mixed either), so a list of clips is never a gallery — it is separate
 * posts, which is what landscapeOk already routes.
 *
 * `imageMax` is read by `galleryFor()` below, by `galleryProblems()` further
 * down, and by the dashboard's config page. It went onto the table on
 * 2026-08-27 with a gallery to feed, deliberately: this repo has shipped
 * linkPlacement, landscapeOk, hashtagsInCaption and shortsAreDead as fields
 * declared and read by nothing, and a config page that renders an unread field
 * makes it look implemented. Wire it or do not add it.
 *
 * Caps are Zernio's own platform pages, read 2026-08-27: LinkedIn 20,
 * Facebook 10, Instagram 10, Threads 10, X 4.
 *
 * @param {string} name
 * @param {Array<{probe?: {isImage?: boolean}}>} items - the gallery, in order
 * @returns {Array} what this platform gets: capped, or just the first when it
 *   takes no gallery, or everything when the caller gave us no probes to judge.
 */
function galleryFor(name, items) {
  const list = items || [];
  if (list.length <= 1) return list;
  const p = get(name);
  // A set of stills only. One non-image in the list and the whole thing
  // collapses to the first item rather than half-publishing a mixed post.
  if (!list.every((m) => m && m.probe && m.probe.isImage)) return list.slice(0, 1);
  const max = Number.isFinite(p.imageMax) ? p.imageMax : 1;
  if (max <= 0) return [];
  return list.slice(0, max);
}

/*
 * Every way the table can contradict itself about galleries. Empty means
 * consistent, and a test asserts it — the same guard linkProblems() is.
 */
function galleryProblems() {
  const out = [];
  for (const name of Object.keys(PLATFORMS)) {
    const p = PLATFORMS[name];
    if (!Number.isFinite(p.imageMax)) { out.push(`${name}: no imageMax — say how many stills it takes`); continue; }
    if (p.imageOk && p.imageMax < 1) out.push(`${name}: takes a still but imageMax is ${p.imageMax}`);
    if (!p.imageOk && p.imageMax > 0) out.push(`${name}: takes no still at all but imageMax is ${p.imageMax}`);
  }
  return out;
}

/*
 * Every way the table can contradict itself about links, as a list of problems.
 * Empty means consistent, and a test asserts that — so `linkClickable` cannot
 * become the fourth decorative field here after linkPlacement, landscapeOk and
 * hashtagsInCaption each shipped declared-but-never-read.
 */
function linkProblems() {
  const out = [];
  for (const name of Object.keys(PLATFORMS)) {
    const p = PLATFORMS[name];
    if (!p.linkClickable) { out.push(`${name}: no linkClickable — say where a url is live`); continue; }
    if (!(p.linkPlacement in SLOT)) { out.push(`${name}: linkPlacement '${p.linkPlacement}' is not a slot`); continue; }
    const slot = SLOT[p.linkPlacement];
    // 'none' is only honest when there is genuinely nowhere: a live slot left
    // unused is a link nobody was handed, which is the opposite mistake.
    if (slot === null) {
      const live = Object.keys(p.linkClickable).filter((k) => p.linkClickable[k]);
      if (live.length) out.push(`${name}: places no link although the ${live.join('/')} would be live`);
      continue;
    }
    if (!p.linkClickable[slot]) {
      out.push(`${name}: places its link in the ${slot}, where it is not clickable`);
    }
    if (p.linkPlacement === 'profile' && (p.linkClickable.caption || p.linkClickable.comment)) {
      out.push(`${name}: points at the profile although a post link would be live`);
    }
  }
  return out;
}

/*
 * Every way the table can contradict itself about comment length. Empty means
 * consistent, and a test asserts it — commentMax is wired into
 * voice.firstComment() in the same change that declares it, because a declared
 * and never-read field is this repo's single most repeated failure.
 */
function commentProblems() {
  const out = [];
  for (const name of Object.keys(PLATFORMS)) {
    const p = PLATFORMS[name];
    if (p.commentsApi && !(Number.isFinite(p.commentMax) && p.commentMax > 0)) {
      out.push(`${name}: has a comments API but no commentMax — say how long a comment may be`);
    }
    if (!p.commentsApi && p.commentMax !== undefined) {
      out.push(`${name}: no comments API, yet it declares a commentMax of ${p.commentMax}`);
    }
  }
  return out;
}

module.exports = { PLATFORMS, get, known, flowFor, flows, commentWatched, linkIsLive,
  isShort, linkDeadFor, captionOverlaysShortFor, coverFor, coverImageFor, coverMsFor, COVER_MS,
  linkProblems, galleryFor,
  galleryProblems, commentProblems, SLOT };
