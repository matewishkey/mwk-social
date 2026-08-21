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

export function statsPage({ email, tz, daily, followers, clicks, snapshots,
  targets = [], split = [], links = 0, days = WINDOW_DAYS }) {
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

  /*
   * Cadence is DAYS WE POSTED, not posts. daily_metric is one row per platform,
   * so summing post_count counts a single clip four times over if it went to
   * four platforms — which read as "30 posts a week" off two weeks of data.
   * Days-we-posted is unambiguous, and it is the lever that is actually ours.
   *
   * The divisor is the real span, first date to last, not the number of dates
   * carrying data: a day with no post is still a day that went by.
   */
  const spanDays = dates.length
    ? Math.max(Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86400_000) + 1, 1)
    : 0;
  const postedOn = dates.filter((d) => byDate[d].posts > 0).length;
  const cadence = spanDays ? postedOn / (spanDays / 7) : 0;
  const totalClicks = clicks.reduce((a, c) => a + c.n, 0);
  const bySplit = Object.fromEntries(split.map((r) => [r.bot, r.n]));
  const human = bySplit[0] || 0;
  const crawler = bySplit[1] || 0;
  const unknown = bySplit[2] || 0;

  // A short, readable name for a destination — the whole url is noise in a table.
  const label = (url) => {
    try {
      const u = new URL(url);
      if (u.hostname.includes('matewishkey.com') && u.pathname.startsWith('/show')) return 'the sign-up page';
      if (u.hostname.includes('github.com')) return `the repo${u.pathname.split('/')[2] ? ` · ${u.pathname.split('/')[2]}` : ''}`;
      if (u.hostname.includes('youtube') || u.hostname.includes('youtu.be')) return 'a video on YouTube';
      return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname);
    } catch { return url; }
  };

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

  const clickRows = human ? `<table>
    <thead><tr><th>channel</th><th class="num">clicks</th></tr></thead>
    <tbody>${clicks.map((c) => `<tr><td>${esc(c.platform || 'unattributed')}</td>
      <td class="num">${c.n}</td></tr>`).join('')}</tbody></table>`
    : `<p class="empty">${crawler || unknown
      ? 'Nothing here is a person yet — see the breakdown opposite.'
      : `No short links have been clicked yet${links ? '' : ', and none have been minted'}.`}
       Only Facebook reports clicks natively, so away from it these links are the whole scoreboard.</p>`;

  const targetRows = targets.length ? `<table>
    <thead><tr><th>they clicked</th><th class="num">clicks</th></tr></thead>
    <tbody>${targets.map((t) => `<tr>
      <td>${esc(label(t.target))}<div class="faint" style="font-size:.72rem">${esc(t.target.slice(0, 62))}</div></td>
      <td class="num">${t.n}</td></tr>`).join('')}</tbody></table>`
    : '<p class="empty">Nothing clicked yet.</p>';

  const splitCard = (crawler || unknown || human) ? `
    <table>
      <thead><tr><th>traffic</th><th class="num">hits</th></tr></thead>
      <tbody>
        <tr><td><span class="pill p-ok">counted</span> looked like a person</td><td class="num">${human}</td></tr>
        <tr><td><span class="pill p-plain">ignored</span> link-preview crawler</td><td class="num">${crawler}</td></tr>
        ${unknown ? `<tr><td><span class="pill p-warn">ignored</span> logged before this was measured</td>
          <td class="num">${unknown}</td></tr>` : ''}
      </tbody>
    </table>
    <p class="note">A platform fetches a link to build its preview card, and every fetch hits the
      redirect. The User-Agent is read to decide and then discarded — nothing about a visitor is
      stored, only whether the hit counted.${unknown ? ` The ${unknown} unknown were recorded before
      that existed; calling them people would be a guess.` : ''}</p>`
    : '<p class="empty">No traffic yet.</p>';

  const body = `
<h1>Stats</h1>
<p class="lede">Last ${spanDays || days} days${dates.length ? `, ${esc(dates[0])} to ${esc(dates[dates.length - 1])}` : ''}.</p>

<div class="tiles">
  ${tile(num(totals.reach || totals.impressions || 0), 'people reached', 'plain', 'did anyone see it')}
  ${tile(num(totals.views || 0), 'video views', 'plain')}
  ${tile(rate == null ? '—' : `${rate.toFixed(1)}%`, 'engagement rate',
    rate == null ? 'plain' : rate >= 5 ? 'ok' : rate >= 2 ? 'warn' : 'bad', 'did anyone care')}
  ${tile(human, 'link clicks', human ? 'ok' : 'plain',
    crawler || unknown ? `${crawler + unknown} not counted` : 'people, not crawlers')}
  ${tile(cadence.toFixed(1), 'days a week we post', cadence >= 5 ? 'ok' : cadence >= 3 ? 'warn' : 'bad', 'the lever we control')}
</div>

${card('Reach by day', bars(dates.map((d) => ({ label: d, value: byDate[d].reach })), { label: 'reach by day' })
  + `<div class="axis"><span>${esc(dates[0] || '')}</span><span>${esc(dates[dates.length - 1] || '')}</span></div>`)}

<h2 class="sec">By channel</h2>
<div class="chgrid">${channels || '<div class="card"><div class="card-body empty">No metrics shipped yet.</div></div>'}</div>

<div class="two">
  ${card('Clicks by channel', clickRows)}
  ${card('What they clicked', targetRows)}
</div>

<div class="two">
  ${card('What counted, and what did not', splitCard)}
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
