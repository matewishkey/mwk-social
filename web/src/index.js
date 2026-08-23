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

import { accessIdentity } from './lib/access.js';
import { pageOf } from './lib/html.js';
import { api } from './api.js';
import { redirect, platformFromReferer } from './links.js';
import { overviewPage, overviewAction } from './pages/overview.js';
import { statsPage } from './pages/stats.js';
import { configPage } from './pages/config.js';
import { queuePage, queueAction } from './pages/queue.js';
import { youtubePage, youtubeAction } from './pages/youtube.js';
import { linksPage, linksAction } from './pages/links.js';

const EVENT_PAGE = 100;
const HISTORY_PAGE = 25;
const STATS_DAYS = 30;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.hostname === env.INGEST_HOST) return await ingestHost(request, env, url);
      if (env.LINK_HOST && url.hostname === env.LINK_HOST) return await redirect(request, env, url, ctx);
      return await dashboard(request, env, url);
    } catch (err) {
      return new Response(`error: ${err.message}`, { status: 500 });
    }
  },
};

async function ingestHost(request, env, url) {
  // The box fetches back media it queued, with the same bearer token the rest
  // of the API uses. Kept here rather than in api.js because it is a GET.
  if (request.method === 'GET' && url.pathname.startsWith('/media/')) {
    const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (bearer !== env.INGEST_TOKEN) return new Response('unauthorized', { status: 401 });
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
    if (url.pathname === '/youtube') return youtubeAction(request, env, email);
    if (url.pathname === '/links')   return linksAction(request, env, email);
    if (url.pathname === '/')        return overviewAction(request, env, email);
    return new Response('not found', { status: 404 });
  }

  const snapshots = await loadSnapshots(env);

  switch (url.pathname) {
    case '/stats':   return html(await stats(env, tz, snapshots, email));
    case '/config':  return html(configPage({ email, tz, snapshots }));
    case '/queue':   return html(await queue(env, tz, snapshots, email, url));
    case '/youtube': return html(await youtube(env, tz, snapshots, email, url));
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

async function stats(env, tz, snapshots, email) {
  const from = new Date(Date.now() - STATS_DAYS * 86400_000).toISOString().slice(0, 10);
  const [daily, followers, clicks, targets, split, links] = await Promise.all([
    env.DB.prepare('SELECT * FROM daily_metric WHERE date >= ? ORDER BY date').bind(from).all(),
    // The newest point per account, which is what "followers today" means.
    env.DB.prepare(
      `SELECT f.* FROM follower_point f
        JOIN (SELECT account_id, MAX(day) d FROM follower_point GROUP BY account_id) m
          ON m.account_id = f.account_id AND m.d = f.day`).all(),
    env.DB.prepare(
      // bot = 0 only: a link-preview fetch is not a click. The referer is kept
      // so a click on a code minted before codes were per-platform can still be
      // attributed by where it came from.
      `SELECT l.platform, c.referer_host, COUNT(*) n FROM click c JOIN link l ON l.code = c.code
        WHERE c.at >= ? AND c.bot = 0 GROUP BY l.platform, c.referer_host`).bind(from).all(),
    // What people actually clicked, rather than only where from.
    env.DB.prepare(
      `SELECT l.target, COUNT(*) n, COUNT(DISTINCT l.code) codes
         FROM click c JOIN link l ON l.code = c.code
        WHERE c.at >= ? AND c.bot = 0 GROUP BY l.target ORDER BY n DESC LIMIT 12`).bind(from).all(),
    // The honest denominator: how much of the traffic was not a person.
    env.DB.prepare(
      `SELECT bot, COUNT(*) n FROM click WHERE at >= ? GROUP BY bot`).bind(from).all(),
    env.DB.prepare('SELECT COUNT(*) n FROM link').first(),
  ]);
  // Fold the two attribution routes together: the code's own platform first,
  // then where the click came from, and only then give up and say unattributed.
  const byChannel = new Map();
  for (const r of clicks.results || []) {
    const name = r.platform || platformFromReferer(r.referer_host);
    const key = name || 'unattributed';
    byChannel.set(key, (byChannel.get(key) || 0) + r.n);
  }
  const folded = [...byChannel].map(([platform, n]) => ({ platform, n })).sort((a, b) => b.n - a.n);

  return statsPage({ email, tz, snapshots, days: STATS_DAYS,
    daily: daily.results || [], followers: followers.results || [], clicks: folded,
    targets: targets.results || [], split: split.results || [], links: (links && links.n) || 0 });
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
    pace, page, size: HISTORY_PAGE, total: rows, params: url.searchParams });
}

/*
 * The link database. Clicks are counted with bot = 0 only — a preview fetcher
 * hits the redirect exactly like a person, so counting both would make every
 * link look like a success.
 */
const LINK_PAGE = 50;

async function links(env, tz, email, url) {
  const campaign = url.searchParams.get('campaign') || '';
  const where = campaign ? 'WHERE l.campaign = ?1' : '';
  const bind = campaign ? [campaign] : [];

  const clicks = `LEFT JOIN click c ON c.code = l.code`;
  const counts = `SUM(CASE WHEN c.bot = 0 THEN 1 ELSE 0 END) AS human,
                  SUM(CASE WHEN c.bot = 1 THEN 1 ELSE 0 END) AS crawler`;

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) n FROM link l ${where}`).bind(...bind).first();
  const total = (totalRow && totalRow.n) || 0;
  const page = pageOf(url, LINK_PAGE, total);

  const [rows, campaigns, totals] = await Promise.all([
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
  ]);

  return linksPage({
    email, tz, host: env.LINK_HOST,
    rows: rows.results || [],
    campaigns: campaigns.results || [],
    totals: totals || { links: 0, human: 0, crawler: 0 },
    minted: url.searchParams.get('minted'),
    err: url.searchParams.get('err'),
    campaign, page, size: LINK_PAGE, total, params: url.searchParams,
  });
}

async function youtube(env, tz, snapshots, email, url) {
  // The tiles count the whole table, not the page in front of him — "written"
  // meaning "written on this page" would shrink every time he paged forward.
  const [waiting, total, states] = await Promise.all([
    env.DB.prepare(`SELECT * FROM yt_proposal WHERE state = 'proposed' ORDER BY proposed_at DESC`).all(),
    env.DB.prepare(`SELECT COUNT(*) n FROM yt_proposal WHERE state != 'proposed'`).first(),
    env.DB.prepare('SELECT state, COUNT(*) n FROM yt_proposal GROUP BY state').all(),
  ]);
  const byState = Object.fromEntries((states.results || []).map((r) => [r.state, r.n]));
  const rows = (total && total.n) || 0;
  const page = pageOf(url, HISTORY_PAGE, rows);
  const settled = await env.DB.prepare(
    `SELECT * FROM yt_proposal WHERE state != 'proposed'
      ORDER BY proposed_at DESC LIMIT ?1 OFFSET ?2`)
    .bind(HISTORY_PAGE, (page - 1) * HISTORY_PAGE).all();

  return youtubePage({ email, tz, snapshots, waiting: waiting.results || [],
    settled: settled.results || [], byState,
    page, size: HISTORY_PAGE, total: rows, params: url.searchParams });
}
