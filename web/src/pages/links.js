/*
 * The link database, and the page he actually works from.
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
 *   campaign  what it was FOR        (bio / book / episode / clip)
 *
 * 2026-08-24: this page grew a COPY BUTTON on every row and a plain-English
 * name for every campaign, because the alternative was me generating a static
 * page on the share every time he wanted to paste a link somewhere. A code he
 * cannot copy off the screen is a code he cannot use — mate cannot select text
 * out of a terminal, and that is exactly why the share pages exist. The same
 * reasoning applies here: the dashboard is where he already is.
 *
 * Only `bot = 0` clicks are ever shown. A platform fetching a url to build its
 * preview card hits the redirect exactly like a person does — the first live
 * post logged 18 of them on one link in three minutes — so the crawler column
 * is kept visible rather than hidden, because a link with 40 crawler hits and
 * no human ones is a link that was seen and ignored, which is worth knowing.
 */
import { esc, card, tile, layout, ago, pager } from '../lib/html.js';
import { mint } from '../api.js';

const MEDIUMS = ['profile', 'caption', 'comment', 'reply', 'bio', 'newsletter', 'other'];
const SOURCES = ['twitter', 'instagram', 'threads', 'facebook', 'linkedin', 'youtube', 'tiktok',
  'website', 'other'];

/*
 * What each campaign MEANS, in his words rather than the column value, and
 * whether a human has to do anything about it. `hand` means he pastes it
 * somewhere; `auto` means the pipeline writes it and there is nothing to do.
 * A campaign missing from here still renders — it just gets no description,
 * which is the right failure: an unknown campaign should look unknown.
 */
