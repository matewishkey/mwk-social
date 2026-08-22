/*
 * The app shell: helpers every page shares, and the chrome around them.
 *
 * Kept apart from the pages so the look is decided once. Everything renders
 * server-side — there is no client framework here and no build step, because
 * the whole dashboard is a few hundred rows of data and a Worker that already
 * has them in hand.
 */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function when(iso, tz, withYear = false) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', day: '2-digit', month: 'short',
      ...(withYear ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch { return iso; }
}

export function day(iso, tz) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short' })
      .format(new Date(iso));
  } catch { return iso; }
}

export const ago = (iso) => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

export const num = (n) => {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

/**
 * Paging for a list that outgrows one screen.
 *
 * Offset paging, not a cursor. The lists here are hundreds of rows, not
 * millions, and a cursor would buy correctness under concurrent inserts that
 * nothing on this dashboard can observe — the events table is append-only from
 * one shipper and the queue is claimed one item at a time.
 *
 * Every existing query parameter is carried through. Losing the kind/level
 * filter on "older" would silently widen what is being read, which is worse
 * than no pager at all.
 *
 * @param {object} o
 * @param {string} o.path     the page's own path, e.g. '/'
 * @param {URLSearchParams|object} o.params  what is already in the query string
 * @param {number} o.page     1-based
 * @param {number} o.size     rows per page
 * @param {number} o.total    rows there are altogether
 * @param {string} [o.noun]   what is being counted, for the caption
 */
export function pager({ path, params, page, size, total, noun = 'rows' }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const here = Math.min(Math.max(1, page), pages);
  const first = total === 0 ? 0 : (here - 1) * size + 1;
  const last = Math.min(total, here * size);

  const href = (n) => {
    const q = new URLSearchParams(params);
    if (n <= 1) q.delete('p'); else q.set('p', String(n));
    const s = q.toString();
    return esc(s ? `${path}?${s}` : path);
  };

  // One page of results still says how many there are — "12 of 12" is an
  // answer, where a bare list leaves you wondering what was cut off.
  const nav = pages > 1 ? `
    <nav class="pager">
      ${here > 1 ? `<a href="${href(here - 1)}">← newer</a>` : '<span>← newer</span>'}
      <b>page ${here} of ${pages}</b>
      ${here < pages ? `<a href="${href(here + 1)}">older →</a>` : '<span>older →</span>'}
    </nav>` : '';

  return `<p class="note">${first === 0 ? `No ${esc(noun)} yet` : `${first}–${last} of ${total} ${esc(noun)}`}.</p>${nav}`;
}

/** Which page was asked for, clamped to something sane. */
export const pageOf = (url, size, total) => {
  const asked = Number.parseInt(url.searchParams.get('p') || '1', 10);
  const pages = Math.max(1, Math.ceil((total || 0) / size));
  return Number.isFinite(asked) ? Math.min(Math.max(1, asked), pages) : 1;
};

const NAV = [
  ['/', 'Overview'],
  ['/stats', 'Stats'],
  ['/queue', 'Queue'],
  ['/youtube', 'YouTube'],
  ['/links', 'Links'],
  ['/config', 'Workflows'],
];

/** A stat tile. `tone` is one of ok / warn / bad / plain. */
export const tile = (value, label, tone = 'plain', sub = '') => `
  <div class="tile t-${tone}">
    <b>${esc(value)}</b>
    <span>${esc(label)}</span>
    ${sub ? `<i>${esc(sub)}</i>` : ''}
  </div>`;

export const card = (title, body, actions = '') => `
  <section class="card">
    ${title ? `<header><h2>${esc(title)}</h2>${actions}</header>` : ''}
    <div class="card-body">${body}</div>
  </section>`;

export function layout({ title, path, email, tz, body, wide = false }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · mwk-social</title>
<style>
:root {
  color-scheme: light dark;
  --bg:#f6f7f9; --panel:#fff; --fg:#14171c; --muted:#606a78; --faint:#8b95a4;
  --line:#e2e6ec; --line2:#eef1f5;
  --accent:#3d5afe; --accent-soft:#eaeeff;
  --ok:#0f7b41; --ok-soft:#e6f5ec; --warn:#a35a00; --warn-soft:#fdf1e0;
  --bad:#c02a20; --bad-soft:#fdecea;
  --radius:12px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:#0f1216; --panel:#171b21; --fg:#e7eaee; --muted:#9aa4b2; --faint:#6d7683;
    --line:#252b34; --line2:#1e232a;
    --accent:#8ea1ff; --accent-soft:#1c2340;
    --ok:#68d99a; --ok-soft:#12281d; --warn:#f0b357; --warn-soft:#2c2113;
    --bad:#ff8a80; --bad-soft:#2e1715;
  }
}
* { box-sizing:border-box; }
html,body { margin:0; }
body {
  background:var(--bg); color:var(--fg);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;
}
a { color:var(--accent); }

/* ---- chrome ---- */
.top {
  position:sticky; top:0; z-index:10; background:var(--panel);
  border-bottom:1px solid var(--line); padding:0 1.25rem;
}
.top-in { max-width:${wide ? '1400px' : '1120px'}; margin:0 auto; display:flex; align-items:center; gap:1.25rem; min-height:56px; flex-wrap:wrap; }
.brand { font-weight:650; letter-spacing:-.01em; margin-right:.25rem; white-space:nowrap; }
.brand span { color:var(--faint); font-weight:400; }
nav { display:flex; gap:.15rem; flex:1; flex-wrap:wrap; }
nav a {
  padding:.4rem .7rem; border-radius:8px; text-decoration:none; color:var(--muted);
  font-size:.9rem; font-weight:500; white-space:nowrap;
}
nav a:hover { background:var(--line2); color:var(--fg); }
nav a.on { background:var(--accent-soft); color:var(--accent); }
.who { font-size:.8rem; color:var(--faint); white-space:nowrap; }

main { max-width:${wide ? '1400px' : '1120px'}; margin:0 auto; padding:1.5rem 1.25rem 4rem; }
h1 { font-size:1.35rem; letter-spacing:-.02em; margin:0 0 .2rem; }
.lede { color:var(--muted); margin:0 0 1.5rem; font-size:.92rem; }

/* ---- cards ---- */
.card { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); margin:0 0 1.1rem; overflow:hidden; }
.card > header {
  display:flex; align-items:center; justify-content:space-between; gap:1rem;
  padding:.8rem 1.1rem; border-bottom:1px solid var(--line2);
}
.card h2 { font-size:.82rem; margin:0; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); font-weight:600; }
.card-body { padding:1.1rem; }
.card-body.flush { padding:0; }

