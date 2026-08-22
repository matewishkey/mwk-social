/*
 * The link database.
 *
 * Every short code the pipeline has ever minted, what it was for, and how many
 * people actually followed it. Plus a form to mint one by hand, which is the
 * part that did not exist: until 2026-08-22 a link could only be created as a
 * side effect of publishing, so anything he needed to paste somewhere himself —
 * a bio, a newsletter, a business card — had to be the raw url and was
 * therefore invisible.
 *
 * Three columns make a link answerable, and all three are part of the mint key
 * so the same destination can be measured separately in each place it appears:
 *
 *   source    the network            (platform)
 *   medium    where it was placed    (caption / comment / reply / profile / bio)
 *   campaign  what it was FOR        (bio / og-generator / x-replies)
 *
 * Only `bot = 0` clicks are ever shown. A platform fetching a url to build its
 * preview card hits the redirect exactly like a person does — the first live
 * post logged 18 of them on one link in three minutes — so the crawler column
 * is kept visible rather than hidden, because a link with 40 crawler hits and
 * no human ones is a link that was seen and ignored, which is worth knowing.
 */
import { esc, card, tile, layout, when, ago, pager } from '../lib/html.js';
import { mint } from '../api.js';

const MEDIUMS = ['profile', 'caption', 'comment', 'reply', 'bio', 'newsletter', 'other'];
const SOURCES = ['twitter', 'instagram', 'threads', 'facebook', 'linkedin', 'youtube', 'tiktok', 'other'];

export async function linksAction(request, env, email) {
  const form = await request.formData();
  const doing = String(form.get('do') || '');
  const back = new URL('/links', request.url);

  if (doing === 'mint') {
    const target = String(form.get('target') || '').trim();
    if (!/^https?:\/\//i.test(target)) {
      back.searchParams.set('err', 'a link has to start with http:// or https://');
      return Response.redirect(back.toString(), 303);
    }
    const val = (k) => {
      const v = String(form.get(k) || '').trim();
      return v && v !== '-' ? v : null;
    };
    try {
      const r = await mint(env, {
        target,
        platform: val('platform'),
        medium: val('medium'),
        campaign: val('campaign'),
        label: val('label'),
        note: val('note'),
        createdBy: email,
      });
      back.searchParams.set('minted', r.code);
    } catch (e) {
      back.searchParams.set('err', e.message);
    }
  }
  return Response.redirect(back.toString(), 303);
}

