/*
 * Stats, for a channel this size.
 *
 * The opinion baked in here: at our follower counts, followers are not the
 * scoreboard. What is worth watching is whether posts are seen, whether anyone
 * reacts, whether anyone clicks, and whether any of it reaches his two sites,
 * each against its own usual week. Since 2026-09-25 that is five tabs (design
 * 07, the page section at the bottom of this file); what every series means is
 * lib/weekly.js's header, and the chart grammar is lib/charts.js's.
 *
 * ---------------------------------------------------------------------------
 * TRENDS (2026-08-25). A level with no previous level beside it is not a
 * finding — "381 people reached" answers nothing on its own. Everything here
 * now carries a direction, and the three ways that direction can lie are each
 * closed deliberately, because every one of them lies in the flattering
 * direction:
 *
 *   1. TODAY IS NOT A DAY YET. Every week is seven COMPLETE days, the newest
 *      ending yesterday, set against the four weeks before it. Putting a
 *      morning against seven full days draws a collapse that is only the clock.
 *      (Zernio's dates are UTC days and so is the Worker's clock, so the two
 *      agree on where the boundary is; the Brisbane display never enters it.)
 *
 *   2. A CHANNEL THAT DID NOT EXIST CANNOT HAVE GROWN. TikTok's first row is
 *      17 Aug; counted from before that, it reads as several hundred percent
 *      up for doing nothing new. Its earlier weeks are gaps, not zeros, and
 *      with fewer than two real usual weeks there is no baseline at all.
 *
 *   3. CONNECTING AN ACCOUNT IS NOT GROWTH, and this is the one that would have
 *      been believed. A third LinkedIn account was connected on 22 Aug carrying
 *      5,040 followers: a summed total jumps +5,043 overnight and reads as the
 *      best week the show has ever had. Follower movement is therefore computed
 *      PER ACCOUNT, and the total only counts accounts present from the first
 *      reading, with the ones that joined in between named rather than
 *      quietly folded in.
 *
 * The rule under all three: when the data cannot answer the question, the page
 * says so. It never draws an arrow it has not earned.
 */
import { esc, layout, num, when } from '../lib/html.js';
import { platformFromReferer } from '../links.js';
import { trendChart, metricCard, journeyFlow, hbars, chip, dayShort, CHART_CSS } from '../lib/charts.js';
import { baseline, status, per100, THIS } from '../lib/weekly.js';

/*
 * OUR OWN HANDS COME OFF THE SCOREBOARD (mate, 2026-09-20: "remove our shares,
 * so when I reshare or like with my normal account... or if it is not possible
 * just deduct always 2 likes and 2 reshares from every post, that is a safe way").
 *
 * It is not possible the honest way: no platform's analytics say WHO liked or
 * shared, so his own like and repost from his personal account are
 * indistinguishable from a stranger's. So it is the flat deduction he named,
 * applied per platform-post to every row before anything on this page adds
 * them up: the weekly series, the journey and the latest-posts table all
 * inherit it. Clamped at zero: a post nobody but him
 * touched reads 0, never negative.
 *
 * OUR FIRST COMMENT COMES OFF TOO (2026-09-23). This header used to say the
 * comments number was "explained as including our own first comment where it
 * is shown" — nothing on the page said so, and on almost every platform
 * comments equalled posts, so the tile was our own CTA counted back as
 * engagement. One per post, on the platforms the watcher comments on; a test
 * pins this list to platforms.commentWatched().
 */
export const OWN_ACTIONS = { likes: 2, shares: 2 };
export const OWN_COMMENT_PLATFORMS = ['facebook', 'instagram', 'linkedin', 'threads', 'youtube'];
export function withoutOwnActions(rows) {
  return rows.map((r) => {
    const posts = r.post_count || 0;
    if (!posts) return r;
    const out = { ...r };
    for (const k of Object.keys(OWN_ACTIONS)) {
      if (out[k] == null) continue;
      out[k] = Math.max(0, out[k] - OWN_ACTIONS[k] * posts);
    }
    if (out.comments != null && OWN_COMMENT_PLATFORMS.includes(r.platform)) {
      out.comments = Math.max(0, out.comments - posts);
    }
    return out;
  });
}

