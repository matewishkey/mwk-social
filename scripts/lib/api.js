/*
 * Thin Zernio REST client. Shared so the CLI's argument parsing can't get in the
 * way: a YouTube video id may legitimately start with "-", and the CLI reads any
 * such positional as a flag and prints its help instead (bitten live 2026-08-19
 * on video -Lf97N091NI).
 */
'use strict';

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

async function api(method, endpoint, { body, query } = {}) {
  const url = new URL(`${apiBase()}/v1${endpoint}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
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

module.exports = { api, apiKey, apiBase, getComments, replyToPost, seg };
