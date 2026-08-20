/*
 * What each platform will and won't allow. One table, so a rule is stated once.
 *
 * `verifiable` is the load-bearing field: it says whether we can ask a platform
 * "does a copy of this clip already exist here?" and believe the answer. Threads
 * cannot be enumerated at all, so it can prove presence but never absence — and
 * the mirror must never treat "I found nothing" there as "there is nothing".
 */
'use strict';

const PLATFORMS = {
  instagram: {
    captionMax: 2200,
    foldAt: 125,
    hashtagsInCaption: 0,          // the cap counts caption AND comments together
    linkPlacement: 'comment',
    markerInCaption: false,
    supportsFirstComment: true,    // native platformSpecificData.firstComment
    deletable: false,              // nothing can be removed via the API — ever
    verifiable: 'strong',          // the only platform reporting videoDurationSeconds
    mediaUrlAvailable: true,
    videoMinSec: 3,
    videoMaxSec: 900,
    aspectRange: [0.5, 1.0],
  },
  threads: {
    captionMax: 500,               // the #1 cross-posting failure
    hashtagsInCaption: 0,
    linkPlacement: 'comment',
    markerInCaption: false,
    supportsFirstComment: false,   // no native field; the watcher does it
    deletable: true,
    verifiable: 'none',            // invisible to analytics:posts
    mediaUrlAvailable: false,
    videoMaxSec: 300,
  },
  tiktok: {
    captionMax: 2200,
    hashtagsInCaption: 'all',
    linkPlacement: 'caption',      // no comment API of any kind
    markerInCaption: true,
    supportsFirstComment: false,
    deletable: true,
    verifiable: 'medium',
    mediaUrlAvailable: false,      // platform_withheld
    consent: true,                 // six required flags, read from creator-info
    videoMinSec: 3,
    videoMaxSec: 600,
  },
  twitter: {
    captionMax: 280,               // Premium raises this, but 280 keeps it portable
    urlLength: 23,                 // every URL counts as a t.co link
    hashtagsInCaption: 1,
    linkPlacement: 'caption',      // comment endpoints 403, and the post is cheaper
    markerInCaption: true,
    supportsFirstComment: false,
    deletable: true,
    verifiable: 'medium',
    mediaUrlAvailable: false,
    estCostCents: 20,              // content_create_with_url, measured
  },
  facebook: {
    captionMax: 63206,
    hashtagsInCaption: 'all',
    linkPlacement: 'comment',
    markerInCaption: false,
    supportsFirstComment: true,
    deletable: true,
    verifiable: 'strong',
    mediaUrlAvailable: true,
  },
  youtube: {
    captionMax: 5000,
    hashtagsInCaption: 'all',
    linkPlacement: 'comment',
    markerInCaption: false,
    supportsFirstComment: true,
    deletable: true,
    verifiable: 'strong',
    mediaUrlAvailable: false,      // empty url; use yt-dlp
  },
  linkedin: {
    captionMax: 3000,
    hashtagsInCaption: 'all',
    linkPlacement: 'comment',      // links in the body cut reach 40-50%
    markerInCaption: false,
    supportsFirstComment: true,
    deletable: true,
    verifiable: 'strong',
    mediaUrlAvailable: false,
  },
};

// Where new reels are mirrored to. Facebook is the source, and LinkedIn,
// YouTube and Twitch are already covered by Restream.
const MIRROR_TARGETS = ['threads', 'twitter', 'tiktok', 'instagram'];
// Deliberately in that order: reversibility first. Instagram is last on every
// clip because it is the only one we cannot undo.

const SOURCE_PLATFORM = 'facebook';

const get = (name) => {
  const p = PLATFORMS[name];
  if (!p) throw new Error(`unknown platform: ${name}`);
  return p;
};

module.exports = { PLATFORMS, MIRROR_TARGETS, SOURCE_PLATFORM, get };
