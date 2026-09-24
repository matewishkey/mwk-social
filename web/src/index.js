/*
 * mwk-social: one Worker, two hostnames, three kinds of traffic.
 *
 *   social.matewishkey.com   the dashboard, behind Cloudflare Access
 *   ingest.matewishkey.com   the box: events, metrics, the queue  (bearer token)
 *   <link host>/<code>       public short links for the sign-up CTA
 *
 * Short links live on their OWN hostname, and they have to. Access covers a
 * hostname and runs in front of the Worker, so a public path on the dashboard
 * host is not possible: /l/<code> there 302s to the login page before this
 * code ever sees it (measured, not assumed). The link host is therefore a
 * separate route with no Access application on it.
 *
 * The dashboard additionally verifies the Access assertion ITSELF — signature,
 * audience and expiry — so it stays shut even if the Access application is
 * detached or misconfigured.
 *
 * `workers_dev = false` in wrangler.toml remains load-bearing for the same
 * reason it always was: Access binds to a hostname, not to a script.
 */

import { accessIdentity, tokenOk } from './lib/access.js';
import { pageOf } from './lib/html.js';
import { counted, automated } from './lib/clicks.js';
import { api } from './api.js';
import { redirect, platformFromReferer, courseSql, courseOrigin, hostFor } from './links.js';
import { overviewPage, overviewAction } from './pages/overview.js';
import { statsPage, withoutOwnActions } from './pages/stats.js';
import { weekly, weekBlocks } from './lib/weekly.js';
import { configPage } from './pages/config.js';
import { queuePage, queueAction } from './pages/queue.js';
import { linksPage, linksAction } from './pages/links.js';

const EVENT_PAGE = 100;
const HISTORY_PAGE = 25;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.hostname === env.INGEST_HOST) return await ingestHost(request, env, url);
      if (isLinkHost(env, url.hostname)) return await redirect(request, env, url, ctx);
      return await dashboard(request, env, url);
    } catch (err) {
      return new Response(`error: ${err.message}`, { status: 500 });
    }
  },
};

// LINK_HOST is what new codes are printed as; LINK_ALIASES are the retired
// hosts, still served because a code printed under one lives on in a comment.
export function isLinkHost(env, hostname) {
  const hosts = [env.LINK_HOST, ...String(env.LINK_ALIASES || '').split(',')]
    .map((h) => (h || '').trim().toLowerCase()).filter(Boolean);
  return hosts.includes(String(hostname || '').toLowerCase());
}

async function ingestHost(request, env, url) {
  // The box fetches back media it queued, with the same bearer token the rest
  // of the API uses. Kept here rather than in api.js because it is a GET.
  if (request.method === 'GET' && url.pathname.startsWith('/media/')) {
    // tokenOk(), not !==. Same door as every other ingest route, and this was
    // the one spelling of the check that compared in variable time.
    const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!tokenOk(bearer, env.INGEST_TOKEN)) return new Response('unauthorized', { status: 401 });
    if (!env.MEDIA) return new Response('no media store', { status: 404 });
    const object = await env.MEDIA.get(decodeURIComponent(url.pathname.slice('/media/'.length)));
    if (!object) return new Response('not found', { status: 404 });
    return new Response(object.body, {
      headers: { 'content-type': object.httpMetadata?.contentType || 'application/octet-stream' },
    });
  }
  return api(request, env, url);
}

/* ------------------------------------------------------------- dashboard -- */

async function dashboard(request, env, url) {
  const email = await accessIdentity(request, env);
  if (!email) {
    return new Response('This page is behind Cloudflare Access and no valid assertion arrived.',
      { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (url.pathname === '/health') return Response.json({ ok: true, email });

  // The same R2 object the box pulls with a bearer token, served to HIM behind
  // Access instead. Without this the queue page could only say "has media" — it
  // could not show him WHICH clip is about to go out, which is the one thing he
  // would want to check before it does.
  if (url.pathname.startsWith('/media/')) {
    if (!env.MEDIA) return new Response('no media store', { status: 404 });
    const object = await env.MEDIA.get(decodeURIComponent(url.pathname.slice('/media/'.length)));
    if (!object) return new Response('not found', { status: 404 });
    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
        'cache-control': 'private, max-age=3600',
      },
    });
  }

  const tz = env.TZ_DISPLAY || 'UTC';

  if (request.method === 'POST') {
    if (url.pathname === '/queue')   return queueAction(request, env, email);
    if (url.pathname === '/links')   return linksAction(request, env, email);
    if (url.pathname === '/')        return overviewAction(request, env, email);
    return new Response('not found', { status: 404 });
  }

  const snapshots = await loadSnapshots(env);

  switch (url.pathname) {
    case '/stats':   return html(await stats(env, tz, snapshots, email));
    case '/config':  return html(configPage({ email, tz, snapshots }));
    case '/queue':   return html(await queue(env, tz, snapshots, email, url));
    case '/links':   return html(await links(env, tz, email, url));
    case '/':        return html(await overview(request, env, tz, snapshots, email, url));
    default:         return new Response('not found', { status: 404 });
  }
}

