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

export async function redirect(request, env, url, ctx) {
  const code = url.pathname.replace(/^\/+/, '').toLowerCase();
  if (!code || code === 'favicon.ico') return Response.redirect(env.LINK_FALLBACK, 302);

  const row = await env.DB.prepare('SELECT target FROM link WHERE code = ?').bind(code).first();
  const target = (row && row.target) || env.LINK_FALLBACK;

  if (row) {
    let refererHost = null;
    try { refererHost = new URL(request.headers.get('Referer') || '').hostname; } catch { /* none */ }
    // Read, decide, discard. The header never reaches the database.
    const bot = looksAutomated(request.headers.get('User-Agent')) ? 1 : 0;
    const write = env.DB.prepare('INSERT INTO click (code, at, referer_host, bot) VALUES (?,?,?,?)')
      .bind(code, new Date().toISOString(), refererHost, bot).run();
    // The redirect must not wait on the write, and must still happen if it fails.
    if (ctx && ctx.waitUntil) ctx.waitUntil(write.catch(() => {}));
    else await write.catch(() => {});
  }
  return Response.redirect(target, 302);
}
