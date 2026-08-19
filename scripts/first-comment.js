#!/usr/bin/env node
/*
 * Post the standard first comment on anything published that hasn't got one yet.
 *
 * Two paths put the same comment out, both reading first-comment.txt:
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

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'node_modules', '.bin', 'zernio');
const TEMPLATE = path.join(REPO, 'first-comment.txt');

// Anything already carrying this string counts as "first comment done" —
// including the one Zernio itself posted at publish time.
const MARKER = 'matewishkey.com/show';

// TikTok is absent on purpose: its API exposes no comments at all.
const ALL_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'youtube'];

function parseArgs(argv) {
  const opts = { hours: 48, all: false, dryRun: false, seed: false, message: null, limit: 50, platforms: ALL_PLATFORMS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--seed') opts.seed = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--hours') opts.hours = Number(argv[++i]);
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--message') opts.message = argv[++i];
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

function template() {
  const text = fs.readFileSync(TEMPLATE, 'utf8').trim();
  if (!text) throw new Error(`${TEMPLATE} is empty`);
  if (!text.includes(MARKER)) throw new Error(`${TEMPLATE} must contain ${MARKER} — the duplicate guard keys off it`);
  return text;
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
        found.push({
          key,
          platform: pf.platform,
          postId: pf.platformPostId,
          accountId,
          url: pf.platformPostUrl || post.platformPostUrl || '',
          publishedAt: new Date(publishedAt).toISOString(),
        });
      }
    }
  }
  return found.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

// Second guard, so a lost state file can't double-comment — and so a post that
// already got the comment natively at publish time is left alone.
function alreadyCommented(target) {
  const res = zernio(['inbox:post-comments', target.postId, '--accountId', target.accountId]);
  return (res.comments || []).some((c) => String(c.text || c.message || c.content || '').includes(MARKER));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const message = opts.message || process.env.MWK_FIRST_COMMENT || template();
  const state = loadState();
  const stamp = new Date().toISOString();

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
      // A 403 on the read means the platform has comments closed on this post
      // (YouTube does that for private videos) — permanent, so stop retrying it.
      let closed = false;
      let done;
      try {
        done = alreadyCommented(target);
      } catch (err) {
        if (!/\b403\b/.test(err.message)) throw err;
        closed = true;
      }
      if (closed) {
        state[target.key] = { commentedAt: null, note: 'comments unavailable (403)', url: target.url };
        saveState(state);
        console.log(`skip  ${target.key} — comments closed on this post (${target.url})`);
        continue;
      }
      if (done) {
        state[target.key] = { commentedAt: null, note: 'comment already on the post', url: target.url };
        saveState(state);
        console.log(`skip  ${target.key} — first comment already there (${target.url})`);
        continue;
      }
      if (opts.dryRun) {
        console.log(`DRY   ${target.key} — would comment (${target.url})`);
        continue;
      }
      const res = zernio(['inbox:reply', target.postId, '--accountId', target.accountId, '--message', message]);
      state[target.key] = {
        commentedAt: new Date().toISOString(),
        commentId: (res.comment && res.comment.id) || res.commentId || null,
        url: target.url,
      };
      saveState(state);
      console.log(`post  ${target.key} — commented (${target.url})`);
    } catch (err) {
      failures++;
      console.error(`FAIL  ${target.key} — ${err.message}`);
    }
  }

  const hc = process.env.MWK_COMMENT_HC_URL; // optional Healthchecks.io ping
  if (hc && !opts.dryRun) {
    try { execFileSync('curl', ['-fsS', '-m', '10', '-o', '/dev/null', failures ? `${hc}/fail` : hc]); } catch { /* never fail the run on the ping */ }
  }

  process.exit(failures ? 1 : 0);
}

main();
