/*
 * Overview: is it running, what is it doing, and what needs a human.
 *
 * The "your turn" list is first on purpose. Everything else on this page is
 * something the pipeline did by itself; that list is the only part that stops
 * unless someone acts, so it goes above the things that look after themselves.
 *
 * This used to lead with a clip-by-platform matrix built from the mirror's
 * ledger. Everything publishes through the queue now, so that ledger has no
 * writer — and a frozen table is worse than no table.
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

export function overviewPage({ email, tz, beat, snapshots, events, counts, kind, level, actions, queue }) {
  const stale = !beat || Date.now() - new Date(beat.at).getTime() > HEARTBEAT_STALE_MS;
  const pace = ((snapshots.pace || {}).body) || {};
  const q = queue || { waiting: 0, failed: 0 };

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
  ${tile(q.waiting, 'waiting to go out', 'plain')}
  ${tile(`${pace.today ?? '—'}/${pace.perDay ?? '—'}`, 'sent today', 'plain', pace.nextAt ? `next ${pace.nextAt}` : '')}
  ${actions.length ? tile(actions.length, 'need you', 'warn') : tile(0, 'need you', 'ok')}
  ${q.failed ? tile(q.failed, 'failed', 'bad') : ''}
</div>

${card('Your turn', yourTurn)}

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
