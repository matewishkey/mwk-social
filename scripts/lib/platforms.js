/*
 * What each platform will and won't allow. One table, so a rule is stated once.
 *
 * Everything publishes through this pipeline now, so the fields that existed to
 * work out whether a copy of a clip was ALREADY somewhere are gone with the
 * mirror that needed them. What is left describes what a platform will accept
 * and what it reports back.
 */
'use strict';

const PLATFORMS = {
  instagram: {
    landscapeOk: false,           // aspectRange rejects it outright — reels are vertical
    commentsApi: true,             // inbox:* works; the watcher can reach it
    reshare: 'none',
    metrics: { views:'yes', reach:'yes', impressions:'yes', likes:'yes', comments:'yes',
               shares:'rare', saves:'partial', clicks:'no', watchTime:'yes' },
    captionMax: 2200,
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
    videoMaxSec: 900,
    aspectRange: [0.5, 1.0],
    imageOk: true,
    // The IMAGE range, which is not the video one above. Exactly 1.91:1 is
    // rejected (float edge, bitten live) — pad a wide screenshot to about 1.78
    // with its own background colour rather than cropping it.
    imageAspectRange: [0.75, 1.91],
  },
  threads: {
    imageOk: true,           // same Meta surface as Instagram; a still posts fine
    landscapeOk: false,           // an IG-shaped surface; vertical is what performs
    commentsApi: true,             // readable and repliable, same Meta auth as IG
    reshare: 'none',
    metrics: { views:'yes', reach:'no', impressions:'yes', likes:'no', comments:'partial',
               shares:'no', saves:'no', clicks:'no', watchTime:'no' },
    captionMax: 500,               // the #1 cross-posting failure
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
    landscapeOk: false,           // a vertical surface by definition
    commentsApi: false,            // no comments API at all — a first comment is impossible
    reshare: 'none',
    metrics: { views:'yes', reach:'no', impressions:'no', likes:'yes', comments:'partial',
               shares:'no', saves:'no', clicks:'no', watchTime:'no' },
    captionMax: 2200,
    hashtagsInCaption: 'all',
    // Nothing is clickable on TikTok either — caption or comment, it is plain
    // text. Five short codes were minted for TikTok captions and took ZERO
    // human clicks, which is what a dead url looks like in the data.
    linkClickable: { caption: false, comment: false, profile: true },
    linkPlacement: 'profile',      // the bio is the only live link TikTok has
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
     * Reversing this is one word — 'reply' — and threadWithLink() and its tests
     * are deliberately still here for that. The evidence is an absence in a
     * code release, which is weaker than a presence.
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
  facebook: {
    imageOk: true,
    landscapeOk: true,           // feed takes landscape; Reels need the vertical cut
    commentsApi: true,
    reshare: 'manual',             // personal timelines are impossible via any API (Meta rule)
    metrics: { views:'partial', reach:'yes', impressions:'yes', likes:'yes', comments:'yes',
               shares:'yes', saves:'no', clicks:'yes', watchTime:'no' },
    captionMax: 63206,
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
    landscapeOk: true,           // vertical under 3 min auto-classifies as a Short
    commentsApi: true,             // 403s on PRIVATE videos; unlisted is fine
    reshare: 'none',
    metrics: { views:'yes', reach:'no', impressions:'no', likes:'yes', comments:'yes',
               shares:'no', saves:'no', clicks:'no', watchTime:'no' },
    captionMax: 5000,
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
    landscapeOk: true,
    commentsApi: true,
    reshare: 'api',                // platformSpecificData.reshareUrl — company post, personal quote
    metrics: { views:'no', reach:'yes', impressions:'yes', likes:'yes', comments:'yes',
               shares:'partial', saves:'no', clicks:'rare', watchTime:'no' },
    captionMax: 3000,
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
  const steps = [{ step: 'post', how: `media + caption${p.consent ? ', with the six TikTok consent flags' : ''}` }];

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

  if (p.linkPlacement === 'profile') {
    steps.push({ step: 'the link', how: 'the bio — the post says so, and no code is minted',
      note: 'a url is plain text here, in the caption and in a comment alike. A tracked code '
        + 'spent on a click that cannot happen reads as indifference rather than as unreachable' });
  } else if (p.linkPlacement === 'caption') {
    steps.push({ step: 'the link', how: 'appended to the caption, with its own tracked code',
      note: 'there is nowhere else — no comments API, so a clean caption would be a dead end' });
  } else if (p.linkPlacement === 'reply') {
    steps.push({ step: 'the link', how: 'a second tweet in the same call, with its own tracked code',
      note: 'X penalises whichever tweet holds the link — the root stays clean, for 1.5c' });
  } else {
    steps.push({ step: 'the link', how: 'in the first comment, to keep it out of the body' });
  }

  if (p.reshare === 'api') steps.push({ step: 'reshare', how: 'quote-reshared from the personal account', by: 'api' });
  else if (p.reshare === 'manual') steps.push({ step: 'reshare', by: 'manual',
    how: 'your turn — personal timelines are impossible via any API (Meta rule)' });

  return { platform: name, steps, capabilities: p };
}

const flows = () => Object.keys(PLATFORMS).map(flowFor);

/*
 * Does the hourly first-comment watcher cover this platform?
 *
 * Two conditions, and BOTH matter. A comments API is necessary but not
 * sufficient: X has one now, and the watcher still must not touch it, because
 * X's CTA already goes out as a thread reply at publish time and a second one
 * would be the same link twice under one post. Stated once, here, because
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
const SLOT = { caption: 'caption', reply: 'caption', comment: 'comment', profile: 'profile' };

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
    const p = get(name);
    if (!p.shortsAreDead || !probe) return false;
    return probe.aspect <= 1 && probe.durationSec < 180;
  } catch { return false; }
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
    const slot = SLOT[p.linkPlacement];
    if (!slot) { out.push(`${name}: linkPlacement '${p.linkPlacement}' is not a slot`); continue; }
    if (!p.linkClickable[slot]) {
      out.push(`${name}: places its link in the ${slot}, where it is not clickable`);
    }
    if (p.linkPlacement === 'profile' && (p.linkClickable.caption || p.linkClickable.comment)) {
      out.push(`${name}: points at the profile although a post link would be live`);
    }
  }
  return out;
}

module.exports = { PLATFORMS, get, known, flowFor, flows, commentWatched, linkIsLive,
  linkDeadFor, linkProblems, SLOT };