/*
 * THE DAY YOUTUBE CHANGED WHAT A VIEW IS.
 *
 * Per YouTube's own Help Centre, from 24 August 2026 a view is counted the
 * moment playback begins, on every format — long-form previously needed real
 * watch time (Shorts had already moved in March 2025). So a views trend whose
 * older window opens before that date compares old-unit days against new-unit
 * days, and the newer side is inflated by definition.
 *
 * No step change is visible in our own data, but the volume is far too low for
 * one to show — that is an absence of evidence, not evidence of absence, and
 * it is exactly the reasoning this page exists to refuse.
 *
 * On the tabbed page (2026-09-25) the chart is still drawn and says so: a
 * "seen" chart whose usual weeks reach back before that date, with YouTube in
 * them, carries one line naming it. Refusing the whole chart would have hidden
 * every other platform's weeks to protect one.
 */
export const YT_VIEW_UNIT_CHANGED = '2026-08-24';

/*
 * THE LATEST POSTS, ONE ROW EACH (2026-09-24) — the question asked most ("how
 * is the last post doing") and the one no per-day table could answer.
 *
 * Per platform, what it was SEEN by (views where the platform reports them,
 * impressions otherwise) and what people DID, with our own hands taken off the
 * same way as everywhere else on this page (withoutOwnActions). The age is on
 * every row because a 6-hour-old post and a 3-day-old one are not comparable,
 * and nothing here pretends they are. Clicks are counted people, show and
 * course apart. The snapshot is built on the box (ship-stats.js latestPosts).
 */
/*
 * BY FORMAT (2026-09-24, mate: "I do not see any stats about reels shorts
 * etc... for youtube for example"). A Short and a three-hour live stream were
 * one YouTube number. Per post, because the counts differ wildly between
 * formats and a total would just rank whichever we made most of. Built on the
 * box (ship-stats.js formatTable), where yt-dlp can tell a Short from a stream.
 */
const FORMAT_NAME = { short: 'Shorts', live: 'Live streams', video: 'Videos', reel: 'Reels',
  image: 'Images', carousel: 'Carousels', text: 'Text posts', unknown: 'Not known yet' };
export function formatCard({ formats = null }) {
  const rows = (formats && formats.rows) || [];
  if (!rows.length) return '<p class="empty">No posts shipped yet.</p>';
  const order = POST_COLUMNS;
  const byPlatform = [...new Set(rows.map((r) => r.platform))]
    .sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
  const body = byPlatform.map((platform) => rows.filter((r) => r.platform === platform)
    .sort((a, b) => b.posts - a.posts)
    .map((r, i) => {
      const [net] = withoutOwnActions([{ ...r, post_count: r.posts }]);
      const seen = r.views || r.impressions || 0;
      const did = (net.likes || 0) + (net.comments || 0) + (net.shares || 0) + (net.saves || 0);
      return `<tr>
        <td class="nowrap">${i === 0 ? `<b>${esc(platform === 'twitter' ? 'x' : platform)}</b>` : ''}</td>
        <td>${esc(FORMAT_NAME[r.format] || r.format)}</td>
        <td class="num">${r.posts}</td>
        <td class="num"><b>${esc(num(Math.round(seen / r.posts)))}</b></td>
        <td class="num">${(did / r.posts).toFixed(1)}</td>
        <td class="trunc">${r.best && r.best.seen ? `${esc(num(r.best.seen))} <span class="faint">${esc(r.best.title || '')}</span>` : '<span class="faint">—</span>'}</td>
      </tr>`;
    }).join('')).join('');
  return `<div class="wrap"><table>
    <thead><tr><th>platform</th><th>format</th><th class="num">posts</th><th class="num">seen per post</th>
      <th class="num">did per post</th><th>best</th></tr></thead>
    <tbody>${body}</tbody></table></div>
  <p class="note">Last ${formats.days} days. Per post, so a format we post a lot does not win by count.
    YouTube does not say which videos are Shorts, so each one is checked once and remembered.</p>`;
}

const SEARCH_ENGINE = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yandex\.[a-z]+|ecosia\.org|search\.brave\.com)$/;
const SOURCE_NAME = { facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads', linkedin: 'LinkedIn',
  youtube: 'YouTube', tiktok: 'TikTok', twitter: 'X' };