const CAMPAIGNS = {
  bio: {
    title: 'Your profiles', how: 'hand',
    blurb: 'One per place you can put a link on a profile. Copy it and paste it into the bio.',
  },
  book: {
    title: 'Booking a call', how: 'hand',
    blurb: 'The calendar links on the show page. Two, because the free show and the paid '
      + 'sessions are different offers and it is worth knowing which one people want.',
  },
  episode: {
    title: 'Episodes', how: 'auto',
    blurb: 'One per YouTube video, written into its description automatically. A click says '
      + 'which episode pulled it — the one thing YouTube reports nowhere outside Studio.',
  },
  clip: {
    title: 'Posts', how: 'auto',
    blurb: 'One per post per platform, minted when a clip goes out.',
  },
};

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
  shares = [], campaign = '', page = 1, size = 50, total = 0, params = '' }) {
  const short = (code) => `https://${host}/${code}`;
  // queue/2026-08-21-dont-call-your-brother.mp4 -> dont-call-your-brother
  const clipName = (key) => (key || '').replace(/^.*\//, '').replace(/\.[a-z0-9]+$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '') || null;

  const meta = (name) => CAMPAIGNS[name] || null;
  const tagFor = (name) => {
    const m = meta(name);
    if (!m) return '';
    return `<span class="how ${m.how}">${m.how === 'auto' ? 'automatic' : 'you paste it'}</span>`;
  };

  const row = (l) => `<tr>
    <td class="code">
      <a href="${esc(short(l.code))}" target="_blank" rel="noopener">${esc(l.code)}</a>
      <button type="button" class="cp" data-t="${esc(short(l.code))}" title="Copy the whole link">copy</button>
    </td>
    <td>${l.campaign
      ? `<a href="/links?campaign=${encodeURIComponent(l.campaign)}">${esc((meta(l.campaign) || {}).title || l.campaign)}</a>`
      : '<span class="faint">—</span>'}</td>
    <td class="faint">${esc(l.platform || '—')}</td>
    <td class="faint">${esc(l.medium || '—')}</td>
    <td class="clip">${l.q_id
      ? `<span title="${esc(l.q_body || '')}">${esc(clipName(l.q_media) || l.q_id)}</span>`
      : (l.label ? `<span class="lbl">${esc(String(l.label).slice(0, 46))}</span>`
        : '<span class="faint">—</span>')}</td>
    <td class="num ${l.human ? 'good' : ''}">${l.human || 0}</td>
    <td class="num faint">${l.crawler || 0}</td>
    <td class="tgt"><a href="${esc(l.target)}" target="_blank" rel="noopener">${esc(l.target)}</a>
      ${l.note ? `<span class="nt">${esc(l.note)}</span>` : ''}</td>
    <td class="faint nowrap">${esc(ago(l.created_at))}</td>
  </tr>`;

  const opts = (list, sel) => ['-', ...list]
    .map((v) => `<option${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');

  const here = meta(campaign);

  const body = `
<h1>Links</h1>
<p class="lede">Every short code, what it was for, and how many people actually followed it.
Mint one here for anything you paste somewhere yourself — a bio, a newsletter, a talk.</p>

<div class="card idea"><div class="card-body">
  <b>Nothing is added to the address.</b> The code itself carries where it lives, the spot it sits
  in, and what it is for — so there is no <code>?utm_source=</code>, no cookie and no banner. The
  same page linked from two places is two codes, or "which one earned this" has no answer.
  <br><br>
  And because the destination is <b>stored</b> rather than written into the link, anything can be
  repointed later — <b>a bio you set once never has to be edited again.</b>
</div></div>

<div class="tiles">
  ${tile(totals.links, 'links', 'plain')}
  ${tile(totals.human, 'clicks', totals.human ? 'ok' : 'plain', 'people, not crawlers')}
  ${tile(totals.crawler, 'preview fetches', 'plain', 'never counted')}
  ${tile(campaigns.length, 'campaigns', 'plain')}
</div>

${minted ? `<div class="card okbox"><div class="card-body">
  <b>Minted.</b> <code class="big">${esc(short(minted))}</code>
  <button type="button" class="cp big" data-t="${esc(short(minted))}">copy</button>
</div></div>` : ''}
${err ? `<div class="card badbox"><div class="card-body"><b>Not minted.</b> ${esc(err)}</div></div>` : ''}

${card('What the links are for', campaigns.length ? `<div class="wrap"><table>
  <thead><tr><th>what for</th><th></th><th class="num">links</th><th class="num">clicks</th>
    <th class="num">crawlers</th></tr></thead>
  <tbody>${campaigns.map((c) => {
    const m = meta(c.campaign);
    return `<tr>
    <td><a href="/links?campaign=${encodeURIComponent(c.campaign)}">${esc((m || {}).title || c.campaign)}</a>
      ${tagFor(c.campaign)}
      ${m ? `<span class="nt">${esc(m.blurb)}</span>` : ''}</td>
    <td class="faint mono">${esc(c.campaign)}</td>
    <td class="num">${c.links}</td><td class="num ${c.human ? 'good' : ''}">${c.human || 0}</td>
    <td class="num faint">${c.crawler || 0}</td></tr>`;
  }).join('')}</tbody></table></div>`
  : '<p class="empty">Nothing carries a campaign yet — everything minted before 22 August predates the field.</p>')}

${card('Sharing it with someone yourself', `
<p class="ctx">Put their name on the end of any link and it counts separately. Nothing to mint,
  nothing to set up — type it as you send it.</p>
<pre class="egs">https://${esc(host)}/&lt;code&gt;/<b>natalie</b>
https://${esc(host)}/&lt;code&gt;/<b>tom</b>
https://${esc(host)}/&lt;code&gt;/<b>book-club</b></pre>
<p class="ctx">Accents and spaces are fine — <code>Ödön</code> becomes <code>odon</code>,
  <code>Book Club</code> becomes <code>book-club</code>. A name it cannot read is simply not
  recorded and the link still works.</p>
${shares.length ? `<div class="wrap"><table>
  <thead><tr><th>Who you sent it to</th><th class="n">Opened</th><th>Last</th></tr></thead>
  <tbody>${shares.map((r) => `<tr>
    <td><b>${esc(r.tag)}</b></td>
    <td class="n">${r.clicks}</td>
    <td class="faint">${esc(ago(r.last_at))}</td></tr>`).join('')}</tbody></table></div>
<p class="note">Real opens only — a messenger fetches the link to draw its preview the moment you
  send it, and those are not counted. It tells you the link labelled <i>natalie</i> was opened,
  not that Natalie opened it: links get forwarded.</p>`
  : '<p class="empty">Nobody has opened a personal link yet.</p>'}`)}

${card('Mint one', `
<form method="post" class="mintform">
  <input type="hidden" name="do" value="mint">
  <label class="wide">Where it goes
    <input name="target" type="url" placeholder="https://matewishkey.com/show" required></label>
  <label>What for <input name="campaign" list="campaigns" placeholder="bio"></label>
  <datalist id="campaigns">${campaigns.map((c) => `<option>${esc(c.campaign)}</option>`).join('')}</datalist>
  <label>Where it lives <select name="platform">${opts(SOURCES, '-')}</select></label>
  <label>The spot <select name="medium">${opts(MEDIUMS, '-')}</select></label>
  <label class="wide">Note to self <input name="note" placeholder="X bio, from 22 Aug"></label>
  <div><button class="primary">Mint it</button></div>
</form>`)}

${card(here ? `${esc(here.title)} (${total})` : campaign ? `Links in "${esc(campaign)}" (${total})`
  : `All links (${total})`, `
${here ? `<p class="ctx">${esc(here.blurb)} ${tagFor(campaign)}</p>` : ''}
<div class="filters">
  <a href="/links" class="${campaign ? '' : 'on'}">all</a>
  ${campaigns.map((c) => `<a href="/links?campaign=${encodeURIComponent(c.campaign)}"
    class="${campaign === c.campaign ? 'on' : ''}">${esc((meta(c.campaign) || {}).title || c.campaign)} ${c.links}</a>`).join('')}
</div>
<div class="wrap"><table>
  <thead><tr><th>code</th><th>what for</th><th>where it lives</th><th>the spot</th>
    <th>which clip</th><th class="num">clicks</th><th class="num">bots</th>
    <th>goes to</th><th>minted</th></tr></thead>
  <tbody>${rows.length ? rows.map(row).join('')
    : '<tr><td colspan="9" class="empty">Nothing here.</td></tr>'}</tbody>
</table></div>
${pager({ path: '/links', params, page, size, total, noun: 'links' })}`)}

<style>
.okbox { border-color:var(--ok); } .badbox { border-color:var(--bad); }
.idea { border-left:3px solid var(--accent); }
.idea code { background:var(--bg); padding:.1rem .35rem; border-radius:4px; border:1px solid var(--line); }
.egs { background:var(--bg); border:1px solid var(--line); border-radius:8px;
  padding:.7rem .8rem; font-size:.85rem; margin:.6rem 0; overflow-x:auto; }
.egs b { color:var(--accent, #f0524a); }
.mintform { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:.7rem; align-items:end; }
.mintform label { display:flex; flex-direction:column; gap:.25rem; font-size:.76rem;
  text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.mintform label.wide { grid-column:1/-1; }
.mintform input, .mintform select { font:inherit; font-size:.9rem; padding:.45rem .55rem;
  border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--fg); }
td.code { white-space:nowrap; }
td.code a { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-weight:600; }
td.num { text-align:right; font-variant-numeric:tabular-nums; }
td.num.good { color:var(--ok); font-weight:600; }
td.tgt { max-width:24rem; }
td.clip { font-size:.8rem; max-width:13rem; }
td.tgt a { word-break:break-all; font-size:.82rem; }
.nt { display:block; font-size:.74rem; color:var(--faint); }
.lbl { color:var(--muted); }
.mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.78rem; }
.ctx { color:var(--muted); font-size:.87rem; margin:0 0 .8rem; }
.how { display:inline-block; font-size:.63rem; text-transform:uppercase; letter-spacing:.07em;
  font-weight:700; padding:.1rem .45rem; border-radius:999px; border:1px solid; margin-left:.4rem;
  vertical-align:middle; }
.how.auto { color:var(--accent); border-color:var(--accent); }
.how.hand { color:var(--warn); border-color:var(--warn); }
code.big { font-size:1rem; font-weight:600; }
button.cp { font:inherit; font-size:.72rem; margin-left:.45rem; padding:.12rem .5rem;
  border:1px solid var(--line); border-radius:5px; background:var(--bg); color:var(--muted);
  cursor:pointer; vertical-align:middle; }
button.cp:hover { color:var(--fg); border-color:var(--accent); }
button.cp.ok { color:var(--ok); border-color:var(--ok); }
button.cp.big { font-size:.8rem; padding:.2rem .7rem; }
</style>
<script>
document.querySelectorAll('button.cp').forEach(function (b) {
  b.addEventListener('click', function () {
    var t = b.dataset.t;
    function ok() {
      b.textContent = 'copied'; b.classList.add('ok');
      setTimeout(function () { b.textContent = 'copy'; b.classList.remove('ok'); }, 1500);
    }
    function fb() {
      var a = document.createElement('textarea'); a.value = t;
      a.style.position = 'fixed'; a.style.opacity = '0';
      document.body.appendChild(a); a.select();
      try { document.execCommand('copy'); ok(); } catch (e) { b.textContent = 'failed'; }
      document.body.removeChild(a);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(t).then(ok, fb);
    } else { fb(); }
  });
});
</script>`;

  return layout({ title: 'Links', path: '/links', email, tz, body, wide: true });
}
