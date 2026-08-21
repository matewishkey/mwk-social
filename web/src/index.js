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
import { api } from './api.js';
import { redirect } from './links.js';
import { overviewPage, overviewAction } from './pages/overview.js';
import { statsPage } from './pages/stats.js';
import { configPage } from './pages/config.js';
import { queuePage, queueAction } from './pages/queue.js';
import { youtubePage, youtubeAction } from './pages/youtube.js';

const EVENT_PAGE = 200;
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

  const tz = env.TZ_DISPLAY || 'UTC';

  if (request.method === 'POST') {
    if (url.pathname === '/queue')   return queueAction(request, env, email);
    if (url.pathname === '/youtube') return youtubeAction(request, env, email);
    if (url.pathname === '/')        return overviewAction(request, env, email);
    return new Response('not found', { status: 404 });
  }

  const snapshots = await loadSnapshots(env);

  switch (url.pathname) {
    case '/stats':   return html(await stats(env, tz, snapshots, email));
    case '/config':  return html(configPage({ email, tz, snapshots }));
    case '/queue':   return html(await queue(env, tz, snapshots, email));
    case '/youtube': return html(await youtube(env, tz, snapshots, email));
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
  const [beat, events, counts, actions, queue] = await Promise.all([
    env.DB.prepare('SELECT at, count FROM ingest_batch ORDER BY at DESC LIMIT 1').first(),
    env.DB.prepare(
      `SELECT * FROM event WHERE (?1 = '' OR kind = ?1) AND (?2 = '' OR level = ?2)
        ORDER BY ts DESC LIMIT ${EVENT_PAGE}`).bind(kind, level).all(),
    env.DB.prepare('SELECT kind, COUNT(*) n FROM event GROUP BY kind ORDER BY n DESC').all(),
    env.DB.prepare('SELECT * FROM manual_action WHERE done_at IS NULL ORDER BY created_at DESC LIMIT 50').all(),
    env.DB.prepare(
      `SELECT SUM(status IN ('queued','claimed')) waiting, SUM(status = 'failed') failed FROM queue_item`).first(),
  ]);
  return overviewPage({ email, tz, beat, snapshots, events: events.results || [],
    counts: counts.results || [], kind, level, actions: actions.results || [],
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
      // bot = 0 only: a link-preview fetch is not a click.
      `SELECT l.platform, COUNT(*) n FROM click c JOIN link l ON l.code = c.code
        WHERE c.at >= ? AND c.bot = 0 GROUP BY l.platform ORDER BY n DESC`).bind(from).all(),
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
  return statsPage({ email, tz, snapshots, days: STATS_DAYS,
    daily: daily.results || [], followers: followers.results || [], clicks: clicks.results || [],
    targets: targets.results || [], split: split.results || [], links: (links && links.n) || 0 });
}

async function queue(env, tz, snapshots, email) {
  const items = await env.DB.prepare('SELECT * FROM queue_item ORDER BY created_at DESC LIMIT 200').all();
  // The pace is the box's, shipped with the ledger — never recomputed here, or
  // the page and the publisher would eventually disagree about what today holds.
  const pace = ((snapshots.pace || {}).body) || { perDay: '—', today: '—', window: '—', tz, nextAt: null, why: '' };
  return queuePage({ email, tz, items: items.results || [], pace });
}

async function youtube(env, tz, snapshots, email) {
  const rows = await env.DB.prepare('SELECT * FROM yt_proposal ORDER BY proposed_at DESC LIMIT 100').all();
  return youtubePage({ email, tz, snapshots, proposals: rows.results || [] });
}
