#!/usr/bin/env node
/*
 * Post the standard first comment on anything published that hasn't got one yet.
 *
 * Two paths put the comment out, both composing it from config/voice.json:
 *   - posts published through the pipeline carry it natively (scripts/post.js
 *     sends platformSpecificData.firstComment, Zernio posts it within seconds);
 *   - everything else — phone-app posts, live-event videos, anything created
 *     straight on the platform — is caught here, once Zernio's external-post
 *     sync notices it (~90 min).
 * The duplicate guard is what lets the two coexist: a post that already carries
 * the CTA link is left alone whichever path put it there.
 *
 * Instagram, Facebook, LinkedIn and YouTube. TikTok has no comments API.
 *
 * Usage:
 *   scripts/first-comment.js                # last 48h, posts for real
 *   scripts/first-comment.js --dry-run      # show what it would comment on
 *   scripts/first-comment.js --seed         # mark everything in window as done, comment on nothing
 *   scripts/first-comment.js --hours 12
 *   scripts/first-comment.js --all          # every post the API still lists
 *   scripts/first-comment.js --platforms linkedin,youtube
 *   scripts/first-comment.js --message "..." | MWK_FIRST_COMMENT=...
 *
 * State (which posts are done) lives outside the repo:
 *   ~/.local/state/mwk-social/first-comments.json   (MWK_COMMENT_STATE overrides)
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { topicsFor } = require('./lib/topic-tags');
const { getComments, replyToPost } = require('./lib/api');
const voice = require('./lib/voice');
const events = require('./lib/events');

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'node_modules', '.bin', 'zernio');

// Anything already carrying this string counts as "first comment done" —
// including the one Zernio itself posted at publish time. It and the wording,
// tags and caps all come from config/voice.json.
const MARKER = voice.marker();

// YouTube takes a while to auto-caption a fresh upload — hours for a long live
// stream — and a comment cannot be edited once posted. So a recent video with no
// transcript yet is left alone and retried next run; past this age it gets the
// plain CTA. Waiting costs nothing for content that captions quickly: the grace
// is only an upper bound, and the next hourly run picks it up the moment it can.
const CAPTION_GRACE_HOURS = Number(process.env.MWK_CAPTION_GRACE_HOURS || 24);

// TikTok is absent because its API exposes no comments at all, and X because
// its comment endpoints 403 on this plan — both take their link in the caption
// instead (on X that is also the cheaper way round; see CLAUDE.md).
const ALL_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'youtube', 'threads'];

function parseArgs(argv) {
  const opts = { hours: 48, all: false, dryRun: false, seed: false, noTopics: false, message: null, limit: 50, platforms: ALL_PLATFORMS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--seed') opts.seed = true;
    else if (a === '--no-topics') opts.noTopics = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--hours') opts.hours = Number(argv[++i]);
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--message') opts.message = argv[++i];   // bypasses rotation entirely
    else if (a === '--platforms') opts.platforms = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else { console.error(`unknown option: ${a}`); usage(); process.exit(2); }
  }
  if (!Number.isFinite(opts.hours) || opts.hours <= 0) { console.error('--hours must be a positive number'); process.exit(2); }
  const bad = opts.platforms.filter((p) => !ALL_PLATFORMS.includes(p));
  if (bad.length) { console.error(`unsupported platform(s): ${bad.join(', ')} (have: ${ALL_PLATFORMS.join(', ')})`); process.exit(2); }
  return opts;
}

function usage() {
  console.log('usage: first-comment.js [--dry-run] [--seed] [--all] [--hours N] [--limit N]');
  console.log('                        [--no-topics]  (skip transcription, plain CTA only)');
  console.log('                        [--platforms p1,p2] [--message TEXT]');
}

function zernio(args) {
  let out;
  try {
    // stderr is piped, not inherited: the CLI echoes its JSON error bodies there
    // and they would otherwise litter the journal alongside our own log lines.
    out = execFileSync(CLI, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    // The CLI prints its JSON error body on stdout even when it exits non-zero.
    out = (err.stdout || '').toString();
    if (!out.trim()) throw new Error(`zernio ${args[0]} failed: ${err.message}`);
  }
  let json;
  try {
    json = JSON.parse(out);
  } catch {
    throw new Error(`zernio ${args[0]} returned non-JSON: ${out.slice(0, 200)}`);
  }
  if (json && json.error) throw new Error(`zernio ${args[0]}: ${json.message || 'error'}`);
  return json;
}

function statePath() {
  return process.env.MWK_COMMENT_STATE ||
    path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
      'mwk-social', 'first-comments.json');
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return {}; }
}

// Written after every single decision, not once at the end: a long backfill
// that gets interrupted must not lose the record of what it already posted.
function saveState(state) {
  const p = statePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
}

// Stories can't be commented on and expire anyway.
const isStory = (post, pf) =>
  /\/stories\//.test(pf.platformPostUrl || post.platformPostUrl || '') ||
  (post.platformSpecificData && post.platformSpecificData.contentType === 'story');

// posts:list carries a pipeline post the moment it publishes; analytics:posts
// lags behind it but is the only place native (app / live-event) posts appear.
// Reading both is what makes this a complete net.
function sources(opts) {
  const out = [zernio(['posts:list', '--status', 'published', '--limit', String(opts.limit)])];
  for (const platform of opts.platforms) {
    out.push(zernio(['analytics:posts', '--platform', platform, '--limit', String(opts.limit)]));
  }
  return out;
}

function collectPosts(opts) {
  const seen = new Set();
  const found = [];
  const cutoff = opts.all ? 0 : Date.now() - opts.hours * 3600 * 1000;

  for (const res of sources(opts)) {
    for (const post of res.posts || []) {
      for (const pf of post.platforms || []) {
        if (!opts.platforms.includes(pf.platform)) continue;
        if (pf.status !== 'published') continue;
        if (isStory(post, pf)) continue;
        const publishedAt = Date.parse(pf.publishedAt || post.publishedAt || post.scheduledFor || '');
        if (!Number.isFinite(publishedAt) || publishedAt < cutoff) continue;
        // posts:list populates accountId into an object; analytics:posts leaves it a string.
        const accountId = typeof pf.accountId === 'object' && pf.accountId ? pf.accountId._id : pf.accountId;
        // External posts are only addressable by their native platform ID —
        // the Zernio _id 404s on every inbox: command.
        if (!pf.platformPostId || !accountId) continue;
        const key = `${pf.platform}:${pf.platformPostId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const video = (post.mediaItems || []).find((m) => m && m.type === 'video');
        found.push({
          key,
          platform: pf.platform,
          postId: pf.platformPostId,
          accountId,
          url: pf.platformPostUrl || post.platformPostUrl || '',
          content: post.content || '',
          videoUrl: (video && video.url) || null,
          isVideo: Boolean(video) || pf.platform === 'youtube',
          publishedAt: new Date(publishedAt).toISOString(),
        });
      }
    }
  }
  return found.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

// Second guard, so a lost state file can't double-comment — and so a post that
// already got the comment natively at publish time is left alone.
async function alreadyCommented(target) {
  const res = await getComments(target.postId, target.accountId);
  return (res.comments || []).some((c) => String(c.text || c.message || c.content || '').includes(MARKER));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const state = loadState();
  const stamp = new Date().toISOString();

  events.initRun({ source: 'first-comment' });
  const posts = collectPosts(opts);
  const pending = posts.filter((p) => !state[p.key]);
  console.log(`[${stamp}] ${posts.length} post(s) in window across ${opts.platforms.join(', ')}, ${pending.length} without a recorded first comment`);

  if (opts.seed) {
    for (const target of pending) {
      state[target.key] = { commentedAt: null, note: 'seeded, not commented', url: target.url };
      console.log(`seed  ${target.key} — marked done without commenting (${target.url})`);
    }
    saveState(state);
    return;
  }

  let failures = 0;
  for (const target of pending) {
    try {
      // The link is already in the caption — a comment repeating it is noise.
      if (target.content.includes(MARKER)) {
        state[target.key] = { commentedAt: null, note: 'link already in the caption', url: target.url };
        saveState(state);
        events.emit('comment.skipped', { message: 'link already in the caption', platform: target.platform,
          postKey: target.key, url: target.url, accountId: target.accountId,
          dedupeKey: `comment.skipped|${target.key}`, data: { reason: 'link-in-caption' } });
        console.log(`skip  ${target.key} — link already in the post itself (${target.url})`);
        continue;
      }

      // A 403 on the read means the platform has comments closed on this post
      // (YouTube does that for private videos) — permanent, so stop retrying it.
      let closed = false;
      let done;
      try {
        done = await alreadyCommented(target);
      } catch (err) {
        if (!/\b403\b/.test(err.message)) throw err;
        closed = true;
      }
      if (closed) {
        state[target.key] = { commentedAt: null, note: 'comments unavailable (403)', url: target.url };
        saveState(state);
        events.emit('comment.skipped', { message: 'comments closed on this post', level: 'warn',
          platform: target.platform, postKey: target.key, url: target.url, accountId: target.accountId,
          dedupeKey: `comment.skipped|${target.key}`, data: { reason: 'comments-closed-403' } });
        console.log(`skip  ${target.key} — comments closed on this post (${target.url})`);
        continue;
      }
      if (done) {
        state[target.key] = { commentedAt: null, note: 'comment already on the post', url: target.url };
        saveState(state);
        events.emit('comment.skipped', { message: 'first comment already there', platform: target.platform,
          postKey: target.key, url: target.url, accountId: target.accountId,
          dedupeKey: `comment.skipped|${target.key}`, data: { reason: 'already-commented' } });
        console.log(`skip  ${target.key} — first comment already there (${target.url})`);
        continue;
      }
      // Work out what the video was about, and tag it with that. A failure here
      // must never cost the post its comment — fall back to the plain CTA.
      let topicTags = [];
      let summary = '';
      let gotTopics = false;
      if (!opts.noTopics) {
        try {
          const topics = await topicsFor(target.key, {
            videoUrl: target.videoUrl,
            youtubeId: target.platform === 'youtube' ? target.postId : null,
          });
          if (topics) {
            topicTags = topics.tags;
            summary = topics.summary;
            gotTopics = true;
          }
        } catch (err) {
          console.error(`warn  ${target.key} — topic tags unavailable (${err.message}); posting the plain CTA`);
        }
      }

      // Nothing to transcribe yet on a fresh video — come back next run rather
      // than spend the one comment we get on an untagged one.
      const ageHours = (Date.now() - Date.parse(target.publishedAt)) / 3600000;
      if (!opts.noTopics && target.isVideo && !gotTopics && ageHours < CAPTION_GRACE_HOURS) {
        events.emit('comment.deferred', { message: 'no transcript yet', platform: target.platform,
          postKey: target.key, url: target.url, data: { ageHours: Number(ageHours.toFixed(1)) } });
        console.log(`wait  ${target.key} — no transcript yet, ${ageHours.toFixed(1)}h old, retrying next run (${target.url})`);
        continue;
      }
      // Rotated per post so no two consecutive comments read the same, and
      // sometimes quoting a real guest wish from the show's feed.
      const override = opts.message || process.env.MWK_FIRST_COMMENT;
      const composed = override
        ? { text: override, variant: 'override', index: -1 }
        : voice.firstComment(target.key, {
            platform: target.platform,
            topicTags,
            avoidIndex: state.__lastVariant?.[target.platform] ?? -1,
          });
      const body = composed.text;

      if (opts.dryRun) {
        console.log(`DRY   ${target.key} — would comment [${composed.variant}/${composed.index}] (${target.url})`);
        console.log(`      ${body.replace(/\n+/g, ' | ').slice(0, 150)}`);
        if (summary) console.log(`      about: ${summary}`);
        continue;
      }
      const res = await replyToPost(target.postId, target.accountId, body);
      state[target.key] = {
        commentedAt: new Date().toISOString(),
        commentId: (res.comment && res.comment.id) || res.commentId || null,
        variant: `${composed.variant}/${composed.index}`,
        tags: topicTags,
        url: target.url,
      };
      state.__lastVariant = { ...(state.__lastVariant || {}), [target.platform]: composed.index };
      saveState(state);
      events.emit('comment.posted', { message: `commented [${composed.variant}/${composed.index}]`,
        platform: target.platform, postKey: target.key, url: target.url, accountId: target.accountId,
        dedupeKey: `comment.posted|${target.key}`,
        data: { variant: composed.variant, index: composed.index, tags: topicTags } });
      console.log(`post  ${target.key} — commented [${composed.variant}/${composed.index}] (${target.url})`);
    } catch (err) {
      failures++;
      events.emit('comment.failed', { message: err.message, level: 'error', platform: target.platform,
        postKey: target.key, url: target.url, dedupeKey: `comment.failed|${target.key}` });
      console.error(`FAIL  ${target.key} — ${err.message}`);
    }
  }

  events.finishRun({ inWindow: posts.length, pending: pending.length, failures });

  const hc = process.env.MWK_COMMENT_HC_URL; // optional Healthchecks.io ping
  if (hc && !opts.dryRun) {
    try { execFileSync('curl', ['-fsS', '-m', '10', '-o', '/dev/null', failures ? `${hc}/fail` : hc]); } catch { /* never fail the run on the ping */ }
  }

  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
