/*
 * The one alert path, and until 2026-09-14 there was none.
 *
 * The product review measured it: 6,895 timer runs in a week, two failures,
 * zero errors — and nothing that would tell anybody if the box went off, a
 * Facebook token expired, or the queue quietly stopped. The only hook in the
 * code was a Healthchecks URL read by first-comment.js from a variable set
 * nowhere. The playbook's own line from 2026-08-21 — "alert on it; do not
 * architect around it" — was never built.
 *
 * Healthchecks.io dead-man checks, three of them, pinged from the jobs that
 * already run:
 *   MWK_HC_HEARTBEAT_URL  ship-events, every 2 min   — the box is alive
 *   MWK_HC_POSTED_URL     run-queue, on a live post   — something went out today
 *   MWK_HC_ACCOUNTS_URL   ship-stats, hourly           — every account can post
 * Silence, or a /fail, emails him. The URLs live in td-sops
 * apps/mwk-social.enc.env, so systemd gets them through with-secrets.sh like
 * everything else. An unset URL is a no-op: a job must never fail because the
 * alerting did. Ten-second curl, never awaited on for correctness.
 */
'use strict';

const { execFileSync } = require('child_process');

const URLS = {
  heartbeat: 'MWK_HC_HEARTBEAT_URL',
  posted: 'MWK_HC_POSTED_URL',
  accounts: 'MWK_HC_ACCOUNTS_URL',
};

/**
 * @param {'heartbeat'|'posted'|'accounts'} check
 * @param {{ ok?: boolean, message?: string }} [opts]  ok:false pings /fail; the
 *   message (a few hundred bytes at most) becomes the check's log line.
 * @returns {boolean} whether a ping was attempted at all
 */
function ping(check, { ok = true, message = '' } = {}) {
  const url = process.env[URLS[check]];
  if (!url) return false;
  try {
    execFileSync('curl', ['-fsS', '-m', '10', '-o', '/dev/null', '--data-raw', String(message).slice(0, 2000),
      ok ? url : `${url}/fail`], { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch { /* the ping is never the reason a job fails */ }
  return true;
}

module.exports = { ping, URLS };
