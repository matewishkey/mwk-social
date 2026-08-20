/*
 * Thin Zernio REST client. Shared so the CLI's argument parsing can't get in the
 * way: a YouTube video id may legitimately start with "-", and the CLI reads any
 * such positional as a flag and prints its help instead (bitten live 2026-08-19
 * on video -Lf97N091NI).
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function apiKey() {
  if (process.env.ZERNIO_API_KEY) return process.env.ZERNIO_API_KEY;
  const cfg = path.join(process.env.HOME, '.zernio', 'config.json');
  const key = JSON.parse(fs.readFileSync(cfg, 'utf8')).apiKey;
  if (!key) throw new Error(`no apiKey in ${cfg} and no ZERNIO_API_KEY set`);
  return key;
}

const apiBase = () => (process.env.ZERNIO_API_URL || 'https://zernio.com/api').replace(/\/$/, '');

// A publish carrying video takes Zernio well past a minute, so `timeout` is a
// parameter. It is not a safety net either way: the request timing out does not
// stop the work at the other end, so a caller that POSTs must reconcile rather
// than assume failure.
async function api(method, endpoint, { body, query, timeout = 60000 } = {}) {
  const url = new URL(`${apiBase()}/v1${endpoint}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${method} ${endpoint} → ${res.status}: ${text.slice(0, 200)}`); }
  if (!res.ok || json.error) throw new Error(`${method} ${endpoint} → ${res.status}: ${json.message || 'error'}`);
  return json;
}

// Path segment, not a query value: encodeURIComponent would escape the colons in
// a LinkedIn urn:li:share:… id, which are legal here and which the API expects raw.
const seg = (id) => String(id).split('/').map((p) => encodeURIComponent(p)).join('%2F').replace(/%3A/g, ':');

const getComments = (postId, accountId) =>
  api('GET', `/inbox/comments/${seg(postId)}`, { query: { accountId } });

const replyToPost = (postId, accountId, message) =>
  api('POST', `/inbox/comments/${seg(postId)}`, { body: { accountId, message } });

// The CLI, for the read commands that have no REST equivalent worth writing out
// (posts:list, analytics:posts). stderr is piped rather than inherited: the CLI
// echoes its JSON error bodies there and they would litter the journal.
const CLI = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'zernio');

function cli(args) {
  let out;
  try {
    out = execFileSync(CLI, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    // It prints its JSON error body on stdout even when it exits non-zero.
    out = (err.stdout || '').toString();
    if (!out.trim()) throw new Error(`zernio ${args[0]} failed: ${err.message}`);
  }
  let json;
  try { json = JSON.parse(out); } catch { throw new Error(`zernio ${args[0]} returned non-JSON: ${out.slice(0, 200)}`); }
  if (json && json.error) throw new Error(`zernio ${args[0]}: ${json.message || 'error'}`);
  return json;
}

module.exports = { api, apiKey, apiBase, getComments, replyToPost, seg, cli, CLI };