/* ---- tiles ---- */
.tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(148px,1fr)); gap:.7rem; margin:0 0 1.1rem; }
.tile { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:.85rem 1rem; }
.tile b { display:block; font-size:1.6rem; font-weight:640; letter-spacing:-.03em; line-height:1.15; }
.tile span { display:block; font-size:.78rem; color:var(--muted); margin-top:.15rem; }
.tile i { display:block; font-size:.72rem; color:var(--faint); font-style:normal; margin-top:.25rem; }
.t-ok b { color:var(--ok); } .t-warn b { color:var(--warn); } .t-bad b { color:var(--bad); }

/* ---- tables ---- */
.wrap { overflow-x:auto; }
table { border-collapse:collapse; width:100%; font-size:.87rem; }
th,td { text-align:left; padding:.5rem .8rem; border-bottom:1px solid var(--line2); vertical-align:top; }
thead th { font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; color:var(--faint); font-weight:600; white-space:nowrap; }
tbody tr:last-child td { border-bottom:0; }
tbody tr:hover { background:var(--line2); }
td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
.muted { color:var(--muted); } .faint { color:var(--faint); }
.nowrap { white-space:nowrap; }
.trunc { max-width:36ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* ---- bits ---- */
.pill { display:inline-block; padding:.1rem .5rem; border-radius:99px; font-size:.72rem; font-weight:600; }
.p-ok { background:var(--ok-soft); color:var(--ok); }
.p-warn { background:var(--warn-soft); color:var(--warn); }
.p-bad { background:var(--bad-soft); color:var(--bad); }
.p-plain { background:var(--line2); color:var(--muted); }
.filters { display:flex; flex-wrap:wrap; gap:.35rem; margin:0 0 .9rem; }
.filters a { font-size:.78rem; color:var(--muted); text-decoration:none; border:1px solid var(--line); border-radius:99px; padding:.2rem .65rem; background:var(--panel); }
.filters a.on { color:var(--accent); border-color:var(--accent); background:var(--accent-soft); }
.empty { color:var(--faint); font-size:.88rem; padding:.5rem 0; }
.note { font-size:.8rem; color:var(--faint); margin:.7rem 0 0; }
.pager { display:flex; align-items:center; gap:.8rem; margin:.5rem 0 0; flex:none; }
.pager a, .pager span, .pager b { font-size:.8rem; padding:.3rem .6rem; border-radius:.4rem; }
.pager a { color:var(--accent); background:var(--accent-soft); text-decoration:none; }
.pager a:hover { background:var(--line2); color:var(--fg); }
.pager span { color:var(--faint); }
.pager b { color:var(--muted); font-weight:600; }

/* ---- forms ---- */
label { display:block; font-size:.78rem; font-weight:600; color:var(--muted); margin:0 0 .3rem; }
input[type=text],input[type=url],textarea,select {
  width:100%; padding:.55rem .7rem; border:1px solid var(--line); border-radius:8px;
  background:var(--bg); color:var(--fg); font:inherit; font-size:.9rem;
}
textarea { min-height:8rem; resize:vertical; line-height:1.5; }
.field { margin:0 0 .9rem; }
.row { display:flex; gap:.9rem; flex-wrap:wrap; }
.row > * { flex:1 1 12rem; }
.checks { display:flex; flex-wrap:wrap; gap:.5rem; }
.checks label { display:inline-flex; align-items:center; gap:.35rem; font-weight:500; font-size:.85rem;
  color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:.35rem .6rem; margin:0; cursor:pointer; }
.checks input { margin:0; }
button, .btn {
  font:inherit; font-size:.88rem; font-weight:600; padding:.5rem .95rem; border-radius:8px;
  border:1px solid var(--line); background:var(--panel); color:var(--fg); cursor:pointer; text-decoration:none;
  display:inline-block;
}
button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
button.danger { color:var(--bad); }
button:hover, .btn:hover { filter:brightness(1.05); }
.inline-form { display:inline; }

footer { max-width:${wide ? '1400px' : '1120px'}; margin:0 auto; padding:0 1.25rem 3rem; font-size:.78rem; color:var(--faint); }
</style></head><body>
<header class="top"><div class="top-in">
  <div class="brand">mwk<span>-social</span></div>
  <nav>${NAV.map(([href, label]) =>
    `<a href="${href}" class="${path === href ? 'on' : ''}">${esc(label)}</a>`).join('')}</nav>
  <div class="who">${esc(email)} · ${esc(tz)}</div>
</div></header>
<main>${body}</main>
</body></html>`;
}
