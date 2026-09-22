/*
 * THE ONE CLIENT FOR THE DASHBOARD WORKER.
 *
 * Five scripts talked to it, and four of them carried a byte-identical copy of
 * the same fetch — same headers, same 30 s timeout, same error line — plus the
 * same env check and the same IPv6 workaround, each pasted in. That is not a
 * pattern, it is one function written five times, and the day the token
 * header or the timeout changes it would change in four places and be missed
 * in the fifth.
 *
 * `endpoint()` throws when the env is missing, because every caller here is a
 * job that cannot do its work without it. The one exception, `shortlink.js`,
 * has to FAIL OPEN — a dashboard that is down must not cost a post its comment
 * — so it keeps its own silent fetch on purpose and is not a caller of this.
 *
 * `MWK_LOG_URL` carries a path (`/events`, the ingest route), which is why
 * every route is resolved against its ORIGIN rather than appended to it.
 *
 * The `net` line: no IPv6 route on this box and the dashboard hostnames
 * resolve AAAA-first, so undici's 250 ms Happy Eyeballs window expired before
 * it fell back to IPv4 and every call looked like a dead host. Set once, here,
 * where the fetch is — a caller that forgets it gets it anyway.
 */
'use strict';

const net = require('net');

net.setDefaultAutoSelectFamilyAttemptTimeout(1000);

const TIMEOUT_MS = 30000;

/** @returns {{ origin: string, token: string, url: string }} or throws naming what is missing. */
function endpoint() {
  const url = process.env.MWK_LOG_URL;
  const token = process.env.MWK_LOG_TOKEN;
  if (!url || !token) throw new Error('MWK_LOG_URL and MWK_LOG_TOKEN must be set (td-sops apps/mwk-social.enc.env)');
  return { origin: new URL(url).origin, token, url };
}

/**
 * POST one JSON body to a Worker route and hand back the parsed reply.
 *
 * @param {string} route `/queue/claim`, `/youtube/pending` … or a full url.
 * @param {object} body
 * @param {{ parse?: boolean }} [opts] `parse: false` returns the raw text, for
 *   a caller that only prints the reply.
 */
async function call(route, body = {}, opts = {}) {
  const { origin, token } = endpoint();
  const target = /^https?:\/\//.test(route) ? route : `${origin}${route}`;
  const res = await fetch(target, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${route} → ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return opts.parse === false ? text : JSON.parse(text);
}

module.exports = { endpoint, call, TIMEOUT_MS };
