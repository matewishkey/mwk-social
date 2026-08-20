/*
 * Stats, for a channel this size.
 *
 * The opinion baked in here, because it is the whole reason the page looks like
 * this: at our follower counts, followers are not the scoreboard. Five things
 * are worth watching, in this order —
 *
 *   1. reach / views      did anyone see it
 *   2. engagement rate    did anyone care (normalised, so it survives growth)
 *   3. link clicks        the only number tied to the actual goal, guest sign-ups
 *   4. cadence            posts per week — the biggest lever we fully control
 *   5. follower growth    last, and only where there is a base to grow
 *
 * Each channel card shows ONLY the metrics that channel genuinely returns,
 * read from the platform table. A grid of structural zeros looks like failure
 * when it is really just an API that does not report that number.
 */
import { esc, card, tile, layout, num, ago } from '../lib/html.js';

const WINDOW_DAYS = 30;

/** A bar chart, inline SVG, no library — the CSP forbids one anyway. */
function bars(series, { height = 54, label = '' } = {}) {
  if (!series.length) return '<p class="empty">Nothing yet.</p>';
  const max = Math.max(...series.map((d) => d.value), 1);
  const w = 100 / series.length;
  return `<svg class="bars" viewBox="0 0 100 ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
    ${series.map((d, i) => {
      const h = Math.max((d.value / max) * (height - 2), d.value > 0 ? 1 : 0);
      return `<rect x="${(i * w).toFixed(2)}" y="${(height - h).toFixed(2)}"
        width="${(w * 0.72).toFixed(2)}" height="${h.toFixed(2)}" rx="0.6"><title>${esc(d.label)}: ${d.value}</title></rect>`;
    }).join('')}
  </svg>`;
}

const RATE = (m) => {
  const seen = m.reach || m.impressions || m.views || 0;
  const acts = (m.likes || 0) + (m.comments || 0) + (m.shares || 0) + (m.saves || 0);
  return seen ? (acts / seen) * 100 : null;
};