const html = (markup) => new Response(markup, {
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
});

async function loadSnapshots(env) {
  const rows = await env.DB.prepare('SELECT name, body, updated_at FROM snapshot').all();
  const out = {};
  for (const row of rows.results || []) {
    try { out[row.name] = { body: JSON.parse(row.body), updatedAt: row.updated_at }; } catch { /* ignore */ }
  }
  return out;
}

async function overview(request, env, tz, snapshots, email, url) {
  const kind = url.searchParams.get('kind') || '';
  const level = url.searchParams.get('level') || '';
  // The count is taken under the SAME filter as the rows. Counting the whole
  // table would page an unfiltered total over a filtered list and offer pages
  // that come back empty.
  const [beat, counts, actions, queue, total] = await Promise.all([
    env.DB.prepare('SELECT at, count FROM ingest_batch ORDER BY at DESC LIMIT 1').first(),
    env.DB.prepare('SELECT kind, COUNT(*) n FROM event GROUP BY kind ORDER BY n DESC').all(),
    env.DB.prepare('SELECT * FROM manual_action WHERE done_at IS NULL ORDER BY created_at DESC LIMIT 50').all(),
    env.DB.prepare(
      `SELECT SUM(status IN ('queued','claimed')) waiting, SUM(status = 'failed') failed FROM queue_item`).first(),
    env.DB.prepare(
      `SELECT COUNT(*) n FROM event WHERE (?1 = '' OR kind = ?1) AND (?2 = '' OR level = ?2)`)
      .bind(kind, level).first(),
  ]);
  const rows = (total && total.n) || 0;
  const page = pageOf(url, EVENT_PAGE, rows);
  const events = await env.DB.prepare(
    `SELECT * FROM event WHERE (?1 = '' OR kind = ?1) AND (?2 = '' OR level = ?2)
      ORDER BY ts DESC LIMIT ?3 OFFSET ?4`)
    .bind(kind, level, EVENT_PAGE, (page - 1) * EVENT_PAGE).all();

  return overviewPage({ email, tz, beat, snapshots, events: events.results || [],
    counts: counts.results || [], kind, level, actions: actions.results || [],
    page, size: EVENT_PAGE, total: rows, params: url.searchParams,
    queue: { waiting: (queue && queue.waiting) || 0, failed: (queue && queue.failed) || 0 } });
}

