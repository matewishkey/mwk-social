/*
 * Short links.
 *
 * Deliberately anonymous: a click records the code, the time and the referring
 * HOST, and nothing else. No IP, no user agent, no cookie, no fingerprint. The
 * question we actually have is "which channel and which clip earned this", and
 * the code already answers it — anything more would be collecting personal data
 * to learn nothing extra, and would drag consent banners into a redirect.
 *
 * A miss redirects to the plain sign-up page rather than 404ing. A short link
 * that has been printed in a public comment must never dead-end because a row
 * went missing.
 */

export async function redirect(request, env, url, ctx) {
  const code = url.pathname.replace(/^\/+/, '').toLowerCase();
  if (!code || code === 'favicon.ico') return Response.redirect(env.LINK_FALLBACK, 302);

  const row = await env.DB.prepare('SELECT target FROM link WHERE code = ?').bind(code).first();
  const target = (row && row.target) || env.LINK_FALLBACK;

  if (row) {
    let refererHost = null;
    try { refererHost = new URL(request.headers.get('Referer') || '').hostname; } catch { /* none */ }
    const write = env.DB.prepare('INSERT INTO click (code, at, referer_host) VALUES (?,?,?)')
      .bind(code, new Date().toISOString(), refererHost).run();
    // The redirect must not wait on the write, and must still happen if it fails.
    if (ctx && ctx.waitUntil) ctx.waitUntil(write.catch(() => {}));
    else await write.catch(() => {});
  }
  return Response.redirect(target, 302);
}
