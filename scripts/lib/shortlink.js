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

/*
 * MWKSHOW.COM IS THE SHOW'S ADDRESS AND NOTHING ELSE'S (mate, 2026-09-22:
 * "for these we can use always the original page with a link instead of the
 * show... the mwkshow.com is really just the show, otherwise use full link").
 *
 * Every url we published used to be swapped for a mwkshow.com code, so the
 * first Dial Countdown post sent people to `mwkshow.com/dial` for a Stream
 * Deck plugin and would have sent them to `mwkshow.com/<code>` for Elgato's
 * marketplace. A domain named after the show standing in for somebody else's
 * page is a worse link than the real one: a reader cannot tell where it goes,
 * and the show's own name is doing the vouching.
 *
 * So a code is minted for the SHOW and for nothing else, and every other
 * destination is published as its own full url. The cost is real and it is
 * his call: a project link is no longer counted. `/links` on the dashboard
 * still mints by hand for anything, for the day a number is worth more than
 * the clarity.
 */
function isShowLink(url) {
  const show = voice.config().links.show;
  const u = String(url || '');
  // The page itself, or anything under it. A prefix test alone would let
  // matewishkey.com/shortcuts through on a config where show is /show.
  return u === show || u === `${show}/`
    || u.startsWith(`${show}/`) || u.startsWith(`${show}?`) || u.startsWith(`${show}#`);
}

/*
 * THE COURSE IS THE SECOND THING WE TRACK (mate, 2026-09-23: "we have two
 * different pages to track"). A url on the course site is minted too, and the
 * worker prints it on piy.show (web/src/links.js hostFor). Everything that is
 * neither the show nor the course still goes out whole.
 */
/*
 * A PROMPT PAGE — promptityourself.com/prompts/<slug>, one per PIY short
 * (mate, 2026-09-24). It gets a NUMBER, not a random code: piy.show/007 is
 * burned into the video and typed off the screen, so it is one number for the
 * page wherever it is printed (web/src/api.js, `numbered`).
 */
function isPromptLink(url) {
  if (!isCourseLink(url)) return false;
  try { return new URL(url).pathname.startsWith('/prompts/'); } catch { return false; }
}

function isCourseLink(url) {
  const course = voice.config().links.course;
  if (!course) return false;
  try { return new URL(url).origin === new URL(course).origin; } catch { return false; }
}

/**
 * A post's own destination as it should be published: a course page becomes a
 * piy.show code, anything else stays exactly as he wrote it. Never fatal — a
 * failed mint publishes the full url.
 */
async function destination(link, where = {}) {
  if (!link || !isCourseLink(link)) return link;
  return (await mint({ ...where, target: link, numbered: isPromptLink(link) })) || link;
}

/**
 * @param {string} [opts.clipId] the QUEUE ITEM id. It is what makes a click
 *   answerable back to a video: queue_item carries the media_key, so
 *   click -> link.clip_id -> queue_item.media_key is the whole chain. It was
 *   never set until 2026-08-22 and the only way back was a LIKE on the
 *   post_key prefix, which worked for 14 links out of 55.
 * @param {string} [opts.medium] where the link was placed — caption, comment,
 *   reply or profile. Part of the mint key, so the same clip linked from a
 *   caption and from a comment are two codes and two numbers.
 * @param {string} [opts.target] where the link should go. Defaults to the
 *   sign-up page, but ANY url we post can be tracked — a repo, an episode —
 *   and the far end keys on (target, platform, clip, post) so each gets its own
 *   code without colliding with the CTA's.
 * @param {string} [opts.codePrefix] ask for a SHORT sequential code (s1, s2 ...)
 *   rather than five random characters. For a place where the link cannot be
 *   clicked and can only be typed — under a YouTube Short, chiefly.
 * @param {string} [opts.postUrl] the post's own url on the platform. Only the
 *   clip lookup reads it, and only for Facebook, where a video carries a
 *   different id depending on which Zernio surface found it — see
 *   `resolveClipId()` in `web/src/api.js`. Nothing else should key on it.
 * @returns {Promise<string|null>} the short URL, or null to use the plain one.
 */
async function mint({ platform = null, clipId = null, postKey = null, label = null,
  campaign = null, medium = null, target: wanted = null, codePrefix = null,
  postUrl = null, numbered = false, number = null } = {}) {
  const cfg = voice.shortLink();
  if (!cfg.enabled) return null;

  const base = process.env.MWK_LOG_URL;
  const token = process.env.MWK_LOG_TOKEN;
  if (!base || !token) return null;

  const target = wanted || voice.config().links.show;
  // The show, or no code at all — see isShowLink() above. Returning null is
  // the same answer an unreachable dashboard gives, and every caller already
  // handles it by publishing the plain url, which is exactly what is wanted.
  if (!isShowLink(target) && !isCourseLink(target)) return null;
  try {
    const res = await fetch(`${new URL(base).origin}/links`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, platform, clipId, postKey, label, campaign, medium,
        codePrefix, postUrl, numbered, number, createdBy: 'pipeline' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.ok ? json.url : null;
  } catch {
    return null;                 // deliberately silent — see rule 2 above
  }
}


const host = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };

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
async function trackLinks(text, { platform = null, postKey = null, clipId = null,
  campaign = null, medium = null } = {}) {
  const body = String(text || '');
  const urls = [...new Set(body.match(URL_RE) || [])];
  if (!urls.length) return body;

  let out = body;
  /*
   * Longest first. `out.split(url).join(short)` is a plain substring swap, so
   * with both matewishkey.com/show and matewishkey.com/show/faq in one comment,
   * replacing the shorter one first turns the longer into mwkshow.com/abcde/faq
   * — a code with a path glued on, pointing nowhere. Only the queue form's
   * custom-comment field can put two such urls in one body, which is why this
   * had never been seen; it is one sort to make it unreachable.
   */
  for (const url of [...urls].sort((a, b) => b.length - a.length)) {
    // Skip a link that is ALREADY shortened — a code pointing at a code — and
    // anything that is not the show, which mint() would refuse anyway. The
    // second test is the 2026-09-22 rule and it is what leaves a project page,
    // a marketplace listing or a repo in a custom comment written out in full.
    if (voice.isOurLinkHost(host(url))) continue;
    if (!isShowLink(url) && !isCourseLink(url)) continue;
    const short = await mint({ platform, postKey, clipId, campaign, medium,
      target: url, label: url.slice(0, 120) });
    if (short) out = out.split(url).join(short);
  }
  return out;
}

module.exports = { mint, trackLinks, isShowLink, isCourseLink, isPromptLink, destination, URL_RE };
