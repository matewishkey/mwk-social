#!/usr/bin/env node
/*
 * Post the standard first comment on every new reel (Instagram + Facebook).
 *
 * Reels are detected from the live post URL (`/reel/`), so it works for reels
 * posted from the phone apps as well as ones published through the pipeline —
 * the app-posted ones arrive via Zernio's external-post sync (~90 min lag).
 *
 * Usage:
 *   scripts/reel-first-comment.js               # last 48h, posts for real
 *   scripts/reel-first-comment.js --dry-run     # show what it would comment on
 *   scripts/reel-first-comment.js --hours 12
 *   scripts/reel-first-comment.js --all         # every reel the API still lists
 *   scripts/reel-first-comment.js --message "..." | MWK_REEL_COMMENT=...
 *
 * State (which reels are done) lives outside the repo:
 *   ~/.local/state/mwk-social/reel-first-comments.json   (MWK_REEL_STATE overrides)
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, '..', 'node_modules', '.bin', 'zernio');

const DEFAULT_MESSAGE = [
  "Do not let others solve your problem with AI. Prompt it Yourself!",
  "Come to the show and let's build what You wish for!",
  '',
  'https://matewishkey.com/show',
].join('\n');

// Anything already carrying this string counts as "first comment done".
const MARKER = 'matewishkey.com/show';

const PLATFORMS = ['instagram', 'facebook'];

function parseArgs(argv) {
  const opts = { hours: 48, all: false, dryRun: false, message: null, limit: 50 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--hours') opts.hours = Number(argv[++i]);
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--message') opts.message = argv[++i];
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else { console.error(`unknown option: ${a}`); usage(); process.exit(2); }
  }
  if (!Number.isFinite(opts.hours) || opts.hours <= 0) { console.error('--hours must be a positive number'); process.exit(2); }
  return opts;
}

function usage() {
  console.log('usage: reel-first-comment.js [--dry-run] [--all] [--hours N] [--limit N] [--message TEXT]');
}

function zernio(args) {
  let out;
  try {
    out = execFileSync(CLI, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
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
  return process.env.MWK_REEL_STATE ||
    path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
      'mwk-social', 'reel-first-comments.json');
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return {}; }
}

function saveState(state) {
  const p = statePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
}

const isReel = (url) => typeof url === 'string' && /\/reels?\//.test(url);

// One entry per (reel, account) — the same clip on IG and on the FB page is two comments.
function collectReels(opts) {
  const seen = new Set();
  const reels = [];
  const cutoff = opts.all ? 0 : Date.now() - opts.hours * 3600 * 1000;

  for (const platform of PLATFORMS) {
    const res = zernio(['analytics:posts', '--platform', platform, '--limit', String(opts.limit)]);
    for (const post of res.posts || []) {
      const publishedAt = Date.parse(post.publishedAt || post.scheduledFor || '');
      if (!Number.isFinite(publishedAt) || publishedAt < cutoff) continue;
      for (const pf of post.platforms || []) {
        if (pf.platform !== platform) continue;
        if (pf.status !== 'published') continue;
        if (!isReel(pf.platformPostUrl || post.platformPostUrl)) continue;
        // External posts are only addressable by their native platform ID —
        // the Zernio _id 404s on every inbox: command.
        if (!pf.platformPostId || !pf.accountId) continue;
        const key = `${platform}:${pf.platformPostId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        reels.push({
          key,
          platform,
          postId: pf.platformPostId,
          accountId: pf.accountId,
          url: pf.platformPostUrl || post.platformPostUrl,
          publishedAt: new Date(publishedAt).toISOString(),
        });
      }
    }
  }
  return reels.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

// Second guard, so a lost state file can't double-comment.
function alreadyCommented(reel) {
  const res = zernio(['inbox:post-comments', reel.postId, '--accountId', reel.accountId]);
  return (res.comments || []).some((c) => String(c.text || c.message || c.content || '').includes(MARKER));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const message = opts.message || process.env.MWK_REEL_COMMENT || DEFAULT_MESSAGE;
  const state = loadState();
  const stamp = new Date().toISOString();

  const reels = collectReels(opts);
  const pending = reels.filter((r) => !state[r.key]);
  console.log(`[${stamp}] ${reels.length} reel(s) in window, ${pending.length} without a recorded first comment`);

  let failures = 0;
  for (const reel of pending) {
    try {
      if (alreadyCommented(reel)) {
        state[reel.key] = { commentedAt: null, note: 'pre-existing comment found', url: reel.url };
        console.log(`skip  ${reel.key} — first comment already on the post (${reel.url})`);
        continue;
      }
      if (opts.dryRun) {
        console.log(`DRY   ${reel.key} — would comment (${reel.url})`);
        continue;
      }
      const res = zernio(['inbox:reply', reel.postId, '--accountId', reel.accountId, '--message', message]);
      state[reel.key] = {
        commentedAt: new Date().toISOString(),
        commentId: (res.comment && res.comment.id) || res.commentId || null,
        url: reel.url,
      };
      console.log(`post  ${reel.key} — commented (${reel.url})`);
    } catch (err) {
      failures++;
      console.error(`FAIL  ${reel.key} — ${err.message}`);
    }
  }

  if (!opts.dryRun) saveState(state);

  const hc = process.env.MWK_REEL_HC_URL; // optional Healthchecks.io ping
  if (hc && !opts.dryRun) {
    try { execFileSync('curl', ['-fsS', '-m', '10', '-o', '/dev/null', failures ? `${hc}/fail` : hc]); } catch { /* never fail the run on the ping */ }
  }

  process.exit(failures ? 1 : 0);
}

main();
