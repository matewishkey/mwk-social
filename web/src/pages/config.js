/*
 * The workflow map: for each platform, what shape a post takes and who does
 * each step.
 *
 * Everything here is rendered from the `platforms` snapshot the box ships,
 * which is scripts/lib/platforms.js — the same table the publish path reads.
 * Nothing on this page is written out a second time, so it cannot drift from
 * what actually happens.
 */
import { esc, card, layout, ago } from '../lib/html.js';

const BY = {
  native:  ['p-ok',    'native'],
  watcher: ['p-warn',  'watcher'],
  api:     ['p-ok',    'automatic'],
  manual:  ['p-warn',  'your turn'],
  none:    ['p-bad',   'impossible'],
};

const badge = (by) => {
  if (!by) return '';
  const [cls, label] = BY[by] || ['p-plain', by];
  return ` <span class="pill ${cls}">${esc(label)}</span>`;
};

const METRIC_MARK = { yes: ['✓', 'ok'], partial: ['~', 'warn'], rare: ['~', 'warn'], no: ['·', 'faint'] };
const METRICS = ['views', 'reach', 'impressions', 'likes', 'comments', 'shares', 'saves', 'clicks', 'watchTime'];

function flowCards(flows) {
  return flows.map((f) => {
    const c = f.capabilities || {};
    const limits = [
      c.captionMax ? `${c.captionMax.toLocaleString()} chars` : null,
      c.foldAt ? `folds at ${c.foldAt}` : null,
      c.hashtagsInCaption === 0 ? 'no tags in the caption' : null,
      c.videoMaxSec ? `video to ${c.videoMaxSec >= 3600 ? `${c.videoMaxSec / 3600}h` : `${Math.round(c.videoMaxSec / 60)} min`}` : null,
      c.deletable === false ? 'cannot be deleted or edited' : null,
      c.estCostCents ? `${c.estCostCents}c per post with a link` : null,
    ].filter(Boolean);

    return `<section class="card">
      <header>
        <h2>${esc(f.platform)}</h2>
        <span class="faint" style="font-size:.75rem">${esc(limits.join(' · '))}</span>
      </header>
      <div class="card-body">
        <ol class="flow">${f.steps.map((s) => `<li>
          <b>${esc(s.step)}</b>${badge(s.by)}
          <span>${esc(s.how)}</span>
          ${s.note ? `<i>${esc(s.note)}</i>` : ''}
        </li>`).join('')}</ol>
        <div class="metrics">${METRICS.map((m) => {
          const v = (c.metrics || {})[m] || 'no';
          const [mark, tone] = METRIC_MARK[v] || ['·', 'faint'];
          return `<span class="m ${tone}" title="${esc(v)}">${mark} ${esc(m)}</span>`;
        }).join('')}</div>
      </div>
    </section>`;
  }).join('');
}


function explainers(flows, voice) {
  const by = (kind) => flows.filter((f) => (f.steps.find((s) => s.step === 'first comment') || {}).by === kind)
    .map((f) => f.platform);
  const native = by('native');
  const watched = by('watcher');
  const never = by('none');
  const resharing = {
    api: flows.filter((f) => (f.capabilities || {}).reshare === 'api').map((f) => f.platform),
    manual: flows.filter((f) => (f.capabilities || {}).reshare === 'manual').map((f) => f.platform),
  };
  const list = (xs) => xs.length ? xs.join(', ') : 'nothing';
  const v = voice || {};

  return `
${card('How the first comment works', `
<p>The sign-up link goes in a <b>comment</b> rather than in the post itself. On LinkedIn a link in
the body cuts reach by 40–50%, and the same habit keeps every other caption clean.</p>
<p>Two mechanisms put it there, and which one applies is a platform limit, not a choice:</p>
<ul class="plain">
  <li><b class="ok">Natively</b> on ${esc(list(native))} — the comment is sent <i>with</i> the post,
      so it lands seconds after it goes live. YouTube also pins it.</li>
  <li><b class="warn">By the watcher</b> on ${esc(list(watched))} — no native field exists there, so
      an hourly job adds it. It also catches any post whose native comment silently failed.</li>
  <li><b class="bad">Not at all</b> on ${esc(list(never))} — there is no comments API we can use, so
      for those the link goes in the post itself. On X that costs 20c a post; there is no way round it.</li>
</ul>
<p>The wording <b>rotates</b>${v.variants ? ` across ${v.variants} variants` : ''}${
  v.episodeMixRatio ? `, and roughly ${Math.round(v.episodeMixRatio * 100)}% of them quote a real guest
  wish pulled from the show's feed and link that episode` : ''}. The same post always renders the
  same comment, which is what stops it being posted twice.</p>
${v.shortLinkHost ? `<p>Every comment carries a <b>${esc(v.shortLinkHost)}</b> link with its own code —
  one per platform per post — so a click tells you which channel and which video earned it. Only
  Facebook reports clicks natively; everywhere else this is the only way to know.</p>` : ''}
<p>Tags: <code>${esc((v.always || []).join(' '))}</code> on every comment, then up to
  ${esc(v.maxTopic ?? 4)} describing what the video is actually about, worked out from its transcript.
  <b>Instagram's cap of 5 counts the caption and the comments together</b>, so there the two fixed
  tags leave exactly three.</p>
`)}

${card('How resharing works', `
<p>Resharing is possible on <b>${esc(list(resharing.api))}</b> and nowhere else.</p>
<p>The pattern is deliberate: the post goes out natively on the <b>company page</b>, and your
  <b>personal account</b> quote-reshares it with a thought on top. The personal account is the one
  with an audience, and the point is to move that engagement onto the page — so it never
  native-posts. Write the thought in the queue form and it happens automatically; leave it empty and
  nothing is reshared. <b>It is never generated for you.</b></p>
<p>On <b>${esc(list(resharing.manual))}</b> a personal timeline cannot be posted to through any API
  — that is a Meta rule rather than something missing here. So a live post files an item under
  <b>Your turn</b> on the Overview with a direct link: one click, share it yourself, tick it off.</p>
`)}`;
}

