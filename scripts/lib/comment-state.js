/*
 * Which published posts the first-comment watcher has already dealt with.
 *
 * It lives here rather than inside first-comment.js because TWO things write
 * it now, and that is the whole point of the file existing.
 *
 * `--no-first-comment` used to hold for about an hour. post.js correctly sent
 * no native comment; then the hourly watcher read posts:list, found a published
 * post with no CTA in its caption and none in its comments, and posted one.
 * Nothing anywhere told it the absence was a DECISION rather than a gap — which
 * is exactly what the watcher exists to fill in. So the publisher now records
 * the decision here, under the same key the watcher looks up, and the flag
 * means what it says.
 *
 * The key is `<platform>:<native post id>` — the platform's own id, never the
 * Zernio one, because that is what the watcher collects and what every inbox:*
 * command needs.
 *
 * Written after every single decision, not once at the end: a long backfill
 * that gets interrupted must not lose the record of what it already posted.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function statePath() {
  return process.env.MWK_COMMENT_STATE ||
    path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
      'mwk-social', 'first-comments.json');
}

function load() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return {}; }
}

function save(state) {
  const p = statePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
}

const key = (platform, postId) => `${platform}:${postId}`;

/**
 * Record that a post is deliberately to be left uncommented.
 *
 * @param {Array<{platform: string, postId: string, url?: string}>} posts
 * @param {string} note  why — it ends up in the file for whoever reads it later
 * @returns {number} how many entries were added (an existing one is left alone:
 *   a post the watcher has already commented on must not be rewritten to look
 *   as though it never was)
 */
function suppress(posts, note = 'first comment switched off for this post') {
  const state = load();
  let added = 0;
  for (const p of posts) {
    if (!p || !p.platform || !p.postId) continue;
    const k = key(p.platform, p.postId);
    if (state[k]) continue;
    state[k] = { commentedAt: null, note, url: p.url || null };
    added++;
  }
  if (added) save(state);
  return added;
}

/*
 * WHERE A POST POINTS, FOR THE WATCHER'S BENEFIT.
 *
 * The publisher knows a queue item's destination; the watcher only ever sees a
 * published post, so it cannot look one up. Without this it renders the SHOW
 * under a post that is about a project — and on Threads, which has no native
 * first comment, the watcher is the ONLY path, so that was every Threads
 * comment on a `--link` post (found in review 2026-09-22, hours after the
 * destination feature shipped).
 *
 * `__links` rather than the post's own entry, deliberately: an entry under the
 * post key means "already dealt with", so writing the destination there would
 * make the watcher skip the post entirely. The `__` prefix is the same
 * namespace `__lastVariant` and `__failing` already use.
 */
function recordLinks(posts, url) {
  if (!url) return 0;
  const state = load();
  const links = state.__links || {};
  let added = 0;
  for (const p of posts) {
    if (!p || !p.platform || !p.postId) continue;
    const k = key(p.platform, p.postId);
    if (links[k]) continue;
    links[k] = url;
    added++;
  }
  if (added) { state.__links = links; save(state); }
  return added;
}

/** The destination recorded for this post, or null for the show. */
const linkFor = (state, k) => (state && state.__links && state.__links[k]) || null;

module.exports = { statePath, load, save, suppress, recordLinks, linkFor, key };
