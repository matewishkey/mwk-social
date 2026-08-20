/*
 * mwk-social: event ingest and a gated dashboard, one Worker, two hostnames.
 *
 *   ingest.matewishkey.com    POST /events, bearer token, from the box
 *   internal.matewishkey.com  the dashboard, behind Cloudflare Access
 *
 * Two hostnames rather than one with path rules: an Access application covers a
 * HOSTNAME, so putting ingest behind the same one would 302 the uploader into a
 * login page, and path-based exclusions would mean depending on Access ordering
 * forever.
 *
 * `workers_dev = false` in wrangler.toml is what keeps this closed. Access binds
 * to a hostname, not to a script, so a workers.dev route would serve the whole
 * dashboard ungated right beside the gated one. The JWT check below is the
 * second lock on the same door: if the Access application is ever detached or
 * misconfigured, requests arrive with no assertion and are refused here.
 */

const HEARTBEAT_STALE_MS = 15 * 60 * 1000;
const EVENT_PAGE = 200;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.hostname === env.INGEST_HOST) return await ingest(request, env, url);
      return await dashboard(request, env, url);
    } catch (err) {
      return new Response(`error: ${err.message}`, { status: 500 });
    }
  },
};

/* ---------------------------------------------------------------- ingest -- */

// Compared byte by byte in constant time. A length-leaking early return on a
// bearer token is a small thing, but it costs nothing to not do it.
function tokenOk(given, expected) {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function ingest(request, env, url) {
  if (request.method !== 'POST' || url.pathname !== '/events') {
    return new Response('not found', { status: 404 });
  }
  const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tokenOk(bearer, env.INGEST_TOKEN)) return new Response('unauthorized', { status: 401 });

  const body = await request.json();
  const events = Array.isArray(body.events) ? body.events : [];
  const snapshots = body.snapshots && typeof body.snapshots === 'object' ? body.snapshots : {};
  const now = new Date().toISOString();

  const statements = [];
  for (const e of events) {
    if (!e || !e.id || !e.kind || !e.ts) continue;
    statements.push(env.DB.prepare(
      // INSERT OR IGNORE, so a batch replayed after a network failure costs
      // nothing: the ULID is stable per event and dedupe_key is unique.
      `INSERT OR IGNORE INTO event
        (id, dedupe_key, ts, run_id, source, kind, level, clip_id, platform,
         account_id, post_key, url, message, data, received_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      e.id, e.dedupe_key || null, e.ts, e.run_id || null, e.source || null,
      e.kind, e.level || 'info', e.clip_id || null, e.platform || null,
      e.account_id || null, e.post_key || null, e.url || null,
      (e.message || '').slice(0, 500), e.data == null ? null : JSON.stringify(e.data), now,
    ));
  }
  for (const [name, value] of Object.entries(snapshots)) {
    statements.push(env.DB.prepare(
      `INSERT INTO snapshot (name, body, updated_at) VALUES (?,?,?)
       ON CONFLICT(name) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    ).bind(name, JSON.stringify(value), now));
  }
  // Always recorded, even for an empty batch: without a heartbeat "nothing
  // happened" and "the box is off" are the same picture.
  statements.push(env.DB.prepare(
    'INSERT INTO ingest_batch (at, count, source) VALUES (?,?,?)',
  ).bind(now, events.length, body.source || null));

  await env.DB.batch(statements);
  return Response.json({ ok: true, events: events.length, snapshots: Object.keys(snapshots).length });
}

/* ------------------------------------------------------------- dashboard -- */

let jwksCache = { at: 0, keys: null };

async function jwks(env) {
  if (jwksCache.keys && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const res = await fetch(`https://${env.ACCESS_TEAM}/cdn-cgi/access/certs`);
  const { keys } = await res.json();
  jwksCache = { at: Date.now(), keys };
  return keys;
}

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/**
 * Verify the assertion Access puts on every request it lets through.
 * @returns {string|null} the identity's email, or null if the token is no good.
 */
async function accessIdentity(request, env) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return null;
  const [rawHeader, rawPayload, rawSignature] = jwt.split('.');
  if (!rawSignature) return null;

  let header; let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(rawHeader)));
    payload = JSON.parse(new TextDecoder().decode(b64url(rawPayload)));
  } catch { return null; }

  const jwk = (await jwks(env)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key,
    b64url(rawSignature), new TextEncoder().encode(`${rawHeader}.${rawPayload}`));
  if (!ok) return null;

  // Audience and expiry are checked here too. A signature alone would accept a
  // valid token minted for a DIFFERENT application in the same Access org.
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(env.ACCESS_AUD)) return null;
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
  return payload.email || 'unknown';
}

