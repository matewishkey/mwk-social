/*
 * Short links.
 *
 * Deliberately anonymous: a click records the code, the time, the referring
 * HOST and whether it looked automated. No IP, no user agent, no cookie, no
 * fingerprint. The question we actually have is "which channel and which clip
 * earned this", and the code already answers it — anything more would be
 * collecting personal data to learn nothing extra, and would drag consent
 * banners into a redirect.
 *
 * The User-Agent is read to DECIDE whether something counts and is then thrown
 * away. That is the whole point: platforms fetch a url to build the link
 * preview, and every fetch lands here — the first live post logged 18 "clicks"
 * on one link inside three minutes, which is crawlers, not people. Storing the
 * verdict as a flag keeps the numbers honest without keeping anything personal.
 *
 * A miss redirects to the plain sign-up page rather than 404ing. A short link
 * that has been printed in a public comment must never dead-end because a row
 * went missing.
 */

// Preview fetchers and crawlers. Matching is deliberately broad: over-counting
// a human as a bot understates a real number, which is the safer error.
const BOT_RE = new RegExp([
  'bot', 'crawler', 'spider', 'preview', 'fetcher', 'scraper', 'curl', 'wget',
  'facebookexternalhit', 'facebookcatalog', 'twitterbot', 'linkedinbot',
  'slackbot', 'slack-imgproxy', 'whatsapp', 'telegrambot', 'discordbot',
  'redditbot', 'pinterest', 'embedly', 'quora link preview', 'skypeuripreview',
  'vkshare', 'applebot', 'googlebot', 'bingbot', 'yandex', 'duckduckbot',
  'headlesschrome', 'python-requests', 'okhttp', 'go-http-client', 'axios',
  'node-fetch', 'undici', 'libwww-perl', 'java/', 'ahrefs', 'semrush',
].join('|'), 'i');

const looksAutomated = (ua) => !ua || BOT_RE.test(ua);

/*
 * Which platform a referring host belongs to. A click can be attributed two
 * ways: the code itself carries the platform it was minted for, and the referer
 * says where the click actually came from. The second is a genuine fallback,
 * because links minted before codes were per-platform have no platform at all —
 * and it also catches a link shared on somewhere we never posted it.
 */
const REFERER_PLATFORM = [
  [/(^|\.)facebook\.com$/, 'facebook'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)threads\.(net|com)$/, 'threads'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'linkedin'],
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'youtube'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(twitter|x)\.com$|^t\.co$/, 'twitter'],
];

export function platformFromReferer(host) {
  if (!host) return null;
  const h = String(host).toLowerCase();
  for (const [re, name] of REFERER_PLATFORM) if (re.test(h)) return name;
  return null;
}

/*
 * Who he sent it to, taken off the end of the url.
 *
 * mwkshow.com/<code>/<tag>. The tag is a word HE types as he sends the link —
 * "natalie", "tom", "book-club" — so one code serves everybody and there is
 * nothing to mint per person. Nothing about the visitor is read to produce it.
 *
 * Normalised hard and capped, because it arrives from a public url and anyone
 * can append anything: lowercase, [a-z0-9-] only, 24 characters. A tag that
 * normalises to nothing is simply not recorded, and the code still works —
 * a personalised link must never fail because the label was odd.
 */
const TAG_MAX = 24;
// A malformed %-sequence throws; a name is never worth a 500 on a redirect.
const decodeSafe = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
export function normaliseTag(raw) {
  // Accents folded to ASCII first, or a Hungarian name comes out as rubble:
  // "Ödön" would normalise to "d-n" and "József" to "j-zsef" without this.
  const t = String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, TAG_MAX).replace(/-+$/g, '');
  return t || null;
}

export async function redirect(request, env, url, ctx) {
  /*
   * First segment is the code, an optional second is the tag. Splitting rather
   * than taking the whole path is what makes the personal form work at all —
   * `/abcde/natalie` used to become the code "abcde/natalie", match nothing,
   * and quietly send the visitor to the fallback. It looked like it worked.
   */
  const [first, second] = url.pathname.replace(/^\/+/, '').split('/');
  const code = (first || '').toLowerCase();
  // Decoded first: url.pathname keeps percent-encoding, so "Ödön" arrives as
  // %C3%96d%C3%B6n and normalising that straight gave "c3-96d-c3-b6n". Caught by
  // testing the live redirect with a real accented name rather than an ASCII one.
  const tag = second ? normaliseTag(decodeSafe(second)) : null;
  if (!code || code === 'favicon.ico') return Response.redirect(env.LINK_FALLBACK, 302);

  const row = await env.DB.prepare('SELECT target FROM link WHERE code = ?').bind(code).first();
  // Straight through, byte for byte. The code already says which platform,
  // placement and campaign it belongs to — appending utm_ parameters would be
  // counting the same click twice, in somebody else's system, and would look
  // like more tracking than we actually do. Mate's call, 2026-08-22: keep it slim.
  const target = (row && row.target) || env.LINK_FALLBACK;

  if (row) {
    let refererHost = null;
    try { refererHost = new URL(request.headers.get('Referer') || '').hostname; } catch { /* none */ }
    // Read, decide, discard. The header never reaches the database.
    const bot = looksAutomated(request.headers.get('User-Agent')) ? 1 : 0;
    const write = env.DB.prepare('INSERT INTO click (code, at, referer_host, bot, tag) VALUES (?,?,?,?,?)')
      .bind(code, new Date().toISOString(), refererHost, bot, tag).run();
    // The redirect must not wait on the write, and must still happen if it fails.
    if (ctx && ctx.waitUntil) ctx.waitUntil(write.catch(() => {}));
    else await write.catch(() => {});
  }
  return Response.redirect(target, 302);
}