export function linksPage({ email, tz, host, rows, campaigns, totals, minted, err,
  campaign = '', page = 1, size = 50, total = 0, params = '' }) {
  const short = (code) => `https://${host}/${code}`;

  const row = (l) => `<tr>
    <td class="code"><a href="${esc(short(l.code))}" target="_blank" rel="noopener">${esc(l.code)}</a></td>
    <td>${l.campaign ? `<a href="/links?campaign=${encodeURIComponent(l.campaign)}">${esc(l.campaign)}</a>`
      : '<span class="faint">—</span>'}</td>
    <td class="faint">${esc(l.platform || '—')}</td>
    <td class="faint">${esc(l.medium || '—')}</td>
    <td class="num ${l.human ? 'good' : ''}">${l.human || 0}</td>
    <td class="num faint">${l.crawler || 0}</td>
    <td class="tgt"><a href="${esc(l.target)}" target="_blank" rel="noopener">${esc(l.target)}</a>
      ${l.note ? `<span class="nt">${esc(l.note)}</span>` : ''}</td>
    <td class="faint nowrap">${esc(ago(l.created_at))}</td>
  </tr>`;

  const opts = (list, sel) => ['-', ...list]
    .map((v) => `<option${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');

  const body = `
<h1>Links</h1>
<p class="lede">Every short code, what it was for, and how many people actually followed it.
Mint one here for anything you paste somewhere yourself — a bio, a newsletter, a talk.</p>

<div class="tiles">
  ${tile(totals.links, 'links', 'plain')}
  ${tile(totals.human, 'clicks', totals.human ? 'ok' : 'plain', 'people, not crawlers')}
  ${tile(totals.crawler, 'preview fetches', 'plain', 'never counted')}
  ${tile(campaigns.length, 'campaigns', 'plain')}
</div>

${minted ? `<div class="card okbox"><div class="card-body">
  <b>Minted.</b> <code class="big">${esc(short(minted))}</code>
  <button class="copy" data-t="${esc(short(minted))}">Copy</button>
</div></div>` : ''}
${err ? `<div class="card badbox"><div class="card-body"><b>Not minted.</b> ${esc(err)}</div></div>` : ''}

${card('Mint one', `
<form method="post" class="mintform">
  <input type="hidden" name="do" value="mint">
  <label class="wide">Where it goes
    <input name="target" type="url" placeholder="https://matewishkey.com/show" required></label>
  <label>Campaign <input name="campaign" list="campaigns" placeholder="bio"></label>
  <datalist id="campaigns">${campaigns.map((c) => `<option>${esc(c.campaign)}</option>`).join('')}</datalist>
  <label>Source <select name="platform">${opts(SOURCES, '-')}</select></label>
  <label>Medium <select name="medium">${opts(MEDIUMS, '-')}</select></label>
  <label class="wide">Note to self <input name="note" placeholder="X bio, from 22 Aug"></label>
  <div><button class="primary">Mint it</button></div>
</form>`)}

${card(`Campaigns`, campaigns.length ? `<div class="wrap"><table>
  <thead><tr><th>campaign</th><th class="num">links</th><th class="num">clicks</th><th class="num">crawlers</th></tr></thead>
  <tbody>${campaigns.map((c) => `<tr>
    <td><a href="/links?campaign=${encodeURIComponent(c.campaign)}">${esc(c.campaign)}</a></td>
    <td class="num">${c.links}</td><td class="num ${c.human ? 'good' : ''}">${c.human || 0}</td>
    <td class="num faint">${c.crawler || 0}</td></tr>`).join('')}</tbody></table></div>`
  : '<p class="empty">Nothing carries a campaign yet — everything minted before 22 August predates the field.</p>')}

${card(campaign ? `Links in "${esc(campaign)}" (${total})` : `All links (${total})`, `
<div class="filters">
  <a href="/links" class="${campaign ? '' : 'on'}">all</a>
  ${campaigns.map((c) => `<a href="/links?campaign=${encodeURIComponent(c.campaign)}"
    class="${campaign === c.campaign ? 'on' : ''}">${esc(c.campaign)} ${c.links}</a>`).join('')}
</div>
<div class="wrap"><table>
  <thead><tr><th>code</th><th>campaign</th><th>source</th><th>medium</th>
    <th class="num">clicks</th><th class="num">bots</th><th>goes to</th><th>minted</th></tr></thead>
  <tbody>${rows.length ? rows.map(row).join('')
    : '<tr><td colspan="8" class="empty">Nothing here.</td></tr>'}</tbody>
</table></div>
${pager({ path: '/links', params, page, size, total, noun: 'links' })}`)}

<style>
.okbox { border-color:var(--ok); } .badbox { border-color:var(--bad); }
.mintform { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:.7rem; align-items:end; }
.mintform label { display:flex; flex-direction:column; gap:.25rem; font-size:.76rem;
  text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.mintform label.wide { grid-column:1/-1; }
.mintform label.check { grid-column:1/-1; flex-direction:row; align-items:center; gap:.45rem;
  text-transform:none; letter-spacing:0; font-size:.85rem; }
.mintform input, .mintform select { font:inherit; font-size:.9rem; padding:.45rem .55rem;
  border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--fg); }
td.code a { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-weight:600; }
td.num { text-align:right; font-variant-numeric:tabular-nums; }
td.num.good { color:var(--ok); font-weight:600; }
td.tgt { max-width:32rem; }
td.tgt a { word-break:break-all; font-size:.82rem; }
.nt { display:block; font-size:.74rem; color:var(--faint); }
code.big { font-size:1rem; font-weight:600; }
button.copy { font:inherit; font-size:.8rem; margin-left:.5rem; padding:.2rem .7rem;
  border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); cursor:pointer; }
</style>
<script>
document.querySelectorAll('button.copy').forEach(function (b) {
  b.addEventListener('click', function () {
    var t = b.dataset.t;
    function ok() { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1500); }
    if (navigator.clipboard) { navigator.clipboard.writeText(t).then(ok, fb); } else { fb(); }
    function fb() {
      var a = document.createElement('textarea'); a.value = t;
      document.body.appendChild(a); a.select();
      try { document.execCommand('copy'); ok(); } catch (e) { b.textContent = 'failed'; }
      document.body.removeChild(a);
    }
  });
});
</script>`;

  return layout({ title: 'Links', path: '/links', email, tz, body, wide: true });
}
