/*
 * YouTube show notes.
 *
 * Two paths, deliberately different. A video with NO description gets one
 * written and applied without asking — there is nothing to overwrite, and the
 * box backs up whatever was there before it writes either way. A video that
 * already has a description only ever gets a proposal, shown here, which does
 * nothing until it is approved. Overwriting words someone chose is not a thing
 * to do quietly, however reversible it is.
 */
import { esc, card, tile, layout, when, ago, pager } from '../lib/html.js';

const STATE = {
  proposed: ['p-warn', 'waiting on you'],
  approved: ['p-ok', 'approved'],
  applied:  ['p-ok', 'live'],
  rejected: ['p-plain', 'left alone'],
};

export async function youtubeAction(request, env, email) {
  const form = await request.formData();
  const doing = String(form.get('do') || '');
  const id = String(form.get('videoId') || '');
  if (['approve', 'reject'].includes(doing) && id) {
    await env.DB.prepare(
      `UPDATE yt_proposal SET state = ?, decided_at = ?, decided_by = ? WHERE video_id = ? AND state = 'proposed'`,
    ).bind(doing === 'approve' ? 'approved' : 'rejected', new Date().toISOString(), email, id).run();
  }
  return Response.redirect(new URL('/youtube', request.url).toString(), 303);
}

export function youtubePage({ email, tz, waiting, settled, snapshots, byState = {},
  page = 1, size = 25, total = 0, params = '' }) {
  const blurbReady = ((snapshots.voice || {}).body || {}).blurbChosen;

  const item = (p) => {
    const [cls, label] = STATE[p.state] || ['p-plain', p.state];
    return `<article class="prop">
      <header>
        <div><b>${esc(p.title || p.video_id)}</b>
          <span class="faint">${esc(p.video_id)} · drafted ${esc(ago(p.proposed_at))}</span></div>
        <span class="pill ${cls}">${esc(label)}</span>
      </header>
      <div class="cols">
        <div><label>Now</label><pre>${esc(p.current_text || '(empty)')}</pre></div>
        <div><label>Proposed</label><pre>${esc(p.proposed || '')}</pre></div>
      </div>
      ${p.state === 'proposed' ? `<div class="acts">
        <form method="post" class="inline-form"><input type="hidden" name="do" value="approve">
          <input type="hidden" name="videoId" value="${esc(p.video_id)}">
          <button class="primary">Use the new one</button></form>
        <form method="post" class="inline-form"><input type="hidden" name="do" value="reject">
          <input type="hidden" name="videoId" value="${esc(p.video_id)}">
          <button>Keep what's there</button></form>
        <a class="btn" href="https://www.youtube.com/watch?v=${esc(p.video_id)}" target="_blank" rel="noopener">Watch</a>
      </div>` : `<p class="note">${esc(p.decided_by || '')} ${p.decided_at ? esc(when(p.decided_at, tz)) : ''}${
        p.applied_at ? ` · applied ${esc(ago(p.applied_at))}` : ''}</p>`}
    </article>`;
  };

  const body = `
<h1>YouTube</h1>
<p class="lede">Descriptions written from each video's own transcript. Empty ones are filled in
automatically; anything you already wrote waits for you here.</p>

${blurbReady === false ? `<div class="card warnbox"><div class="card-body">
  <b>Auto-fill is paused.</b> The show blurb in <code>config/voice.json</code> is still a
  paraphrase rather than your own words, and it goes at the bottom of every description.
  Until one of the five versions is chosen, the box drafts proposals but writes nothing.
</div></div>` : ''}

<div class="tiles">
  ${tile(waiting.length, 'waiting on you', waiting.length ? 'warn' : 'ok')}
  ${tile(byState.applied || 0, 'written')}
  ${tile(byState.rejected || 0, 'left alone')}
</div>

${card(`Waiting on you (${waiting.length})`, waiting.length
  ? waiting.map(item).join('') : '<p class="empty">Nothing to review.</p>')}

${total ? card(`Settled (${total})`, settled.map(item).join('')
  + pager({ path: '/youtube', params, page, size, total, noun: 'proposals' })) : ''}

<style>
.warnbox { border-color:var(--warn); background:var(--warn-soft); }
.prop { border-bottom:1px solid var(--line2); padding:0 0 1rem; margin:0 0 1rem; }
.prop:last-child { border-bottom:0; margin-bottom:0; padding-bottom:0; }
.prop > header { display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; margin:0 0 .6rem; }
.prop b { display:block; font-size:.92rem; }
.prop .faint { font-size:.75rem; }
.cols { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:.9rem; }
.cols pre { margin:.2rem 0 0; padding:.6rem .7rem; background:var(--bg); border:1px solid var(--line);
  border-radius:8px; font:inherit; font-size:.8rem; white-space:pre-wrap; max-height:16rem; overflow:auto; }
.acts { display:flex; gap:.4rem; margin-top:.7rem; flex-wrap:wrap; }
code { font-size:.85rem; background:var(--line2); padding:.1rem .35rem; border-radius:4px; }
</style>`;

  return layout({ title: 'YouTube', path: '/youtube', email, tz, body, wide: true });
}