// Exported for test/stats-sql.test.js, which runs these queries against a real
// SQLite built from schema.sql rather than reading their text.
export async function stats(env, tz, snapshots, email) {
  /*
   * The stats page (design 07) is drawn from WEEKS (lib/weekly.js): eight
   * blocks of seven days ending yesterday, each against the four before it.
   * These queries fetch only what those weeks need, plus the 30-day link
   * tables. Everything is counted people (lib/clicks.js).
   *
   * THE KIND OF A CLICK decides which series it joins, and they are never
   * added together:
   *   booking   a press on one of the booking buttons on his own site
   *   sitelink  the one link each way between his two sites
   *   website   any other code on his site (not social, not counted here)
   *   course    a code whose TARGET is on the course site (courseSql)
   *   show      everything else: somebody leaving a post
   * A show click whose code carries no platform (minted before codes were per
   * platform) is attributed by its referer, and only then left unattributed.
   */
  const today = new Date().toISOString().slice(0, 10);
  const weeks = weekBlocks(today);
  const from = weeks[0].from;
  const month = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const COURSE = courseSql(env);
  const [daily, clicks, followersNow, followerHistory, platformSince, accountSince, course, postClicks, siteLinks] = await Promise.all([
    env.DB.prepare('SELECT * FROM daily_metric WHERE date >= ? ORDER BY date').bind(from).all(),
    env.DB.prepare(
      `SELECT substr(c.at, 1, 10) day, l.platform, c.referer_host,
              CASE WHEN l.platform = 'website' AND l.campaign = 'book' THEN 'booking'
                   WHEN l.campaign = 'site-link' THEN 'sitelink'
                   WHEN l.platform = 'website' THEN 'website'
                   WHEN ${COURSE} THEN 'course' ELSE 'show' END kind
         FROM click c JOIN link l ON l.code = c.code
        WHERE c.at >= ? AND ${counted('c')}`).bind(from).all(),
    // The newest point per account, which is what "followers today" means.
    env.DB.prepare(
      `SELECT f.* FROM follower_point f
        JOIN (SELECT account_id, MAX(day) d FROM follower_point GROUP BY account_id) m
          ON m.account_id = f.account_id AND m.d = f.day`).all(),
    // A week before the first block too: a week's end reads the last point at or before it.
    env.DB.prepare('SELECT day, account_id, platform, username, followers FROM follower_point WHERE day >= ? ORDER BY day')
      .bind(new Date(Date.parse(`${from}T00:00:00Z`) - 7 * 86400_000).toISOString().slice(0, 10)).all(),
    // Over the WHOLE table, not the window: a platform older than the page
    // must not be called new because the page happens to start here.
    env.DB.prepare('SELECT platform, MIN(date) first FROM daily_metric GROUP BY platform').all(),
    env.DB.prepare('SELECT account_id, MIN(day) first FROM follower_point GROUP BY account_id').all(),
    // The course, by the ending on the url: piy.show/otd/instagram says the Instagram profile sent them.
    env.DB.prepare(
      `SELECT l.code, COALESCE(c.tag, '') tag, COUNT(*) all_time,
              SUM(CASE WHEN c.at >= ?1 THEN 1 ELSE 0 END) recent
         FROM click c JOIN link l ON l.code = c.code
        WHERE ${COURSE} AND l.campaign IS NOT 'site-link' AND ${counted('c')}
        GROUP BY l.code, tag ORDER BY all_time DESC`).bind(month).all(),
    // Clicks per POST: a code minted for a queue item carries its id as clip_id.
    env.DB.prepare(
      `SELECT q.body, SUM(CASE WHEN ${COURSE} THEN 0 ELSE 1 END) show,
              SUM(CASE WHEN ${COURSE} THEN 1 ELSE 0 END) course
         FROM click c JOIN link l ON l.code = c.code JOIN queue_item q ON q.id = l.clip_id
        WHERE ${counted('c')} AND q.status = 'posted' AND q.created_at >= ?
        GROUP BY q.id`).bind(month).all(),
    // BETWEEN THE TWO SITES (mate, 2026-09-24): one code each way, campaign 'site-link'.
    env.DB.prepare(
      `SELECT l.code, l.target, l.note, COUNT(c.id) all_time,
              SUM(CASE WHEN c.at >= ?1 THEN 1 ELSE 0 END) recent
         FROM link l LEFT JOIN click c ON c.code = l.code AND ${counted('c')}
        WHERE l.campaign = 'site-link' GROUP BY l.code ORDER BY l.code`).bind(month).all(),
  ]);
  const clickRows = (clicks.results || []).map((r) => ({ day: r.day, kind: r.kind,
    platform: r.platform || platformFromReferer(r.referer_host) || null }));
  const w = weekly({ today, daily: withoutOwnActions(daily.results || []), clicks: clickRows,
    followers: followerHistory.results || [],
    sites: (snapshots.sites || {}).body || null, search: (snapshots.search || {}).body || null,
    platformSince: Object.fromEntries((platformSince.results || []).map((r) => [r.platform, r.first])) });
  return statsPage({ email, tz, snapshots, w,
    course: course.results || [], siteLinks: siteLinks.results || [],
    followersNow: followersNow.results || [], followerHistory: followerHistory.results || [],
    accountSince: Object.fromEntries((accountSince.results || []).map((r) => [r.account_id, r.first])),
    postClicks: postClicks.results || [], courseHost: env.COURSE_HOST, linkHost: env.LINK_HOST,
    courseSite: courseOrigin(env) ? new URL(courseOrigin(env)).hostname.replace(/^www\./, '') : null });
}

