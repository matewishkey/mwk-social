/*
 * Overview: is it running, what is it doing, and what needs a human.
 *
 * The "your turn" list is first on purpose. Everything else on this page is
 * something the pipeline did by itself; that list is the only part that stops
 * unless someone acts, so it goes above the things that look after themselves.
 */
import { esc, card, tile, layout, when, ago } from '../lib/html.js';

const EVENT_PAGE = 200;
const HEARTBEAT_STALE_MS = 15 * 60 * 1000;

export async function overviewAction(request, env, email) {
  const form = await request.formData();
  if (form.get('do') === 'done') {
    await env.DB.prepare('UPDATE manual_action SET done_at = ?, done_by = ? WHERE id = ?')
      .bind(new Date().toISOString(), email, String(form.get('id') || '')).run();
  }
  return Response.redirect(new URL('/', request.url).toString(), 303);
}

function matrix(ledger, tz) {
  if (!ledger || !ledger.body || !ledger.body.clips) {
    return '<p class="empty">No mirror ledger has been shipped yet.</p>';
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
  return `<div class="wrap"><table class="matrix">
    <thead><tr><th>clip</th>${targets.map((t) => `<th>${t}</th>`).join('')}<th>published</th></tr></thead>
    <tbody>${clips.map(([, c]) => `<tr>
      <td class="trunc">${esc(c.caption || '(no caption)')}</td>
      ${targets.map((t) => cell((c.targets || {})[t])).join('')}
      <td class="faint nowrap">${when(c.publishedAt, tz)}</td>
    </tr>`).join('')}</tbody></table></div>
  <p class="note">● posted &nbsp; ○ queued &nbsp; ◐ in flight &nbsp; ✕ failed &nbsp; ▲ held back</p>`;
}

export function overviewPage({ email, tz, beat, snapshots, events, counts, kind, level, actions }) {
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

  const yourTurn = actions.length ? `<ul class="todo">${actions.map((a) => `<li>
      <div><b>${esc(a.label || a.kind)}</b>
        <span class="faint">${esc(a.platform || '')} · filed ${esc(ago(a.created_at))}</span></div>
      <div class="acts">
        ${a.url ? `<a class="btn" href="${esc(a.url)}" target="_blank" rel="noopener">Open it</a>` : ''}
        <form method="post" class="inline-form"><input type="hidden" name="do" value="done">
          <input type="hidden" name="id" value="${esc(a.id)}"><button>Done</button></form>
      </div></li>`).join('')}</ul>`
    : '<p class="empty">Nothing waiting on you.</p>';

  const body = `
<h1>Overview</h1>
<p class="lede">The pipeline runs itself; this is what it has been doing.</p>

<div class="tiles">
  ${tile(stale ? 'stale' : 'live', 'the box', stale ? 'bad' : 'ok',
    beat ? `heartbeat ${ago(beat.at)}` : 'never checked in')}
  ${tile(totals.posted, 'mirrored', 'plain')}
  ${tile(totals.pending, 'still queued', 'plain')}
  ${actions.length ? tile(actions.length, 'need you', 'warn') : tile(0, 'need you', 'ok')}
  ${totals.other ? tile(totals.other, 'held or failed', 'bad') : ''}
</div>

${card('Your turn', yourTurn)}

${card('Clips', matrix(ledger, tz)
  + (ledger ? `<p class="note">Ledger shipped ${esc(ago(ledger.updatedAt))}.</p>` : ''))}

${card('Events', `
<div class="filters">
  <a href="/" class="${kind || level ? '' : 'on'}">all</a>
  <a href="/?level=error" class="${level === 'error' ? 'on' : ''}">errors</a>
  ${counts.map((c) => `<a href="/?kind=${encodeURIComponent(c.kind)}" class="${kind === c.kind ? 'on' : ''}">${esc(c.kind)} ${c.n}</a>`).join('')}
</div>
<div class="wrap"><table>
  <thead><tr><th>when</th><th>kind</th><th>platform</th><th>message</th></tr></thead>
  <tbody>${events.length ? events.map((e) => `<tr>
    <td class="faint nowrap">${esc(when(e.ts, tz))}</td>
    <td>${esc(e.kind)}</td>
    <td class="faint">${esc(e.platform || '')}</td>
    <td class="lvl-${esc(e.level)}">${e.url
      ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.message)}</a>`
      : esc(e.message)}</td>
  </tr>`).join('') : '<tr><td colspan="4" class="empty">Nothing yet.</td></tr>'}</tbody>
</table></div>
<p class="note">Newest ${EVENT_PAGE}. The box ships every two minutes and sends an empty batch
when idle, so "stale" means the box, not the pipeline.</p>`)}

<style>
.matrix td:not(.trunc):not(.faint) { text-align:center; font-size:1.05rem; }
.s-posted { color:var(--ok); } .s-failed { color:var(--bad); }
.s-blocked, .s-inflight { color:var(--warn); } .s-pending, .s-none { color:var(--faint); }
.matrix a { text-decoration:none; color:inherit; }
.lvl-error { color:var(--bad); } .lvl-warn { color:var(--warn); }
.todo { list-style:none; margin:0; padding:0; }
.todo li { display:flex; align-items:center; justify-content:space-between; gap:1rem;
  padding:.6rem 0; border-bottom:1px solid var(--line2); flex-wrap:wrap; }
.todo li:last-child { border-bottom:0; padding-bottom:0; }
.todo b { font-size:.9rem; display:block; }
.todo .faint { font-size:.76rem; }
.acts { display:flex; gap:.4rem; }
</style>`;

  return layout({ title: 'Overview', path: '/', email, tz, body, wide: true });
}
