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

/*
 * Is this proposal boilerplate only, or were his words replaced?
 *
 * `kind` is the answer when the box supplied one: yt-description.js knows which
 * path it took, 'swap' meaning findBlurb matched and only the blurb changed.
 * Reading it beats re-deriving it here — the diff below is a PROXY, and it was
 * only ever right while the boilerplate happened to be one line. The brand
 * update on 2026-08-24 made the blurb's opening three lines and the proxy
 * immediately called 23 untouched summaries "rewritten".
 *
 * The diff stays as the fallback for rows filed before `kind` existed.
 */
export function boilerplateOnly(p) {
  if (p.kind === 'swap') return true;
  /*
   * 'append' keeps every word of his and puts the show blurb underneath — the
   * video had no route to the sign-up page because YouTube never captioned it,
   * so there was no summary to write. Nothing of his is replaced, which is the
   * question this function asks, so it belongs with 'swap'.
   *
   * The diff fallback would say the opposite: an append adds lines, and
   * tailOnly() counts any added line as a rewrite. That is the right default
   * for an unlabelled row and the wrong answer for this one.
   */
  if (p.kind === 'append') return true;
  if (p.kind === 'rebuild') return false;
  return tailOnly(p);
}

/*
 * The fallback: does this proposal change exactly one line of what is live?
 *
 * Same line count, exactly one index differing — anything else, including a
 * line added or removed, counts as a rewrite. Erring toward "rewritten" is the
 * safe direction: the cost of the mistake is one extra click, against quietly
 * replacing something he wrote.
 */
export function tailOnly(p) {
  const current = String(p.current_text || '');
  // Nothing there to preserve is not a swap — it is the whole description being
  // written. `''.split('\n')` is `['']`, one line, so without this an empty
  // description against a full one reads as a single changed line.
  if (!current.trim()) return false;
  const a = current.split('\n');
  const b = String(p.proposed || '').split('\n');
  if (a.length !== b.length) return false;
  return a.reduce((n, line, i) => n + (line === b[i] ? 0 : 1), 0) === 1;
}

export async function youtubeAction(request, env, email) {
  const form = await request.formData();
  const doing = String(form.get('do') || '');
  const id = String(form.get('videoId') || '');
  if (['approve', 'reject'].includes(doing) && id) {
    await env.DB.prepare(
      `UPDATE yt_proposal SET state = ?, decided_at = ?, decided_by = ? WHERE video_id = ? AND state = 'proposed'`,
    ).bind(doing === 'approve' ? 'approved' : 'rejected', new Date().toISOString(), email, id).run();
  }
  /*
   * Approve the lot in one go. It exists because the honest shape of this page
   * is lopsided: on 2026-08-24 twenty-three proposals were waiting and twenty
   * of them changed a SINGLE line — the CTA the Shorts fix had just corrected.
   * Clicking twenty identical one-line diffs is not review, it is typing, and a
   * page that makes it tedious to say yes to the obvious gets a blanket yes
   * anyway, just later and with less attention.
   *
   * Two buttons, not one, and the split is the whole point. `approve-tails`
   * takes only the proposals that differ from what is live on exactly one line
   * — a boilerplate swap, nothing he wrote is touched. `approve-all` includes
   * the rewrites too and says so on the button. Both are still a decision he
   * makes; neither is a default.
   */
  if (['approve-tails', 'approve-all'].includes(doing)) {
    const rows = (await env.DB.prepare(
      `SELECT video_id, current_text, proposed, kind FROM yt_proposal WHERE state = 'proposed'`,
    ).all()).results || [];
    const ids = rows.filter((r) => doing === 'approve-all' || boilerplateOnly(r)).map((r) => r.video_id);
    if (ids.length) {
      const now = new Date().toISOString();
      await env.DB.batch(ids.map((v) => env.DB.prepare(
        `UPDATE yt_proposal SET state = 'approved', decided_at = ?, decided_by = ?
          WHERE video_id = ? AND state = 'proposed'`,
      ).bind(now, email, v)));
    }
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
        <span class="pills">${p.state === 'proposed' ? `<span class="pill ${
          boilerplateOnly(p) ? 'p-plain' : 'p-warn'}">${
          boilerplateOnly(p) ? 'boilerplate' : 'rewritten'}</span>` : ''
        }<span class="pill ${cls}">${esc(label)}</span></span>
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

  /*
   * Say yes to the obvious in one click. The tail-only count is named on the
   * button rather than hidden behind it — "approve 20" and "approve 20 boilerplate
   * swaps" ask for different amounts of trust, and only one of them is honest.
   */
  const bulk = (rows) => {
    const tails = rows.filter(boilerplateOnly).length;
    if (rows.length < 2) return '';
    return `<div class="acts bulk">
      ${tails ? `<form method="post" class="inline-form">
        <input type="hidden" name="do" value="approve-tails">
        <button class="primary">Approve the ${tails} boilerplate ${tails === 1 ? 'change' : 'changes'}</button>
      </form>` : ''}
      ${tails < rows.length ? `<form method="post" class="inline-form">
        <input type="hidden" name="do" value="approve-all">
        <button>Approve all ${rows.length}, rewrites included</button>
      </form>` : ''}
      <span class="faint">A boilerplate change touches only the show blurb, never the video's own
        summary. A rewrite replaces words that are already up there.</span>
    </div>`;
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
  ? bulk(waiting) + waiting.map(item).join('') : '<p class="empty">Nothing to review.</p>')}

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
.acts.bulk { margin:0 0 1rem; align-items:center; border-bottom:1px solid var(--line2); padding-bottom:1rem; }
.acts.bulk .faint { font-size:.75rem; }
.pills { display:flex; gap:.35rem; flex-shrink:0; }
code { font-size:.85rem; background:var(--line2); padding:.1rem .35rem; border-radius:4px; }
</style>`;

  return layout({ title: 'YouTube', path: '/youtube', email, tz, body, wide: true });
}
