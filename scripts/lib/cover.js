/*
 * THE COVER FRAME ON YOUTUBE IS A PICTURE, NOT A TIMESTAMP — AND IT WORKS ON A
 * SHORT, WHICH BOTH ZERNIO'S DOCS AND THIS REPO SAID IT DOES NOT.
 *
 * Mate, 2026-09-22: "research the youtube API, they are selecting the wrong
 * frame". They were: on the job interview Short, YouTube's own pick was a
 * frame from the screen-recording section in the middle of the clip — an
 * empty video call — instead of the branded opening.
 *
 * EXERCISED, not read (2026-09-22, video msRZswGIkCY):
 *   - `POST /posts/_/update-metadata` with `{platform, videoId, accountId,
 *     thumbnailUrl}` answered `updatedFields: ["thumbnailUrl"]` — which on its
 *     own proves nothing, as CLAUDE.md has said since August.
 *   - Checked at YOUTUBE's end, cache-busted, against the BEFORE bytes:
 *     maxresdefault.jpg went c965c70f… to 1769a116…, stable over six minutes,
 *     and the picture is our frame.
 *
 * ⚠ IT CHANGES THE 16:9 THUMBNAIL AND NOT THE SHORTS COVER. Measured at the
 * same time: the channel's Shorts shelf serves `oar2.jpg`, still YouTube's own
 * vertical pick from ~10 seconds in. So:
 *   - search results, the channel's video grid, embeds, suggested and every
 *     share card — OURS.
 *   - the vertical cover inside the Shorts feed — YouTube's, and no API
 *     documents a way to set it. That one is the mobile app's "Edit cover".
 * Do not let a summary flatten those two into "we can set the thumbnail".
 *
 * Every failure here is non-fatal by construction. The post is already live
 * when this runs; a cover that did not land is worth a line in the journal and
 * nothing more.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { api, cli } = require('./api');

/**
 * One frame, as a JPEG on disk.
 *
 * `-ss` before `-i` so ffmpeg seeks rather than decodes up to the mark — the
 * difference is a second against a minute on a long clip, and this runs after
 * a publish when nothing is waiting on it but the journal.
 *
 * @param {string} file the local video.
 * @param {number} ms how far in.
 * @returns {string} the jpeg's path, in a temp dir the caller may leave behind.
 */
function frameAt(file, ms) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwk-cover-'));
  // Named for the video and the offset, because `zernio media:upload` reads
  // the content type off the EXTENSION and a human reading the journal should
  // be able to tell which frame went up.
  const out = path.join(dir, `cover-${Math.round(ms)}ms.jpg`);
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-ss', String(ms / 1000), '-i', file, '-frames:v', '1', '-q:v', '2', out],
  { stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
    throw new Error(`ffmpeg wrote no frame at ${ms} ms`);
  }
  return out;
}

/**
 * Should this outcome entry get a cover pushed to it?
 *
 * Kept apart from the doing so the decision is testable without a network:
 * YouTube only, a video only, and only when the publish actually returned the
 * platform's own video id — the Zernio `_id` 404s on this route.
 */
function wantsCover({ platform, status, postId }, { isVideo, coverMs }) {
  return platform === 'youtube'
    && (status === 'published' || status === 'posted')
    && !!postId
    && isVideo === true
    && Number.isFinite(coverMs);
}

/**
 * Put the frame at `ms` on a published YouTube video as its thumbnail.
 *
 * @returns {Promise<string>} the url that was set, for the log line.
 */
async function setYoutubeCover({ file, ms, videoId, accountId }) {
  const jpg = frameAt(file, ms);
  const up = cli(['media:upload', jpg]);
  if (!up || !up.url) throw new Error('media:upload returned no url for the cover frame');
  // The body goes in `body`, which is the one thing that went wrong when this
  // was first called by hand: api() takes an options object, and a payload
  // passed positionally arrives as an empty POST and 400s.
  await api('POST', '/posts/_/update-metadata', {
    body: { platform: 'youtube', videoId, accountId, thumbnailUrl: up.url },
  });
  return up.url;
}

module.exports = { frameAt, wantsCover, setYoutubeCover };