/*
 * Where a visit says it came from. `null` means one of his own tools on a
 * subdomain (the editor, this dashboard), which is left out rather than
 * called a source.
 */
export function sourceOf(referer, hosts) {
  const h = String(referer || '').toLowerCase();
  if (!h) return 'no referrer';
  const social = platformFromReferer(h);
  if (social) return SOURCE_NAME[social] || social;
  if (SEARCH_ENGINE.test(h)) return 'search engines';
  for (const site of hosts) {
    if (h === site || h === `www.${site}`) return site;
    if (h.endsWith(`.${site}`)) return null;
  }
  return h;
}

export function sourcesCard({ sites = null }) {
  const list = (sites && sites.sites) || [];
  if (!list.length) return '<p class="empty">No website visits shipped yet.</p>';
  const hosts = list.map((x) => x.host);
  const blocks = list.map((x) => {
    const by = new Map();
    for (const r of x.referrers || []) {
      const name = sourceOf(r.host, hosts);
      if (name === null || name === x.host) continue;
      by.set(name, (by.get(name) || 0) + r.visits);
    }
    const rows = [...by].sort((a, b) => b[1] - a[1]).map(([name, v]) => ({ name, v }));
    return `<div><h4 class="sec">${esc(x.host)}</h4>${rows.length ? hbars(rows, { approx: true }) : '<p class="empty">Nothing yet.</p>'}</div>`;
  }).join('');
  return `<div class="tracks">${blocks}</div>
  <p class="cap">Last 28 days, estimates. "No referrer" is most of it and is not one thing:
    a typed address, a bookmark, and nearly every tap inside the Instagram, TikTok and Facebook apps look alike.</p>`;
}

