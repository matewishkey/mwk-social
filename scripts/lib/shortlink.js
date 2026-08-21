/*
 * Minting the CTA link for one post.
 *
 * The whole point is measurement: `clicks` is populated by Facebook and, once,
 * by LinkedIn — Instagram, YouTube, TikTok, Threads and X report zero on every
 * post, structurally. So without this the first-comment mechanic, which is the
 * entire links-out-of-body strategy, has no scoreboard at all.
 *
 * Two rules, both load-bearing:
 *
 *   1. IDEMPOTENT. A re-run must render the identical comment, because the
 *      duplicate guard works by looking for the CTA in the text. The far end
 *      keys on (target, platform, clip), so asking twice returns one code.
 *   2. NEVER FATAL. If the dashboard is unreachable the plain URL is used and
 *      the comment still goes out. A link we cannot measure beats a comment
 *      that never happened — the same rule the RSS feed already follows.
 */
'use strict';

const net = require('net');

// No IPv6 route here and the ingest hostname resolves AAAA-first.
net.setDefaultAutoSelectFamilyAttemptTimeout(1000);

const voice = require('./voice');

/**
 * @param {string} [opts.target] where the link should go. Defaults to the
 *   sign-up page, but ANY url we post can be tracked — a repo, an episode —
 *   and the far end keys on (target, platform, clip, post) so each gets its own
 *   code without colliding with the CTA's.
 * @returns {Promise<string|null>} the short URL, or null to use the plain one.
 */
async function mint({ platform = null, clipId = null, postKey = null, label = null,
  target: wanted = null } = {}) {
  const cfg = voice.shortLink();
  if (!cfg.enabled) return null;

  const base = process.env.MWK_LOG_URL;
  const token = process.env.MWK_LOG_TOKEN;
  if (!base || !token) return null;

  const target = wanted || voice.config().links.show;
  try {
    const res = await fetch(`${new URL(base).origin}/links`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, platform, clipId, postKey, label }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.ok ? json.url : null;
  } catch {
    return null;                 // deliberately silent — see rule 2 above
  }
}


// Bare http(s) urls. Trailing punctuation is excluded so a link at the end of a
// sentence does not swallow the full stop.
const URL_RE = /https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g;

/**
 * Replace every url in a piece of text with a tracked short link.
 *
 * Applied to whatever we are about to post, so "which link earned this click"
 * is answerable for every link we publish, not only the call to action. Fails
 * open per url: one that cannot be minted is left exactly as written rather
 * than costing the post.
 */
async function trackLinks(text, { platform = null, postKey = null, clipId = null } = {}) {
  const body = String(text || '');
  const urls = [...new Set(body.match(URL_RE) || [])];
  if (!urls.length) return body;

  let out = body;
  for (const url of urls) {
    // Already one of ours — minting a code that points at a code would be silly.
    if (voice.carriesCta(url)) continue;
    const short = await mint({ platform, postKey, clipId, target: url, label: url.slice(0, 120) });
    if (short) out = out.split(url).join(short);
  }
  return out;
}

module.exports = { mint, trackLinks, URL_RE };
