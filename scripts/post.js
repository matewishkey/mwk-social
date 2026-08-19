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
 *   --no-first-comment   publish without the CTA comment
 *   --draft              save as a draft (Zernio skips firstComment on drafts)
 *   --schedule <ISO>     schedule instead of publishing now
 *   --no-wait            don't poll for per-platform results
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'node_modules', '.bin', 'zernio');
const TEMPLATE = path.join(REPO, 'first-comment.txt');

// Platforms whose platformSpecificData accepts firstComment (docs.zernio.com
// platform guides). TikTok has no such field.
const FIRST_COMMENT_PLATFORMS = new Set(['facebook', 'instagram', 'linkedin', 'youtube']);

const VIDEO_RE = /\.(mp4|mov|avi|webm|m4v)$/i;

// On every post, same as the watcher's comments. Topic tags are not derived here
// yet — the clip would have to be transcribed before publishing (see repo issues).
const IDENTITY_TAG = '#PromptItYourself';

// first-comment.js keys its duplicate guard off this string. A template that
// lost it would have the watcher comment again on top of the native one.
const MARKER = 'matewishkey.com/show';

function parseArgs(argv) {
  const opts = { text: null, accounts: null, all: false, media: [], title: null,
    firstComment: true, draft: false, schedule: null, wait: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--text') opts.text = argv[++i];
    else if (a === '--accounts') opts.accounts = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--all') opts.all = true;
    else if (a === '--media') opts.media = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--title') opts.title = argv[++i];
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
  console.log('               [--title TEXT] [--no-first-comment] [--draft] [--schedule ISO]');
  console.log('               [--no-wait] [--dry-run]');
}

function zernio(args) {
  let out;
  try {
    // stderr is piped, not inherited: the CLI echoes its JSON error bodies there
    // and they would otherwise litter the journal alongside our own log lines.
    out = execFileSync(CLI, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    out = (err.stdout || '').toString();
    if (!out.trim()) throw new Error(`zernio ${args[0]} failed: ${err.message}`);
  }
  const json = JSON.parse(out);
  if (json && json.error) throw new Error(`zernio ${args[0]}: ${json.message || 'error'}`);
  return json;
}

function apiKey() {
  if (process.env.ZERNIO_API_KEY) return process.env.ZERNIO_API_KEY;
  const cfg = path.join(process.env.HOME, '.zernio', 'config.json');
  const key = JSON.parse(fs.readFileSync(cfg, 'utf8')).apiKey;
  if (!key) throw new Error(`no apiKey in ${cfg} and no ZERNIO_API_KEY set`);
  return key;
}

const apiBase = () => (process.env.ZERNIO_API_URL || 'https://zernio.com/api').replace(/\/$/, '');

async function api(method, endpoint, body) {
  const res = await fetch(`${apiBase()}/v1${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${method} ${endpoint} → ${res.status}: ${text.slice(0, 300)}`); }
  if (!res.ok) throw new Error(`${method} ${endpoint} → ${res.status}: ${json.message || text.slice(0, 300)}`);
  return json;
}

function resolveAccounts(opts) {
  const all = zernio(['accounts:list']).accounts || [];
  if (opts.all) {
    const active = all.filter((a) => a.isActive !== false);
    if (!active.length) throw new Error('accounts:list returned no active accounts');
    return active.map((a) => ({ id: a._id || a.id, platform: a.platform }));
  }
  return opts.accounts.map((id) => {
    const account = all.find((a) => (a._id || a.id) === id);
    if (!account) throw new Error(`account ${id} not found — run: zernio accounts:list`);
    return { id, platform: account.platform };
  });
}

function resolveMedia(items) {
  return items.map((item) => {
    const url = /^https?:\/\//.test(item) ? item : zernio(['media:upload', item]).url;
    if (!url) throw new Error(`media:upload returned no url for ${item}`);
    return { type: VIDEO_RE.test(url.split('?')[0]) ? 'video' : 'image', url };
  });
}

function template() {
  const text = fs.readFileSync(TEMPLATE, 'utf8').trim();
  if (!text) throw new Error(`${TEMPLATE} is empty`);
  if (!text.includes(MARKER)) throw new Error(`${TEMPLATE} must contain ${MARKER} — the dedupe guard keys off it`);
  return `${text}\n\n${IDENTITY_TAG}`;
}

async function waitForResults(postId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const { post } = await api('GET', `/posts/${postId}`);
    const platforms = post.platforms || [];
    const settled = platforms.every((p) => p.status === 'published' || p.status === 'failed');
    if (settled || attempt === 19) return platforms;
  }
  return [];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const accounts = resolveAccounts(opts);
  const message = opts.firstComment ? template() : null;

  const body = { content: opts.text };
  const media = resolveMedia(opts.media);
  if (media.length) body.mediaItems = media;
  if (opts.title) body.title = opts.title;
  body.platforms = accounts.map((a) => {
    const entry = { platform: a.platform, accountId: a.id };
    if (message && FIRST_COMMENT_PLATFORMS.has(a.platform)) {
      entry.platformSpecificData = { firstComment: message };
    }
    return entry;
  });
  if (opts.draft) body.isDraft = true;
  else if (opts.schedule) body.scheduledFor = opts.schedule;
  else body.publishNow = true;

  const noComment = accounts.filter((a) => message && !FIRST_COMMENT_PLATFORMS.has(a.platform));
  if (noComment.length) {
    console.log(`note: ${noComment.map((a) => a.platform).join(', ')} take no firstComment — first-comment.js picks those up later`);
  }

  if (opts.dryRun) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const { post } = await api('POST', '/posts', body);
  console.log(`post ${post._id} — ${post.status}`);
  if (!opts.wait || opts.draft || opts.schedule) return;

  for (const p of await waitForResults(post._id)) {
    const where = p.platformPostUrl || p.errorMessage || '';
    console.log(`  ${p.platform.padEnd(10)} ${p.status.padEnd(10)} ${where}`);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