export const POST_COLUMNS = ['facebook', 'tiktok', 'youtube', 'instagram', 'linkedin', 'threads', 'twitter', 'pinterest'];
const postKey = (t) => String(t || '').split('\n')[0].split(/\s[#@]/)[0].trim().toLowerCase().slice(0, 40);
const ageOf = (iso, now) => {
  const h = (now - new Date(iso).getTime()) / 3600_000;
  return h < 48 ? `${Math.max(0, Math.round(h))}h old` : `${Math.round(h / 24)} days old`;
};
export function latestPostsCard({ posts = [], postClicks = [], tz, now = Date.now() }) {
  if (!posts.length) return '<p class="empty">No posts shipped yet.</p>';
  const clicksBy = new Map();
  for (const r of postClicks) {
    const k = postKey(r.body);
    const c = clicksBy.get(k) || { show: 0, course: 0 };
    clicksBy.set(k, { show: c.show + (r.show || 0), course: c.course + (r.course || 0) });
  }
  const cols = POST_COLUMNS.filter((pl) => posts.some((p) => p.platforms.some((x) => x.platform === pl)));
  const rows = posts.map((p) => {
    const by = {};
    for (const x of p.platforms) {
      const [net] = withoutOwnActions([{ ...x, post_count: 1 }]);
      const cur = by[x.platform] || { seen: 0, did: 0 };
      by[x.platform] = { seen: cur.seen + (x.views || x.impressions || 0),
        did: cur.did + (net.likes || 0) + (net.comments || 0) + (net.shares || 0) + (net.saves || 0) };
    }
    const total = Object.values(by).reduce((a, v) => a + v.seen, 0);
    const k = clicksBy.get(postKey(p.title)) || { show: 0, course: 0 };
    const best = Math.max(...Object.values(by).map((v) => v.seen), 0);
    return `<tr>
      <td class="post"><b>${esc(p.title)}</b><div class="faint den">${esc(when(p.publishedAt, tz))} · ${esc(ageOf(p.publishedAt, now))}</div></td>
      ${cols.map((pl) => {
        const v = by[pl];
        if (!v) return '<td class="num faint">—</td>';
        return `<td class="num${v.seen && v.seen === best ? ' top' : ''}">${esc(num(v.seen))}${v.did ? `<div class="faint den">${v.did} did</div>` : ''}</td>`;
      }).join('')}
      <td class="num"><b>${esc(num(total))}</b></td>
      <td class="num">${k.show || k.course ? `${k.show}${k.course ? ` <span class="faint">+ ${k.course} course</span>` : ''}` : '<span class="faint">0</span>'}</td>
    </tr>`;
  }).join('');
  return `<div class="wrap"><table class="posts">
    <thead><tr><th>post</th>${cols.map((pl) => `<th class="num">${esc(pl === 'twitter' ? 'x' : pl)}</th>`).join('')}
      <th class="num">seen</th><th class="num">clicks</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
  <p class="note">Seen = views, or impressions where a platform has no views. "did" = likes, comments,
    shares and saves, with our own like, share and first comment taken off. Numbers keep growing
    for days, so compare posts of the same age. Clicks are people on our links.</p>`;
}

/*
 * Exported so it can be tested against fixed dates. Testing it through the
 * rendered page cannot work: the windows are computed from today's clock, so
 * an assertion that the trend is refused would start failing on its own the
 * day the older window clears the boundary. A pure function and two dates is
 * stable for ever.
 */
export const viewsUnitBlocked = (from) =>
  (from < YT_VIEW_UNIT_CHANGED ? 'unit changed 24 Aug' : null);

/*
 * ---------------------------------------------------------------------------
 * THE PAGE (design 07, 2026-09-25: "we need tabs... I like the graph better
 * and not the text... the journey is great, but I need percentages and I need
 * baseline data"). Five tabs, charts first, one chart grammar everywhere
 * (lib/charts.js), every week against the four before it (lib/weekly.js):
 *
 *   Journey             seen -> reacted -> clicked -> on the site -> pressed
 *                       the booking button, with the rate on every step
 *   Trends              every count, 8 weeks, against its normal range
 *   Platforms           which platform turns attention into clicks
 *   Websites & Google   visits, where they came from, Search Console
 *   Posts               the latest posts, per platform
 */
const PNAME = { facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram',
  linkedin: 'LinkedIn', threads: 'Threads', twitter: 'X', pinterest: 'Pinterest' };
const pname = (p) => PNAME[p] || p;
const f1 = (v) => (v == null ? '—' : Number.isInteger(v) ? num(v) : (Math.round(v * 10) / 10).toLocaleString('en-US'));
const ageShort = (iso, now) => { const h = (now - new Date(iso).getTime()) / 3600_000;
  return h < 48 ? `${Math.max(0, Math.round(h))}h old` : `${Math.round(h / 24)} days old`; };

const TABS = [['journey', 'Journey'], ['trends', 'Trends'], ['platforms', 'Platforms'],
  ['websites', 'Websites & Google'], ['posts', 'Posts']];

const LEGEND = `<div class="legend" aria-label="How to read the charts">
<svg viewBox="0 0 150 30" aria-hidden="true"><rect class="band" x="0" y="6" width="150" height="18"/><line class="mean" x1="0" x2="150" y1="15" y2="15"/></svg>
<span><b>Band</b> = normal range of the 4 weeks before. <b>Dashed</b> = their average, "usual".</span>
<span class="lgd"><i class="d d-above"></i>above</span><span class="lgd"><i class="d d-inside"></i>normal</span>
<span class="lgd"><i class="d d-below"></i>below</span><span class="lgd"><i class="d d-inside ringd"></i>still growing</span></div>`;

/*
 * Below this many seen over eight weeks a platform's click rate is one click
 * either way: shown, but called what it is.
 */
export const RATE_MIN_SEEN = 200;

export function statsPage({ email, tz, snapshots = {}, w, course = [], siteLinks = [], followersNow = [], courseSite = null,
  followerHistory = [], accountSince = {}, postClicks = [], courseHost = null, linkHost = null, now = Date.now() }) {
  const { weeks, series: S, rates: R, byPlatform } = w;
  const bl = (s) => baseline(s);
  const this_ = `${dayShort(weeks[THIS].from)} to ${dayShort(weeks[THIS].to)}`;
  const usual = `${dayShort(weeks[THIS - 4].from)} to ${dayShort(weeks[THIS - 1].to)}`;
  const ytFlag = viewsUnitBlocked(weeks[THIS - 4].from)
    && (byPlatform.youtube && byPlatform.youtube.seen.slice(THIS - 4, THIS).some((v) => v))
    ? 'YouTube counted long videos differently before 24 Aug, so the older weeks read a little low.' : '';

  // ---- Journey ----------------------------------------------------------
  const stages = [
    { name: 'Seen', v: S.seen[THIS], sub: 'views or impressions', young: true },
    { name: 'Reacted', v: S.actions[THIS], sub: 'likes, comments, shares, saves', young: true },
    { name: 'Clicked', v: S.showClicks[THIS], sub: `${linkHost || 'show'} links, people` },
    { name: 'On the site', v: S.visitsShow[THIS], sub: `${w.showHost || 'site'} visits, estimate`, approx: true },
    { name: 'Pressed booking', v: S.bookingPresses[THIS], sub: 'buttons on /show' },
  ];
  const link = (key, label, share = false) => ({ v: R[key][THIS], bl: bl(R[key]), label, share, key });
  const links = [
    link('reactedPer100Seen', 'reactions per 100 seen'),
    link('clickedPer100Seen', 'clicks per 100 seen'),
    link('linksShareOfVisits', 'of site visits came from our links', true),
    link('pressesPer100Visits', 'booking presses per 100 visits'),
  ];
  const headline = stages.map((s, i) => {
    const series = [S.seen, S.actions, S.showClicks, S.visitsShow, S.bookingPresses][i];
    return `<div class="hl"><span class="l">${esc(s.name)}</span><b class="t-${status(s.v, bl(series))}">${s.approx ? '~' : ''}${esc(f1(s.v))}</b>${chip(s.v, bl(series))}</div>`;
  }).join('');
  const rateCards = [...links, { ...link('googleClickPer100Shown', 'clicks per 100 times shown in Google'), step: 'From Google, to the site' }]
    .map((l, i) => {
      const b = l.bl;
      const step = l.step || `${stages[i].name} to ${stages[i + 1].name.toLowerCase()}`;
      return `<div class="rc"><div class="rch"><span>${esc(step)}</span>${chip(l.v, b, { rate: true })}</div>
        ${trendChart(R[l.key], { spark: true })}
        <div class="rcf"><b class="t-${status(l.v, b)}">${l.v == null ? '—' : `${l.share ? '~' : ''}${f1(l.v)}${l.share ? '%' : ''}`}</b> ${esc(l.label)}
        ${b ? `<br><span class="faint">normal ${f1(b.min)} to ${f1(b.max)}, usual ${f1(b.mean)}</span>` : ''}</div></div>`;
    }).join('');

  const course30 = course.reduce((a, r) => a + (r.recent || 0), 0);
  const courseAllZero = S.courseClicks.every((v) => !v);
  const courseTrack = `<div class="box"><h3>The course track</h3><span class="sub">${esc(courseHost || 'piy.show')} links to ${esc(w.courseHost || 'the course site')}. Never added to the show.</span>
    <div class="tracks">
      <div><div class="big"><b>${esc(f1(course30))}</b><span class="sub">course link clicks, last 30 days</span></div>
        ${courseAllZero && course30 ? '<p class="cap">Every full week is still 0: the course links are new, and their clicks are all this week so far.</p>' : trendChart(S.courseClicks, { spark: true })}</div>
      <div><div class="big"><b>${S.visitsCourse[THIS] == null ? '—' : `~${esc(f1(S.visitsCourse[THIS]))}`}</b><span class="sub">${esc(w.courseHost || 'course site')} visits this week, estimate</span></div>
        ${trendChart(S.visitsCourse, { spark: true, approx: true })}</div>
    </div></div>`;

  const journey = `${LEGEND}
  <div class="hls">${headline}</div>
  <div class="box"><h3>The show: from a post to the booking button</h3>
    <span class="sub">This week, ${esc(this_)}, against the usual week (${esc(usual)}). Rates divide two counts from the same week; they do not follow people.</span>
    ${journeyFlow({ stages, links })}
    <p class="cap">Booked a slot: not measured. Google's calendar reports nothing back.${ytFlag ? ` ${esc(ytFlag)}` : ''}</p>
    <div class="rcs">${rateCards}</div>
  </div>
  ${courseTrack}`;

  // ---- Trends -----------------------------------------------------------
  const mc = (o) => metricCard({ weeks, ...o });
  const trends = `${LEGEND}<div class="grid">
    ${mc({ title: 'Seen', sub: 'views or impressions, every platform', series: S.seen, young: true, note: ytFlag })}
    ${mc({ title: 'Reacted', sub: 'likes, comments, shares, saves', series: S.actions, young: true })}
    ${mc({ title: 'Posts', sub: 'one per platform', series: S.posts, young: true })}
    ${mc({ title: 'Show link clicks', sub: 'people', series: S.showClicks })}
    ${mc({ title: 'Booking button presses', sub: 'on /show', series: S.bookingPresses })}
    ${mc({ title: 'Course link clicks', sub: 'people', series: S.courseClicks })}
    ${mc({ title: 'Between the two sites', sub: 'the one link each way', series: S.siteLinkClicks })}
    ${mc({ title: 'Followers', sub: 'accounts connected from the start', series: S.followers })}
  </div>
  <p class="cap">Seen, reacted and posts count by the day a post went out, so the newest week is still growing. Clicks count by the day of the click.</p>`;

  // ---- Platforms ----------------------------------------------------------
  const plats = Object.keys(byPlatform);
  const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
  const ranked = plats.map((p) => { const d = byPlatform[p];
    const seen = sum(d.seen); const clicks = sum(d.showClicks);
    return { p, seen, clicks, reacted: sum(d.actions), rate: per100(clicks, seen) }; })
    .sort((a, b) => ((b.seen >= RATE_MIN_SEEN) - (a.seen >= RATE_MIN_SEEN)) || ((b.rate || 0) - (a.rate || 0)));
  // A platform seen fewer than RATE_MIN_SEEN times is listed, but gets no bar
  // and no place in the scale: one click on one impression is "100 per 100".
  const rated = ranked.filter((r) => r.seen >= RATE_MIN_SEEN);
  const tooSmall = ranked.filter((r) => r.seen < RATE_MIN_SEEN);
  const rankRows = hbars(rated.map((r) => ({ name: pname(r.p), v: r.rate || 0,
    cls: `s-${r.p}`, note: `${num(r.seen)} seen · ${r.clicks} click${r.clicks === 1 ? '' : 's'}` })),
  { fmt: (v) => (v ? f1(v) : '0') })
    + (tooSmall.length ? `<p class="cap">Too small to rate: ${esc(tooSmall.map((r) => `${pname(r.p)} (${num(r.seen)} seen, ${r.clicks} click${r.clicks === 1 ? '' : 's'})`).join(', '))}.</p>` : '');
  const platCards = plats.map((p) => { const d = byPlatform[p];
    const b = bl(d.seen);
    const mini = [['posts', d.posts], ['reactions', d.actions], ['clicks', d.showClicks]]
      .map(([l, s]) => `<span><b>${esc(f1(s[THIS]))}</b> ${l}</span>`).join('');
    return `<article class="mc"><header><h3>${esc(pname(p))}</h3><span class="sub">since ${esc(dayShort(d.since))}</span></header>
      <div class="big"><b class="t-${status(d.seen[THIS], b)}">${esc(f1(d.seen[THIS]))}</b><span class="sub">seen</span>${chip(d.seen[THIS], b)}<span class="grow">still growing</span></div>
      ${trendChart(d.seen, { weeks, young: true })}<div class="mss">${mini}</div></article>`; }).join('');

  // Followers per account: movement over the rendered history, and an account
  // connected part-way through is named, never counted as growth.
  const first = new Map(); const last = new Map();
  for (const f of followerHistory) {
    if (!first.has(f.account_id) || f.day < first.get(f.account_id).day) first.set(f.account_id, f);
    if (!last.has(f.account_id) || f.day > last.get(f.account_id).day) last.set(f.account_id, f);
  }
  const histStart = followerHistory.map((f) => f.day).sort()[0];
  const followerRows = followersNow.filter((a) => (a.followers || 0) >= 10).map((a) => {
    const f0 = first.get(a.account_id); const late = accountSince[a.account_id] && histStart && accountSince[a.account_id] > histStart;
    const g = f0 && !late ? (a.followers || 0) - (f0.followers || 0) : null;
    return { name: `${pname(a.platform)}, ${a.username}`, v: a.followers || 0, note: g == null ? 'connected later' : `${g >= 0 ? '+' : ''}${g} since ${dayShort(f0.day)}` };
  }).sort((a, b) => b.v - a.v);
  const small = followersNow.filter((a) => (a.followers || 0) < 10).map((a) => pname(a.platform));

  const platforms = `<div class="box"><h3>Which platform turns attention into clicks</h3>
    <span class="sub">Show link clicks per 100 seen, last 8 weeks. Each platform counts "seen" its own way, so read the order, not the gaps.</span>
    ${rankRows}</div>
  ${LEGEND}<div class="grid">${platCards}</div>
  <h3 class="sec">By format</h3><div class="box">${formatCard({ formats: (snapshots.formats || {}).body || null })}</div>
  <h3 class="sec">Followers by account</h3><div class="box">${followerRows.length ? hbars(followerRows) : '<p class="empty">No follower counts yet.</p>'}
    ${small.length ? `<p class="cap">Under ten followers, left off: ${esc(small.join(', '))}.</p>` : ''}</div>`;

  // ---- Websites & Google -------------------------------------------------
  const search = (snapshots.search || {}).body || null;
  const google = ((search && search.sites) || []).map((s) => {
    // A snapshot from before the pages/totals were read has none: "—", never 0.
    const t = s.totals || { impressions: null, clicks: null };
    const byShown = (a, b) => b.v - a.v;
    const pages = (s.pages || []).map((p) => ({ name: p.key.replace(/^https?:\/\/(www\.)?[^/]+/, '') || '/', v: p.impressions,
      note: `${p.clicks} click${p.clicks === 1 ? '' : 's'}${p.position ? ` · position ${f1(p.position)}` : ''}` })).sort(byShown);
    const countries = (s.countries || []).map((c) => ({ name: c.key.toUpperCase(), v: c.impressions, note: `${c.clicks} clicks` })).sort(byShown);
    const devices = (s.devices || []).map((c) => ({ name: c.key.toLowerCase(), v: c.impressions, note: `${c.clicks} clicks` })).sort(byShown);
    return `<div class="box"><h3>${esc(s.host)} in Google</h3><span class="sub">Last 28 days, from Search Console, two or three days behind.</span>
      <div class="hls">
        <div class="hl"><span class="l">shown in Google</span><b>${esc(f1(t.impressions))}</b></div>
        <div class="hl"><span class="l">clicked</span><b>${esc(f1(t.clicks))}</b></div>
        <div class="hl"><span class="l">clicks per 100 shown</span><b>${esc(f1(per100(t.clicks, t.impressions)))}</b></div>
        <div class="hl"><span class="l">average position (1 = top)</span><b>${t.position ? esc(f1(t.position)) : '—'}</b></div>
      </div>
      ${pages.length ? `<h4 class="sec">Pages Google showed</h4>${hbars(pages)}` : `<p class="cap">${s.totals ? 'Google has not shown this site yet.' : 'Pages arrive with the next stats run.'}</p>`}
      ${countries.length ? `<div class="tracks"><div><h4 class="sec">Countries</h4>${hbars(countries)}</div><div><h4 class="sec">Devices</h4>${hbars(devices)}</div></div>` : ''}
    </div>`; }).join('');
  const missing = (search && search.missing) || [];

  const courseRows = course.length ? `<table><thead><tr><th>link</th><th class="num">all time</th><th class="num">last 30 days</th></tr></thead><tbody>${
    course.map((r) => `<tr><td>${esc(courseHost || '')}/${esc(r.code)}${r.tag ? `/${esc(r.tag)}` : ''}</td><td class="num">${r.all_time}</td><td class="num">${r.recent || 0}</td></tr>`).join('')}</tbody></table>`
    : '<p class="empty">No course link clicks yet.</p>';
  const siteRows = siteLinks.length ? `<table><thead><tr><th>link</th><th class="num">all time</th><th class="num">last 30 days</th></tr></thead><tbody>${
    siteLinks.map((r) => { const toCourse = onCourse(r.target, courseSite);
      return `<tr><td>${toCourse ? 'show site → course site' : 'course site → show site'} <span class="faint">${esc(toCourse ? (courseHost || '') : (linkHost || ''))}/${esc(r.code)}</span></td><td class="num">${r.all_time}</td><td class="num">${r.recent || 0}</td></tr>`; }).join('')}</tbody></table>`
    : '<p class="empty">Not set up.</p>';

  const websites = `${LEGEND}<div class="grid">
    ${mc({ title: `${w.showHost || 'Show site'} visits`, sub: 'estimate, 1 in 10 sampled', series: S.visitsShow, approx: true })}
    ${mc({ title: `${w.courseHost || 'Course site'} visits`, sub: 'estimate, 1 in 10 sampled', series: S.visitsCourse, approx: true })}
    ${mc({ title: 'Shown in Google', sub: w.showHost || '', series: S.googleShown })}
    ${mc({ title: 'Clicked from Google', sub: w.showHost || '', series: S.googleClicked })}
  </div>
  <h3 class="sec">Google Search Console</h3>
  ${google || '<p class="empty">Search Console is not connected yet.</p>'}
  ${missing.length ? `<p class="cap">Not connected: ${esc(missing.join(', '))}.</p>` : ''}
  <p class="cap">No search terms: Google hides a term until enough different people search it.</p>
  <h3 class="sec">Where visitors came from</h3><div class="box">${sourcesCard({ sites: (snapshots.sites || {}).body || null })}</div>
  <div class="tracks"><div class="box"><h3>Course links</h3><span class="sub">people, by the profile ending on the link</span>${courseRows}</div>
    <div class="box"><h3>Between the two sites</h3><span class="sub">one link each way</span>${siteRows}</div></div>`;

  // ---- Posts ----------------------------------------------------------------
  const posts = ((snapshots.posts || {}).body) || [];
  const bars = posts.map((p) => {
    const by = {};
    for (const x of p.platforms) by[x.platform] = (by[x.platform] || 0) + (x.views || x.impressions || 0);
    return { p, by, total: Object.values(by).reduce((a, b) => a + b, 0) };
  });
  const mx = Math.max(1, ...bars.map((b) => b.total));
  const cols = POST_COLUMNS;
  const postBars = bars.map(({ p, by, total }) => `<div class="pr"><div class="prh"><span class="prt">${esc(p.title)}</span><span class="pra">${esc(ageShort(p.publishedAt, now))}</span></div>
    <div class="prb"><span class="stk">${cols.filter((c) => by[c]).map((c) => `<span class="s-${c}" style="width:${((by[c] / mx) * 100).toFixed(2)}%" title="${esc(pname(c))} ${num(by[c])}"></span>`).join('') || '<span class="none">nothing reported yet</span>'}</span>
    <b>${esc(num(total))}</b></div></div>`).join('');
  const postsTab = `<div class="box"><h3>Latest posts</h3><span class="sub">Seen, per platform, newest first. Young posts are still growing, so compare posts of the same age.</span>
    <div class="lgs">${cols.map((c) => `<span><i class="s-${c}"></i>${esc(pname(c))}</span>`).join('')}</div>
    ${postBars || '<p class="empty">No posts shipped yet.</p>'}
    <details class="more"><summary>Every number, per platform</summary>${latestPostsCard({ posts, postClicks, tz, now })}</details></div>`;

  const panels = { journey, trends, platforms, websites, posts: postsTab };
  const body = `
<h1>Stats</h1>
<p class="lede">This week is ${esc(this_)}, against the usual week: the 4 before it (${esc(usual)}). Today is in neither.</p>
<nav class="tabs" role="tablist">${TABS.map(([id, label]) => `<a href="#${id}" data-t="${id}">${esc(label)}</a>`).join('')}</nav>
${TABS.map(([id, label]) => `<section class="panel" id="${id}"><h2 class="tabtitle">${esc(label)}</h2>${panels[id]}</section>`).join('\n')}
<style>${CHART_CSS}</style>
<script>(function(){var d=document.documentElement;d.classList.add('js');
function show(h){if(!h||!document.getElementById(h))h='journey';
document.querySelectorAll('.panel').forEach(function(p){p.classList.toggle('on',p.id===h)});
document.querySelectorAll('.tabs a').forEach(function(a){a.classList.toggle('on',a.dataset.t===h)});}
document.querySelectorAll('.tabs a').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();history.replaceState(null,'','#'+a.dataset.t);show(a.dataset.t)})});
addEventListener('hashchange',function(){show(location.hash.slice(1))});show(location.hash.slice(1));})();</script>`;
  return layout({ title: 'Stats', path: '/stats', email, tz, body, wide: true });
}

const onCourse = (target, courseSite) => { try { return new URL(target).hostname.replace(/^www\./, '') === courseSite; } catch { return false; } };
