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
    editable: false,
    metrics: { views:'yes', reach:'yes', impressions:'yes', likes:'yes', comments:'yes',
               shares:'rare', saves:'partial', clicks:'no', watchTime:'yes' },
    captionMax: 2200,
    foldAt: 125,
    hashtagsInCaption: 0,          // the cap counts caption AND comments together
    linkPlacement: 'comment',
    markerInCaption: false,
    supportsFirstComment: true,    // native platformSpecificData.firstComment
    deletable: false,              // nothing can be removed via the API — ever
    videoMinSec: 3,
    videoMaxSec: 900,
    aspectRange: [0.5, 1.0],
  },
  threads: {
    landscapeOk: false,           // an IG-shaped surface; vertical is what performs
    commentsApi: true,             // readable and repliable, same Meta auth as IG
    reshare: 'none',
    editable: false,
    metrics: { views:'yes', reach:'no', impressions:'yes', likes:'no', comments:'partial',
               shares:'no', saves:'no', clicks:'no', watchTime:'no' },
    captionMax: 500,               // the #1 cross-posting failure
    hashtagsInCaption: 0,
    linkPlacement: 'comment',
    markerInCaption: false,
    supportsFirstComment: false,   // no native field; the watcher does it
    deletable: true,
    videoMaxSec: 300,
  },
  tiktok: {
    landscapeOk: false,           // a vertical surface by definition
    commentsApi: false,            // no comments API at all — a first comment is impossible
    reshare: 'none',
    editable: false,
    metrics: { views:'yes', reach:'no', impressions:'no', likes:'yes', comments:'partial',
               shares:'no', saves:'no', clicks:'no', watchTime:'no' },
    captionMax: 2200,
    hashtagsInCaption: 'all',
    linkPlacement: 'caption',      // no comment API of any kind
    markerInCaption: true,
    supportsFirstComment: false,
    deletable: true,
    consent: true,                 // six required flags, read from creator-info
    videoMinSec: 3,
    videoMaxSec: 3600,        // creator-info's live value; read it per account rather than trusting this
  },
  twitter: {
    landscapeOk: true,
    commentsApi: false,            // read AND reply 403 on this plan
    reshare: 'none',
    editable: false,
    metrics: { views:'no', reach:'no', impressions:'yes', likes:'no', comments:'no',
               shares:'no', saves:'no', clicks:'no', watchTime:'no' },
    captionMax: 280,               // Premium raises this, but 280 keeps it portable
    urlLength: 23,                 // every URL counts as a t.co link
    hashtagsInCaption: 1,
    linkPlacement: 'caption',      // comment endpoints 403, and the post is cheaper
    markerInCaption: true,
    supportsFirstComment: false,
    deletable: true,
    estCostCents: 20,              // content_create_with_url, measured
  },
  facebook: {
    landscapeOk: true,           // feed takes landscape; Reels need the vertical cut
    commentsApi: true,
    reshare: 'manual',             // personal timelines are impossible via any API (Meta rule)
    editable: true,
    metrics: { views:'partial', reach:'yes', impressions:'yes', likes:'yes', comments:'yes',
               shares:'yes', saves:'no', clicks:'yes', watchTime:'no' },
    captionMax: 63206,
    hashtagsInCaption: 'all',
    linkPlacement: 'comment',
    markerInCaption: false,
    supportsFirstComment: true,
    deletable: true,
  },
  youtube: {
    landscapeOk: true,           // vertical under 3 min auto-classifies as a Short
    commentsApi: true,             // 403s on PRIVATE videos; unlisted is fine
    reshare: 'none',
    editable: true,                // posts:update-metadata — title, description, tags, thumbnail
    metrics: { views:'yes', reach:'no', impressions:'no', likes:'yes', comments:'yes',
               shares:'no', saves:'no', clicks:'no', watchTime:'no' },
    captionMax: 5000,
    hashtagsInCaption: 'all',
    linkPlacement: 'comment',
    markerInCaption: false,
    supportsFirstComment: true,
    deletable: true,
  },
  linkedin: {
    landscapeOk: true,
    commentsApi: true,
    reshare: 'api',                // platformSpecificData.reshareUrl — company post, personal quote
    editable: false,
    metrics: { views:'no', reach:'yes', impressions:'yes', likes:'yes', comments:'yes',
               shares:'partial', saves:'no', clicks:'rare', watchTime:'no' },
    captionMax: 3000,
    hashtagsInCaption: 'all',
    linkPlacement: 'comment',      // links in the body cut reach 40-50%
    markerInCaption: false,
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
  } else if (p.commentsApi) {
    steps.push({ step: 'first comment', how: 'the hourly watcher posts it', by: 'watcher' });
  } else {
    steps.push({ step: 'first comment', how: 'impossible — no comments API we can use',
      by: 'none', note: name === 'twitter' ? 'read and reply both 403 on this plan' : 'no comments API at all' });
  }

  steps.push(p.linkPlacement === 'caption'
    ? { step: 'the link', how: 'appended to the caption, with its own tracked code',
        note: 'there is nowhere else — no comments API, so a clean caption would be a dead end' }
    : { step: 'the link', how: 'in the first comment, to keep it out of the body' });

  if (p.reshare === 'api') steps.push({ step: 'reshare', how: 'quote-reshared from the personal account', by: 'api' });
  else if (p.reshare === 'manual') steps.push({ step: 'reshare', by: 'manual',
    how: 'your turn — personal timelines are impossible via any API (Meta rule)' });

  return { platform: name, steps, capabilities: p };
}

const flows = () => Object.keys(PLATFORMS).map(flowFor);

module.exports = { PLATFORMS, get, flowFor, flows };