export function statsPage({ email, tz, daily, followers, clicks, snapshots, days = WINDOW_DAYS }) {
  const platformTable = ((snapshots.platforms || {}).body || {}).flows || [];
  const metricsFor = Object.fromEntries(platformTable.map((f) => [f.platform, (f.capabilities || {}).metrics || {}]));

  // ---- roll the window up ------------------------------------------------
  const byPlatform = {};
  const byDate = {};
  for (const r of daily) {
    const p = (byPlatform[r.platform] ||= { platform: r.platform, posts: 0, reach: 0, impressions: 0,
      views: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0 });
    for (const k of ['reach', 'impressions', 'views', 'likes', 'comments', 'shares', 'saves', 'clicks']) p[k] += r[k] || 0;
    p.posts += r.post_count || 0;
    const d = (byDate[r.date] ||= { reach: 0, views: 0, posts: 0 });
    d.reach += r.reach || r.impressions || 0;
    d.views += r.views || 0;
    d.posts += r.post_count || 0;
  }

  const dates = Object.keys(byDate).sort();
  const totals = Object.values(byPlatform).reduce((a, p) => {
    for (const k of ['posts', 'reach', 'impressions', 'views', 'likes', 'comments', 'shares', 'saves']) a[k] = (a[k] || 0) + p[k];
    return a;
  }, {});
  const rate = RATE(totals);
  const weeks = Math.max(dates.length / 7, 1);
  const cadence = totals.posts ? totals.posts / weeks : 0;
  const totalClicks = clicks.reduce((a, c) => a + c.n, 0);

  // ---- per-channel cards -------------------------------------------------
  const ORDER = ['facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'threads', 'twitter'];
  const channels = Object.values(byPlatform)
    .sort((a, b) => ORDER.indexOf(a.platform) - ORDER.indexOf(b.platform))
    .map((p) => {
      const shown = metricsFor[p.platform] || {};
      const rows = [
        ['posts', p.posts, 'yes'],
        ['reach', p.reach, shown.reach],
        ['impressions', p.impressions, shown.impressions],
        ['views', p.views, shown.views],
        ['likes', p.likes, shown.likes],
        ['comments', p.comments, shown.comments],
        ['shares', p.shares, shown.shares],
        ['saves', p.saves, shown.saves],
      ].filter(([, , avail]) => avail && avail !== 'no');
      const r = RATE(p);
      return `<section class="card"><header>
          <h2>${esc(p.platform)}</h2>
          ${r == null ? '' : `<span class="pill ${r >= 5 ? 'p-ok' : r >= 2 ? 'p-warn' : 'p-plain'}">${r.toFixed(1)}% engaged</span>`}
        </header><div class="card-body">
          <dl class="kv">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(num(v))}</dd></div>`).join('')}</dl>
          ${Object.values(shown).every((v) => v === 'no') ? '' : ''}
          <p class="note">${esc(unreported(shown))}</p>
        </div></section>`;
    }).join('');

  // ---- followers, only where there is a base -----------------------------
  const withBase = followers.filter((f) => (f.followers || 0) >= 10)
    .sort((a, b) => b.followers - a.followers);
  const tiny = followers.filter((f) => (f.followers || 0) < 10);

  const clickRows = clicks.length ? `<table>
    <thead><tr><th>channel</th><th class="num">clicks</th></tr></thead>
    <tbody>${clicks.map((c) => `<tr><td>${esc(c.platform || 'unattributed')}</td>
      <td class="num">${c.n}</td></tr>`).join('')}</tbody></table>`
    : `<p class="empty">No short links have been clicked yet — or none have been minted.
       Until they are, no platform except Facebook reports clicks at all, so the call
       to action has no scoreboard.</p>`;

  const body = `
<h1>Stats</h1>
<p class="lede">Last ${dates.length || days} days${dates.length ? `, ${esc(dates[0])} to ${esc(dates[dates.length - 1])}` : ''}.</p>

<div class="tiles">
  ${tile(num(totals.reach || totals.impressions || 0), 'people reached', 'plain', 'did anyone see it')}
  ${tile(num(totals.views || 0), 'video views', 'plain')}
  ${tile(rate == null ? '—' : `${rate.toFixed(1)}%`, 'engagement rate',
    rate == null ? 'plain' : rate >= 5 ? 'ok' : rate >= 2 ? 'warn' : 'bad', 'did anyone care')}
  ${tile(totalClicks, 'link clicks', totalClicks ? 'ok' : 'plain', 'sign-up CTA')}
  ${tile(cadence.toFixed(1), 'posts a week', cadence >= 5 ? 'ok' : cadence >= 2 ? 'warn' : 'bad', 'the lever we control')}
</div>

${card('Reach by day', bars(dates.map((d) => ({ label: d, value: byDate[d].reach })), { label: 'reach by day' })
  + `<div class="axis"><span>${esc(dates[0] || '')}</span><span>${esc(dates[dates.length - 1] || '')}</span></div>`)}

<h2 class="sec">By channel</h2>
<div class="chgrid">${channels || '<div class="card"><div class="card-body empty">No metrics shipped yet.</div></div>'}</div>

<div class="two">
  ${card('Link clicks', clickRows)}
  ${card('Followers', withBase.length ? `<table>
      <thead><tr><th>channel</th><th></th><th class="num">followers</th></tr></thead>
      <tbody>${withBase.map((f) => `<tr>
        <td>${esc(f.platform)}</td><td class="faint">${esc(f.username || '')}</td>
        <td class="num">${esc(num(f.followers))}</td></tr>`).join('')}</tbody></table>
    ${tiny.length ? `<p class="note">${tiny.length} other ${tiny.length === 1 ? 'channel is' : 'channels are'} still
      under ten followers (${esc(tiny.map((t) => t.platform).join(', '))}) — too small for a trend to mean anything,
      so they are left off deliberately rather than drawn as flat lines.</p>` : ''}`
    : '<p class="empty">No follower counts shipped yet.</p>')}
</div>

<style>
.sec { font-size:.82rem; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); margin:1.6rem 0 .8rem; }
.chgrid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:1.1rem; }
.chgrid .card { margin:0; }
.two { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:1.1rem; margin-top:1.1rem; }
.two .card { margin:0; }
.bars { width:100%; height:74px; display:block; }
.bars rect { fill:var(--accent); opacity:.75; }
.axis { display:flex; justify-content:space-between; font-size:.72rem; color:var(--faint); margin-top:.3rem; }
.kv { display:grid; grid-template-columns:1fr auto; gap:0; margin:0; font-size:.86rem; }
.kv > div { display:contents; }
.kv dt { color:var(--muted); padding:.2rem 0; }
.kv dd { margin:0; padding:.2rem 0; text-align:right; font-variant-numeric:tabular-nums; font-weight:600; }
</style>`;

  return layout({ title: 'Stats', path: '/stats', email, tz, body, wide: true });
}

/** Name what this platform does NOT report, so a missing row reads as an API limit. */
function unreported(metrics) {
  const missing = Object.entries(metrics).filter(([, v]) => v === 'no').map(([k]) => k);
  if (!missing.length) return '';
  return `Not reported here: ${missing.join(', ')}.`;
}