// What is still waiting is never paged — it is short, and it is the half he
// acts on. Only the history behind it grows without bound, so that is the half
// that gets a pager.
async function queue(env, tz, snapshots, email, url) {
  const [waiting, total] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM queue_item WHERE status IN ('queued','claimed')
        ORDER BY priority DESC, created_at`).all(),
    env.DB.prepare(
      `SELECT COUNT(*) n FROM queue_item WHERE status NOT IN ('queued','claimed')`).first(),
  ]);
  const rows = (total && total.n) || 0;
  const page = pageOf(url, HISTORY_PAGE, rows);
  const done = await env.DB.prepare(
    `SELECT * FROM queue_item WHERE status NOT IN ('queued','claimed')
      ORDER BY created_at DESC LIMIT ?1 OFFSET ?2`)
    .bind(HISTORY_PAGE, (page - 1) * HISTORY_PAGE).all();

  // The pace is the box's, shipped with the ledger — never recomputed here, or
  // the page and the publisher would eventually disagree about what today holds.
  const pace = ((snapshots.pace || {}).body) || { perDay: '—', today: '—', minGapMinutes: null, tz, nextAt: null, why: '' };
  return queuePage({ email, tz, waiting: waiting.results || [], done: done.results || [],
    pace, page, size: HISTORY_PAGE, total: rows, params: url.searchParams,
    held: url.searchParams.get('held') });
}

/*
 * The link database. Clicks are counted through lib/clicks.js — a preview
 * fetcher hits the redirect exactly like a person and half of them do not admit
 * to it, so counting every hit made every link look like a success.
 */
const LINK_PAGE = 50;

async function links(env, tz, email, url) {
  const campaign = url.searchParams.get('campaign') || '';
  const where = campaign ? 'WHERE l.campaign = ?1' : '';
  const bind = campaign ? [campaign] : [];

  const clicks = `LEFT JOIN click c ON c.code = l.code`;
  // c is LEFT JOINed, so a link with no clicks has c.code NULL: `counted`
  // evaluates NULL, the CASE falls through to 0 and the link reads zero rather
  // than dropping out of the table.
  /*
   * `human` is ALL TIME and always has been, which is the right default for a
   * link: a code minted in August that still earns a click this week is the
   * same code. `recent` is the last 30 days beside it, so "is this still
   * working" and "did this ever work" are two columns rather than one number
   * that quietly means the first and gets read as the second (mate, 2026-09-15:
   * "I need report always vs last 1 months").
   *
   * The window is computed in SQLite rather than bound, because the WHERE
   * clause here is optional and the placeholder numbering shifts under it —
   * `date('now','-30 days')` has no such problem and needs no parameter. c.at
   * is a full ISO stamp and the cut is a date, which compares correctly because
   * ISO 8601 sorts lexically.
   */
  const counts = `SUM(CASE WHEN ${counted('c')} THEN 1 ELSE 0 END) AS human,
                  SUM(CASE WHEN ${counted('c')} AND c.at >= date('now','-30 days')
                      THEN 1 ELSE 0 END) AS human_recent,
                  SUM(CASE WHEN c.code IS NOT NULL AND ${automated('c')} THEN 1 ELSE 0 END) AS crawler`;

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) n FROM link l ${where}`).bind(...bind).first();
  const total = (totalRow && totalRow.n) || 0;
  const page = pageOf(url, LINK_PAGE, total);

  const [rows, campaigns, totals, shares] = await Promise.all([
    // The join back to the video. clip_id is the queue item id, and queue_item
    // carries the media_key — so click -> link -> item -> file is one hop, not
    // a LIKE on a string prefix. The COALESCE keeps the 14 older links working:
    // they predate clip_id and only carry `queue:<id>` in post_key.
    env.DB.prepare(
      `SELECT l.*, ${counts},
              q.id AS q_id, q.media_key AS q_media, q.body AS q_body
         FROM link l ${clicks}
         LEFT JOIN queue_item q
           ON q.id = COALESCE(NULLIF(l.clip_id, ''), REPLACE(l.post_key, 'queue:', ''))
        ${where}
        GROUP BY l.code ORDER BY l.created_at DESC LIMIT ?${bind.length + 1} OFFSET ?${bind.length + 2}`,
    ).bind(...bind, LINK_PAGE, (page - 1) * LINK_PAGE).all(),
    env.DB.prepare(
      `SELECT l.campaign, COUNT(DISTINCT l.code) AS links, ${counts}
         FROM link l ${clicks} WHERE l.campaign IS NOT NULL AND l.campaign != ''
        GROUP BY l.campaign ORDER BY human DESC, links DESC`).all(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT l.code) AS links, ${counts} FROM link l ${clicks}`).first(),
    /*
     * Who he sent a link to, by hand. The tag is his own word off the end of
     * the url (mwk.show/<code>/natalie), so this is the whole answer to
     * "did the people I messaged actually open it".
     *
     * Counted clicks only, and this is the place it matters most. A messenger
     * fetches the url to build its preview the moment he sends it — and the
     * preview arrives in a wave, seconds after the send — so counting every hit
     * would show a click on every name the second it left his phone.
     */
    env.DB.prepare(
      `SELECT c.tag, COUNT(*) AS clicks, MAX(c.at) AS last_at
         FROM click c WHERE c.tag IS NOT NULL AND ${counted('c')}
        GROUP BY c.tag ORDER BY last_at DESC LIMIT 60`).all(),
  ]);

  return linksPage({
    email, tz, host: env.LINK_HOST, hostFor: (target) => hostFor(env, target),
    rows: rows.results || [],
    campaigns: campaigns.results || [],
    totals: totals || { links: 0, human: 0, crawler: 0 },
    shares: shares.results || [],
    minted: url.searchParams.get('minted'),
    err: url.searchParams.get('err'),
    campaign, page, size: LINK_PAGE, total, params: url.searchParams,
  });
}