export function configPage({ email, tz, snapshots }) {
  const snap = snapshots.platforms;
  const flows = (snap && snap.body && snap.body.flows) || [];
  const voice = snapshots.voice && snapshots.voice.body;

  const body = `
<h1>Workflows</h1>
<p class="lede">What happens to a post on each platform, and who does each step.
Rendered from the table the publish path reads, so it cannot drift.</p>

${flows.length ? explainers(flows, voice) : ''}

<h2 class="sec">Platform by platform</h2>
${flows.length ? `<div class="flowgrid">${flowCards(flows)}</div>` : `
  <div class="card"><div class="card-body empty">
    The box has not shipped the platform table yet. It goes with the hourly metrics run.
  </div></div>`}

${voice ? card('What every post says', `
  <div class="field"><label>Always-on tags</label>
    <code>${esc((voice.always || []).join(' '))}</code></div>
  <div class="field"><label>Call to action</label>
    <code>${esc(voice.marker || '—')}</code>
    <p class="note">${voice.variants ?? 0} comment variants in rotation,
      roughly ${Math.round((voice.episodeMixRatio ?? 0) * 100)}% of them quoting a real guest wish from the feed.</p></div>
  <div class="field"><label>Per-platform hashtag caps</label>
    ${Object.entries(voice.caps || {}).map(([p, n]) =>
      `<span class="pill p-plain">${esc(p)} ${n == null ? '—' : esc(n)}</span>`).join(' ')}
    <p class="note">Instagram's 5 counts the caption and the comments together, so the
      three always-on tags leave exactly two topic slots there.</p></div>
`) : ''}

${snap ? `<p class="note">Shipped ${esc(ago(snap.updatedAt))}.</p>` : ''}

<style>
.sec { font-size:.82rem; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); margin:1.6rem 0 .8rem; }
.card-body p { margin:0 0 .7rem; font-size:.9rem; }
.card-body p:last-child { margin-bottom:0; }
ul.plain { list-style:none; margin:0 0 .7rem; padding:0; }
ul.plain li { padding:.35rem 0 .35rem .9rem; border-left:2px solid var(--line); margin-bottom:.3rem; font-size:.88rem; }
ul.plain b.ok { color:var(--ok); } ul.plain b.warn { color:var(--warn); } ul.plain b.bad { color:var(--bad); }
.flowgrid { display:grid; grid-template-columns:repeat(auto-fit,minmax(330px,1fr)); gap:1.1rem; }
.flowgrid .card { margin:0; }
.flow { list-style:none; margin:0; padding:0; counter-reset:s; }
.flow li { position:relative; padding:0 0 .8rem 1.6rem; counter-increment:s; }
.flow li:last-child { padding-bottom:0; }
.flow li::before {
  content:counter(s); position:absolute; left:0; top:.1rem; width:1.1rem; height:1.1rem;
  border-radius:50%; background:var(--line2); color:var(--muted);
  font-size:.66rem; line-height:1.1rem; text-align:center; font-weight:700;
}
.flow li::after {
  content:''; position:absolute; left:.53rem; top:1.3rem; bottom:.15rem; width:1px; background:var(--line);
}
.flow li:last-child::after { display:none; }
.flow b { font-size:.85rem; }
.flow span { display:block; font-size:.83rem; color:var(--muted); }
.flow i { display:block; font-size:.76rem; color:var(--faint); font-style:normal; }
.metrics { display:flex; flex-wrap:wrap; gap:.3rem; margin-top:.9rem; padding-top:.8rem; border-top:1px solid var(--line2); }
.metrics .m { font-size:.72rem; padding:.1rem .4rem; border-radius:5px; background:var(--line2); }
.metrics .ok { color:var(--ok); } .metrics .warn { color:var(--warn); } .metrics .faint { color:var(--faint); opacity:.65; }
code { font-size:.85rem; background:var(--line2); padding:.15rem .4rem; border-radius:5px; }
</style>`;

  return layout({ title: 'Workflows', path: '/config', email, tz, body, wide: true });
}