async function dashboard(request, env, url) {
  const email = await accessIdentity(request, env);
  if (!email) {
    return new Response('This page is behind Cloudflare Access and no valid assertion arrived.',
      { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (url.pathname === '/health') return Response.json({ ok: true, email });

  const kind = url.searchParams.get('kind') || '';
  const level = url.searchParams.get('level') || '';

  const [beat, snaps, events, counts] = await Promise.all([
    env.DB.prepare('SELECT at, count FROM ingest_batch ORDER BY at DESC LIMIT 1').first(),
    env.DB.prepare('SELECT name, body, updated_at FROM snapshot').all(),
    env.DB.prepare(
      `SELECT * FROM event
        WHERE (?1 = '' OR kind = ?1) AND (?2 = '' OR level = ?2)
        ORDER BY ts DESC LIMIT ${EVENT_PAGE}`,
    ).bind(kind, level).all(),
    env.DB.prepare('SELECT kind, COUNT(*) n FROM event GROUP BY kind ORDER BY n DESC').all(),
  ]);

  const snapshots = {};
  for (const row of snaps.results || []) {
    try { snapshots[row.name] = { body: JSON.parse(row.body), updatedAt: row.updated_at }; } catch { /* ignore */ }
  }
  return new Response(render({ env, email, beat, snapshots, events: events.results || [],
    counts: counts.results || [], kind, level }), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/* ---------------------------------------------------------------- render -- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function when(iso, tz) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23',
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch { return iso; }
}

const ago = (iso) => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

function matrix(ledger, tz) {
  if (!ledger || !ledger.body || !ledger.body.clips) {
    return '<p class="muted">No mirror ledger has been shipped yet.</p>';
  }
  const clips = Object.entries(ledger.body.clips)
    .sort((a, b) => String(b[1].publishedAt).localeCompare(String(a[1].publishedAt)));
  const targets = ['threads', 'twitter', 'tiktok', 'instagram'];
  const cell = (t) => {
    if (!t) return '<td class="s-none">—</td>';
    const label = { posted: '●', pending: '○', failed: '✕', blocked: '▲', inflight: '◐' }[t.status] || '?';
    const title = esc(`${t.status}${t.note ? ': ' + t.note : ''}`);
    const inner = t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">${label}</a>` : label;
    return `<td class="s-${esc(t.status)}" title="${title}">${inner}</td>`;
  };
  return `<table class="matrix">
    <thead><tr><th>clip</th>${targets.map((t) => `<th>${t}</th>`).join('')}<th>published</th></tr></thead>
    <tbody>${clips.map(([, c]) => `<tr>
      <td class="clip">${esc((c.caption || '(no caption)').slice(0, 64))}</td>
      ${targets.map((t) => cell((c.targets || {})[t])).join('')}
      <td class="muted">${when(c.publishedAt, tz)}</td>
    </tr>`).join('')}</tbody>
  </table>
  <p class="legend">● posted &nbsp; ○ queued &nbsp; ◐ in flight &nbsp; ✕ failed &nbsp; ▲ held back</p>`;
}

// Exported so the page can be rendered and asserted on without a live request:
// everything else here needs Access headers or a D1 binding, and the markup is
// the part most worth a test.
export function render({ env, email, beat, snapshots, events, counts, kind, level }) {
  const tz = env.TZ_DISPLAY || 'UTC';
  const stale = !beat || Date.now() - new Date(beat.at).getTime() > HEARTBEAT_STALE_MS;
  const ledger = snapshots['mirror-ledger'];

  const totals = { posted: 0, pending: 0, other: 0 };
  for (const c of Object.values((ledger && ledger.body && ledger.body.clips) || {})) {
    for (const t of Object.values(c.targets || {})) {
      if (t.status === 'posted') totals.posted++;
      else if (t.status === 'pending') totals.pending++;
      else totals.other++;
    }
  }

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>mwk-social</title>
<style>
  :root { color-scheme: light dark; --fg:#111; --bg:#fff; --muted:#666; --line:#e3e3e3;
          --ok:#137333; --warn:#b06000; --bad:#c5221f; --card:#fafafa; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#e8e8e8; --bg:#16181c; --muted:#9aa0a6; --line:#2c2f36;
            --ok:#7ee2a8; --warn:#f0b357; --bad:#ff8a80; --card:#1d2026; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:1.5rem; font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         color:var(--fg); background:var(--bg); }
  h1 { font-size:1.15rem; margin:0 0 .25rem; }
  h2 { font-size:.95rem; margin:2rem 0 .6rem; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  .muted { color:var(--muted); }
  .strip { display:flex; flex-wrap:wrap; gap:.6rem; margin:1rem 0; }
  .tile { border:1px solid var(--line); border-radius:8px; padding:.55rem .8rem; background:var(--card); }
  .tile b { display:block; font-size:1.3rem; font-weight:600; }
  .tile.bad b { color:var(--bad); } .tile.ok b { color:var(--ok); }
  table { border-collapse:collapse; width:100%; font-size:.88rem; }
  th, td { text-align:left; padding:.4rem .55rem; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-weight:600; color:var(--muted); font-size:.78rem; text-transform:uppercase; letter-spacing:.05em; }
  .matrix td:not(.clip):not(.muted) { text-align:center; font-size:1.05rem; }
  .s-posted { color:var(--ok); } .s-failed { color:var(--bad); }
  .s-blocked, .s-inflight { color:var(--warn); } .s-pending, .s-none { color:var(--muted); }
  .matrix a { text-decoration:none; color:inherit; }
  .clip { max-width:34ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .legend { font-size:.78rem; color:var(--muted); }
  .lvl-error { color:var(--bad); } .lvl-warn { color:var(--warn); }
  .filters a { display:inline-block; margin:0 .5rem .4rem 0; font-size:.8rem; color:var(--muted); text-decoration:none;
               border:1px solid var(--line); border-radius:99px; padding:.15rem .6rem; }
  .filters a.on { color:var(--fg); border-color:var(--fg); }
  .wrap { overflow-x:auto; }
  footer { margin-top:2.5rem; font-size:.78rem; color:var(--muted); }
</style></head><body>

<h1>mwk-social</h1>
<div class="muted">${esc(email)} · times in ${esc(tz)}</div>

<div class="strip">
  <div class="tile ${stale ? 'bad' : 'ok'}"><b>${stale ? 'stale' : 'live'}</b>
    <span class="muted">last heartbeat ${beat ? esc(ago(beat.at)) : 'never'}</span></div>
  <div class="tile"><b>${totals.posted}</b><span class="muted">mirrored</span></div>
  <div class="tile"><b>${totals.pending}</b><span class="muted">queued</span></div>
  ${totals.other ? `<div class="tile bad"><b>${totals.other}</b><span class="muted">held or failed</span></div>` : ''}
</div>

<h2>Clips</h2>
<div class="wrap">${matrix(ledger, tz)}</div>
${ledger ? `<p class="muted" style="font-size:.78rem">ledger shipped ${esc(ago(ledger.updatedAt))}</p>` : ''}

<h2>Events</h2>
<div class="filters">
  <a href="/" class="${kind || level ? '' : 'on'}">all</a>
  <a href="/?level=error" class="${level === 'error' ? 'on' : ''}">errors</a>
  ${counts.map((c) => `<a href="/?kind=${encodeURIComponent(c.kind)}" class="${kind === c.kind ? 'on' : ''}">${esc(c.kind)} ${c.n}</a>`).join('')}
</div>
<div class="wrap"><table>
  <thead><tr><th>when</th><th>kind</th><th>platform</th><th>message</th></tr></thead>
  <tbody>${events.length ? events.map((e) => `<tr>
    <td class="muted" style="white-space:nowrap">${esc(when(e.ts, tz))}</td>
    <td>${esc(e.kind)}</td>
    <td class="muted">${esc(e.platform || '')}</td>
    <td class="lvl-${esc(e.level)}">${e.url
      ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.message)}</a>`
      : esc(e.message)}</td>
  </tr>`).join('') : '<tr><td colspan="4" class="muted">nothing yet</td></tr>'}</tbody>
</table></div>

<footer>Newest ${EVENT_PAGE} events. The box ships every two minutes and sends an empty
batch when idle, so "stale" means the box, not the pipeline.</footer>
</body></html>`;
}
