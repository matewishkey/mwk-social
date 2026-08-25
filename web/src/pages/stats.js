/*
 * Stats, for a channel this size.
 *
 * The opinion baked in here, because it is the whole reason the page looks like
 * this: at our follower counts, followers are not the scoreboard. Five things
 * are worth watching, in this order —
 *
 *   1. reach / views      did anyone see it
 *   2. actions per post   did anyone care (per post, so it compares across
 *                         channels — see the channel table for why a RATE
 *                         cannot)
 *   3. link clicks        the only number tied to the actual goal, guest sign-ups
 *   4. cadence            posts per week — the biggest lever we fully control
 *   5. follower growth    last, and only where there is a base to grow
 *
 * Each channel card shows ONLY the metrics that channel genuinely returns,
 * read from the platform table. A grid of structural zeros looks like failure
 * when it is really just an API that does not report that number.
 *
 * ---------------------------------------------------------------------------
 * TRENDS (2026-08-25). A level with no previous level beside it is not a
 * finding — "381 people reached" answers nothing on its own. Everything here
 * now carries a direction, and the three ways that direction can lie are each
 * closed deliberately, because every one of them lies in the flattering
 * direction:
 *
 *   1. TODAY IS NOT A DAY YET. The comparison runs over the last seven
 *      COMPLETE days against the seven before them. Putting a morning against
 *      seven full days draws a collapse that is only the clock. (Zernio's dates
 *      are UTC days and so is the Worker's clock, so the two agree on where the
 *      boundary is; the page's Brisbane display never enters this arithmetic.)
 *
 *   2. A CHANNEL THAT DID NOT EXIST CANNOT HAVE GROWN. TikTok's first row is
 *      17 Aug — compare its last seven days against the seven before and the
 *      denominator is one day, so a channel that did nothing new reads as
 *      several hundred percent up. A platform with no history behind the older
 *      window gets its start date instead of a percentage.
 *
 *   3. CONNECTING AN ACCOUNT IS NOT GROWTH, and this is the one that would have
 *      been believed. A third LinkedIn account was connected on 22 Aug carrying
 *      5,040 followers: a summed total jumps +5,043 overnight and reads as the
 *      best week the show has ever had. Follower movement is therefore computed
 *      PER ACCOUNT, and the total only counts accounts present at both ends —
 *      with the ones that joined in between named underneath rather than
 *      quietly folded in.
 *
 * The rule under all three: when the data cannot answer the question, the page
 * says so. It never draws an arrow it has not earned.
 */
import { esc, card, layout, num } from '../lib/html.js';

const WINDOW_DAYS = 30;
const TREND_DAYS = 7;

/** The ISO day n days from the given one. Negative goes back. */
const shift = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** A short, human day: "18 Aug". The window labels, not the data. */
const short = (iso) => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })
      .format(new Date(`${iso}T00:00:00Z`));
  } catch { return iso; }
};

/** A bar chart, inline SVG, no library — the CSP forbids one anyway. */
function bars(series, { height = 54, label = '', markFrom = null } = {}) {
  if (!series.length) return '<p class="empty">Nothing yet.</p>';
  const max = Math.max(...series.map((d) => d.value), 1);
  const w = 100 / series.length;
  return `<svg class="bars" viewBox="0 0 100 ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
    ${series.map((d, i) => {
      const h = Math.max((d.value / max) * (height - 2), d.value > 0 ? 1 : 0);
      // The most recent complete week is drawn solid, the history behind it
      // faded — so the half of the chart the percentage is about is visible.
      const recent = markFrom && d.label >= markFrom;
      return `<rect class="${recent ? 'now' : ''}" x="${(i * w).toFixed(2)}" y="${(height - h).toFixed(2)}"
        width="${(w * 0.72).toFixed(2)}" height="${h.toFixed(2)}" rx="0.6"><title>${esc(d.label)}: ${d.value}</title></rect>`;
    }).join('')}
  </svg>`;
}

/** A sparkline for a channel card — shape only, no axis, no numbers. */
function spark(series, label = '') {
  if (series.length < 2) return '';
  const max = Math.max(...series.map((d) => d.value), 1);
  const step = 100 / (series.length - 1);
  const pts = series.map((d, i) =>
    `${(i * step).toFixed(2)},${(20 - (d.value / max) * 18).toFixed(2)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 100 20" preserveAspectRatio="none" role="img"
    aria-label="${esc(label)}"><polyline points="${pts}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
}

/*
 * now against before, as something that can be rendered.
 *
 * Returns null when there is nothing to say — both sides zero — rather than a
 * cheerful 0%. `blocked` is the caller's way of saying "the older window is not
 * a fair denominator", and it produces a reason instead of a number.
 */
function change(now, before, blocked = null) {
  if (blocked) return { text: blocked, tone: 'plain', dir: '', note: true };
  if (!before && !now) return null;
  if (!before) return { text: 'new', tone: 'ok', dir: '▲' };
  const pct = ((now - before) / before) * 100;
  if (Math.abs(pct) < 5) return { text: 'about the same', tone: 'plain', dir: '→' };
  return {
    text: `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`,
    tone: pct > 0 ? 'ok' : 'bad',
    dir: pct > 0 ? '▲' : '▼',
  };
}

const pill = (c) => (c ? `<span class="pill p-${c.tone} ${c.note ? 'thin' : ''}">${c.dir ? `${c.dir} ` : ''}${esc(c.text)}</span>` : '');

/** A stat tile that can carry a trend pill. html.js's tile() escapes its sub. */
const trendTile = (value, label, tone, sub, c) => `
  <div class="tile t-${tone}">
    <b>${esc(value)}</b>
    <span>${esc(label)}</span>
    <i>${pill(c)}${sub ? `<em>${esc(sub)}</em>` : ''}</i>
  </div>`;

const FLOWS = ['reach', 'impressions', 'views', 'likes', 'comments', 'shares', 'saves', 'clicks'];

/** Add up a set of daily_metric rows. */
function totals(rows) {
  const t = { posts: 0 };
  for (const k of FLOWS) t[k] = 0;
  for (const r of rows) {
    t.posts += r.post_count || 0;
    for (const k of FLOWS) t[k] += r[k] || 0;
  }
  return t;
}

export function statsPage({ email, tz, daily, followers, clicks, snapshots,
  targets = [], split = [], links = 0, days = WINDOW_DAYS,
  followerHistory = [], clicksByDay = [], platformSince = {}, accountSince = {} }) {
  const platformTable = ((snapshots.platforms || {}).body || {}).flows || [];
  const metricsFor = Object.fromEntries(platformTable.map((f) => [f.platform, (f.capabilities || {}).metrics || {}]));

  // ---- the two comparison windows ----------------------------------------
  // Yesterday is the newest complete day; today is deliberately in neither.
  const today = new Date().toISOString().slice(0, 10);
  const recentTo = shift(today, -1);
  const recentFrom = shift(recentTo, -(TREND_DAYS - 1));
  const priorTo = shift(recentFrom, -1);
  const priorFrom = shift(priorTo, -(TREND_DAYS - 1));
  const within = (d, a, b) => d >= a && d <= b;

  const recentRows = daily.filter((r) => within(r.date, recentFrom, recentTo));
  const priorRows = daily.filter((r) => within(r.date, priorFrom, priorTo));
  const recent = totals(recentRows);
  const prior = totals(priorRows);

  /*
   * Is the older window a fair denominator for this platform? Only if the
   * platform was already reporting when that window opened. `platformSince` is
   * taken over the WHOLE table rather than the rendered thirty days, which is
   * the entire reason it is a separate query — a channel that has run for
   * months must not be called new because the page happens to start here.
   */
  const fairFor = (platform) => {
    const since = platformSince[platform];
    if (!since) return `no history`;
    return since <= priorFrom ? null : `since ${short(since)}`;
  };

  // ---- roll the window up ------------------------------------------------
  const byPlatform = {};
  const byDate = {};
  for (const r of daily) {
    const p = (byPlatform[r.platform] ||= { platform: r.platform, posts: 0, reach: 0, impressions: 0,
      views: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0 });
    for (const k of FLOWS) p[k] += r[k] || 0;
    p.posts += r.post_count || 0;
    const d = (byDate[r.date] ||= { reach: 0, views: 0, posts: 0 });
    d.reach += r.reach || r.impressions || 0;
    d.views += r.views || 0;
    d.posts += r.post_count || 0;
  }

  const dates = Object.keys(byDate).sort();
  const tot = Object.values(byPlatform).reduce((a, p) => {
    for (const k of ['posts', ...FLOWS]) a[k] = (a[k] || 0) + p[k];
    return a;
  }, {});

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
  // Per window the divisor is known — seven days — so this one is a plain count.
  const daysPosted = (a, b) => dates.filter((d) => within(d, a, b) && byDate[d].posts > 0).length;
  const cadenceNow = daysPosted(recentFrom, recentTo);
  const cadenceBefore = daysPosted(priorFrom, priorTo);

  const bySplit = Object.fromEntries(split.map((r) => [r.bot, r.n]));
  const human = bySplit[0] || 0;
  const crawler = bySplit[1] || 0;
  const unknown = bySplit[2] || 0;

  const clickOn = Object.fromEntries(clicksByDay.map((r) => [r.day, r.n]));
  const clicksIn = (a, b) => Object.entries(clickOn)
    .filter(([d]) => within(d, a, b)).reduce((s, [, n]) => s + n, 0);
  const clicksNow = clicksIn(recentFrom, recentTo);
  const clicksBefore = clicksIn(priorFrom, priorTo);

  /*
   * ACTIONS PER POST replaced the site-wide engagement RATE, because that rate
   * could not be computed honestly and was overstating us by half.
   *
   * The old site-wide rate (deleted with this change) took the first of
   * `reach || impressions || views` a channel offered, and summing those across
   * channels sums three different measurements into one denominator. Worse, on
   * this account only facebook, instagram and linkedin report reach at all — so
   * the numerator counted actions from all SEVEN channels and the denominator
   * covered THREE. Measured on the real window: 348 actions over 6,356 reach
   * read as 5.5%, where the same-set figure is 3.8%, and even that mixes units.
   *
   * A post is a post on every channel, so actions per post divides two numbers
   * that mean the same thing everywhere. It is also the column the channel
   * table marks as comparable, so the headline and the detail now agree.
   *
   * (`posts` is per PLATFORM-post — one clip to seven channels is seven posts —
   * which is the right denominator here: each is a separate thing that can earn
   * a reaction. Cadence, the tile beside it, deliberately counts days instead.)
   */
  const actionsOf = (t) => (t.likes || 0) + (t.comments || 0) + (t.shares || 0) + (t.saves || 0);
  const perPostOf = (t) => (t.posts ? actionsOf(t) / t.posts : 0);
  const perPostAll = perPostOf(tot);
  const perPostNow = perPostOf(recent);
  const perPostBefore = perPostOf(prior);

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

  /*
   * Every day in the span, not only the days carrying rows.
   *
   * A bar chart that skips its empty days draws them as if they never happened:
   * two posts a week apart sit side by side and the gap — which is the thing
   * worth seeing, because cadence is the lever we control — disappears.
   */
  const allDays = [];
  if (dates.length) {
    for (let d = dates[0]; d <= dates[dates.length - 1]; d = shift(d, 1)) allDays.push(d);
  }
  const reachSeries = allDays.map((d) => ({ label: d, value: (byDate[d] || {}).reach || 0 }));
  const clickSeries = allDays.map((d) => ({ label: d, value: clickOn[d] || 0 }));

  /* ---- one row per channel, and only the columns that mean the same thing --
   *
   * This replaced seven separate cards, each showing whichever metrics its own
   * platform happened to expose. Mate, 2026-08-25: "right now i see different
   * numbers but not one nice numbers". He was right, and the problem was worse
   * than layout — the numbers were not comparable, and nothing said so.
   *
   * What was researched, and what it changes:
   *
   *   "SEEN" IS THREE DIFFERENT MEASUREMENTS. Meta's own developer docs define
   *   impressions as "total number of times the media object has been seen" and
   *   reach as "total number of unique accounts that have seen" it. Our seven
   *   channels report reach (facebook, instagram, linkedin), views (youtube,
   *   tiktok) or impressions (twitter) — so the denominators sit on different
   *   scales and a percentage built on them cannot be ranked across channels.
   *
   *   AND A VIEW IS NOT A VIEW. YouTube's own Help Centre: from 24 AUGUST 2026
   *   a view is counted the moment playback begins, on every format — before
   *   that, long-form needed real watch time. TikTok counts one on autoplay.
   *   So "views" is the cheapest number on one channel and the dearest on
   *   another, and on YouTube it changed unit YESTERDAY.
   *
   *   ON INSTAGRAM AND THREADS, views AND impressions ARE THE SAME NUMBER —
   *   measured here, not assumed: 990 against 990, and 53 against 53 over the
   *   whole window. Two names for one reading.
   *
   *   THE OLD SITE-WIDE RATE MADE IT WORSE. It preferred reach, then
   *   impressions, then views. reach <= impressions by definition, so every channel reporting
   *   reach got a structurally higher percentage than one reporting
   *   impressions: facebook reads 2.7% on reach and 2.1% on the same actions
   *   over impressions. Half the ranking was which metric the API happened to
   *   expose.
   *
   * So the table separates the two kinds of column, and says which is which.
   * COMPARABLE: posts, actions, actions per post, and our own tracked clicks —
   * a post is a post everywhere, and a click on a short link is one redirect
   * hit with the crawlers filtered out, measured identically on every channel.
   * NOT COMPARABLE: seen, and the rate built on it. Those are still shown,
   * because they are what we have, but each names its own denominator inline —
   * which is the practice the engagement-rate literature recommends for exactly
   * this reason.
   */
  const ORDER = ['facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'threads', 'twitter'];
  const SEEN_NOUN = { reach: 'unique people', views: 'plays', impressions: 'times on screen' };
  const trackedFor = Object.fromEntries(clicks.map((c) => [c.platform, c.n]));

  const channelStats = Object.values(byPlatform)
    .sort((a, b) => ORDER.indexOf(a.platform) - ORDER.indexOf(b.platform))
    .map((p) => {
      const shown = metricsFor[p.platform] || {};
      /*
       * What this channel counts as "seen" — the one it actually reports.
       *
       * The last clause matters: with no platform snapshot shipped, `shown` is
       * empty and every channel fell back to impressions, so one measured in
       * reach or views drew a flat zero line and a trend of nothing.
       */
      const declared = (k) => shown[k] && shown[k] !== 'no';
      const seenKey = declared('reach') ? 'reach'
        : declared('views') ? 'views'
        : declared('impressions') ? 'impressions'
        : p.reach ? 'reach' : p.views ? 'views' : 'impressions';
      const actions = p.likes + p.comments + p.shares + p.saves;
      const seen = p[seenKey] || 0;
      const mine = (rows) => totals(rows.filter((r) => r.platform === p.platform));
      return {
        platform: p.platform,
        posts: p.posts,
        actions,
        perPost: p.posts ? actions / p.posts : 0,
        seen,
        seenKey,
        rate: seen ? (actions / seen) * 100 : null,
        tracked: trackedFor[p.platform] || 0,
        blocked: fairFor(p.platform),
        now: mine(recentRows),
        before: mine(priorRows),
        series: allDays.map((d) => ({
          label: d,
          value: (daily.find((r) => r.date === d && r.platform === p.platform) || {})[seenKey] || 0,
        })),
      };
    });

  /* An inline bar, drawn against the biggest value in its own column. */
  const meter = (value, max, tone = 'accent') => `<div class="meter">
      <i class="m-${tone}" style="width:${max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 0) : 0}%"></i>
    </div>`;

  const maxPerPost = Math.max(...channelStats.map((c) => c.perPost), 0);
  const maxTracked = Math.max(...channelStats.map((c) => c.tracked), 0);

  const channelTable = channelStats.length ? `<div class="wrap"><table class="chan">
    <thead><tr>
      <th>channel</th>
      <th class="num">posts</th>
      <th class="num">actions</th>
      <th class="cmp">per post</th>
      <th class="cmp">clicks (our links)</th>
      <th class="num">seen</th>
      <th class="num">rate</th>
      <th class="num">week</th>
    </tr></thead>
    <tbody>${channelStats.map((c) => `<tr>
      <td class="nowrap"><b>${esc(c.platform)}</b></td>
      <td class="num">${c.posts}</td>
      <td class="num">${esc(num(c.actions))}</td>
      <td class="bar">${meter(c.perPost, maxPerPost)}<span>${c.perPost.toFixed(1)}</span></td>
      <td class="bar">${meter(c.tracked, maxTracked, 'ok')}<span>${c.tracked}</span></td>
      <td class="num">${esc(num(c.seen))}
        <div class="faint den">${esc(SEEN_NOUN[c.seenKey] || c.seenKey)}</div></td>
      <td class="num">${c.rate == null ? '—' : `${c.rate.toFixed(1)}%`}
        <div class="faint den">of ${esc(c.seenKey)}</div></td>
      <td class="num">${pill(change(c.now[c.seenKey], c.before[c.seenKey], c.blocked))}</td>
    </tr>`).join('')}</tbody></table></div>
  <p class="note"><b>The two shaded columns are the only ones that compare across channels.</b>
    A post is a post everywhere, and a click is one hit on our own short link with preview crawlers
    filtered out — both measured identically on all seven.</p>
  <p class="note"><b>Seen and rate cannot be ranked against each other, and each names its own
    denominator for that reason.</b> Reach counts unique accounts, impressions count every time
    something was on a screen, and a play is neither — so the same post reads as a win on one scale
    and a dud on another. Two of these changed meaning this year: YouTube began counting a view the
    moment playback starts on <b>24 August 2026</b>, where long-form used to need real watch time,
    and TikTok counts one on autoplay. On Instagram and Threads views and impressions are literally
    the same number here — 990 against 990, and 53 against 53.</p>`
    : '<p class="empty">No metrics shipped yet.</p>';

  // ---- followers: per account, because a connection is not growth ---------
  const fDays = [...new Set(followerHistory.map((r) => r.day))].sort();
  const onDay = (d) => new Map(followerHistory.filter((r) => r.day === d).map((r) => [r.account_id, r]));
  const fFirst = fDays[0];
  const fLast = fDays[fDays.length - 1];
  const startSet = fFirst ? onDay(fFirst) : new Map();
  const endSet = fLast ? onDay(fLast) : new Map();
  const bothEnds = [...endSet.keys()].filter((k) => startSet.has(k));
  const joinedLater = [...endSet.keys()].filter((k) => !startSet.has(k));
  const sumOf = (keys, set) => keys.reduce((a, k) => a + ((set.get(k) || {}).followers || 0), 0);
  const followersNow = sumOf(bothEnds, endSet);
  const followersThen = sumOf(bothEnds, startSet);

  const withBase = followers.filter((f) => (f.followers || 0) >= 10)
    .sort((a, b) => b.followers - a.followers);
  const tiny = followers.filter((f) => (f.followers || 0) < 10);

  /* One account's movement across the history we hold for IT, not for the page. */
  const moved = (accountId) => {
    const mineRows = followerHistory.filter((r) => r.account_id === accountId);
    if (mineRows.length < 2) return null;
    const first = mineRows[0];
    const last = mineRows[mineRows.length - 1];
    const d = (last.followers || 0) - (first.followers || 0);
    return { delta: d, since: first.day };
  };

  /*
   * Naming the accounts left out of the total is NOT part of the table — it is
   * part of the total, and it hung off `withBase.length` until a test caught it.
   * That is a different question (has this channel ten followers yet), so a page
   * showing the guarded total could have shown it with no explanation beside it.
   * The caveat travels with the number it is about.
   */
  const excludedNote = joinedLater.length ? `<p class="note">${joinedLater.length} account${joinedLater.length === 1 ? '' : 's'}
      (${esc(joinedLater.map((k) => (endSet.get(k) || {}).username || k).join(', '))}) ${joinedLater.length === 1 ? 'was' : 'were'}
      connected part-way through and ${joinedLater.length === 1 ? 'is' : 'are'} left out of the total above.
      ${joinedLater.length === 1 ? 'Its' : 'Their'} existing followers arrived with the connection —
      counting them as growth would be the most flattering mistake on this page.</p>` : '';

  const followerRows = (withBase.length ? `<table>
      <thead><tr><th>channel</th><th></th><th class="num">followers</th><th class="num">since</th></tr></thead>
      <tbody>${withBase.map((f) => {
        const m = moved(f.account_id);
        const joined = accountSince[f.account_id];
        return `<tr>
        <td>${esc(f.platform)}</td><td class="faint">${esc(f.username || '')}</td>
        <td class="num">${esc(num(f.followers))}</td>
        <td class="num">${m
          ? `<span class="pill p-${m.delta > 0 ? 'ok' : m.delta < 0 ? 'bad' : 'plain'} thin">${m.delta > 0 ? '+' : ''}${m.delta}</span>
             <div class="faint" style="font-size:.7rem">since ${esc(short(m.since))}</div>`
          : `<span class="faint">${joined ? `joined ${esc(short(joined))}` : 'one reading'}</span>`}</td></tr>`;
      }).join('')}</tbody></table>
    ${tiny.length ? `<p class="note">${tiny.length} other ${tiny.length === 1 ? 'channel is' : 'channels are'} still
      under ten followers (${esc(tiny.map((t) => t.platform).join(', '))}) — too small for a trend to mean anything,
      so they are left off deliberately rather than drawn as flat lines.</p>` : ''}`
    : '<p class="empty">No follower counts shipped yet.</p>') + excludedNote;

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

  // ---- week on week, as a table ------------------------------------------
  const wowRow = (name, now, before, fmt = num, blocked = null) => `<tr>
    <td>${esc(name)}</td>
    <td class="num">${esc(fmt(now))}</td>
    <td class="num faint">${esc(fmt(before))}</td>
    <td class="num">${pill(change(now, before, blocked))}</td></tr>`;

  const wow = `<div class="wrap"><table>
    <thead><tr><th></th>
      <th class="num">${esc(short(recentFrom))}–${esc(short(recentTo))}</th>
      <th class="num">${esc(short(priorFrom))}–${esc(short(priorTo))}</th>
      <th class="num">change</th></tr></thead>
    <tbody>
      ${wowRow('people reached', recent.reach || recent.impressions, prior.reach || prior.impressions)}
      ${wowRow('video views', recent.views, prior.views)}
      ${wowRow('likes, comments, shares, saves',
        recent.likes + recent.comments + recent.shares + recent.saves,
        prior.likes + prior.comments + prior.shares + prior.saves)}
      ${wowRow('actions per post', perPostNow, perPostBefore, (v) => v.toFixed(1))}
      ${wowRow('link clicks (people)', clicksNow, clicksBefore, (v) => String(v))}
      ${wowRow('days we posted', cadenceNow, cadenceBefore, (v) => `${v}/7`)}
    </tbody></table></div>
  <p class="note">Both columns are seven whole days. Today is in neither — it is still in
    progress, and putting a morning against a full week draws a fall that is only the clock.
    A day's numbers also keep moving for a while after it ends, so the most recent column is
    the one still settling.</p>`;

  const body = `
<h1>Stats</h1>
<p class="lede">Last ${spanDays || days} days${dates.length ? `, ${esc(dates[0])} to ${esc(dates[dates.length - 1])}` : ''}.
  Trend compares ${esc(short(recentFrom))}–${esc(short(recentTo))} against ${esc(short(priorFrom))}–${esc(short(priorTo))}.</p>

<div class="tiles">
  ${trendTile(num(tot.reach || tot.impressions || 0), 'people reached', 'plain', 'did anyone see it',
    change(recent.reach || recent.impressions, prior.reach || prior.impressions))}
  ${trendTile(num(tot.views || 0), 'video views', 'plain', '', change(recent.views, prior.views))}
  ${trendTile(perPostAll.toFixed(1), 'actions per post',
    perPostAll >= 4 ? 'ok' : perPostAll >= 2 ? 'warn' : 'bad', 'did anyone care',
    change(perPostNow, perPostBefore))}
  ${trendTile(human, 'link clicks', human ? 'ok' : 'plain',
    crawler || unknown ? `${crawler + unknown} not counted` : 'people, not crawlers',
    change(clicksNow, clicksBefore))}
  ${trendTile(cadence.toFixed(1), 'days a week we post',
    cadence >= 5 ? 'ok' : cadence >= 3 ? 'warn' : 'bad', 'the lever we control',
    change(cadenceNow, cadenceBefore))}
  ${trendTile(num(followersNow), 'followers', 'plain',
    bothEnds.length ? `${bothEnds.length} account${bothEnds.length === 1 ? '' : 's'} held throughout` : '',
    fFirst === fLast ? { text: 'one reading so far', tone: 'plain', dir: '', note: true }
      : change(followersNow, followersThen))}
</div>

${card('Week on week', wow)}

${card('Reach by day', bars(reachSeries, { label: 'reach by day', markFrom: recentFrom })
  + `<div class="axis"><span>${esc(allDays[0] || '')}</span>
      <span class="faint">solid = the week the percentages are about</span>
      <span>${esc(allDays[allDays.length - 1] || '')}</span></div>`)}

${card('Link clicks by day', clickSeries.some((d) => d.value)
  ? bars(clickSeries, { label: 'clicks by day', markFrom: recentFrom })
    + `<div class="axis"><span>${esc(allDays[0] || '')}</span>
        <span class="faint">people only — preview crawlers are excluded</span>
        <span>${esc(allDays[allDays.length - 1] || '')}</span></div>`
  : '<p class="empty">No clicks from a person yet, so there is no shape to draw.</p>')}

${card('Channels, side by side', channelTable)}

<div class="two">
  ${card('Clicks by channel', clickRows)}
  ${card('What they clicked', targetRows)}
</div>

<div class="two">
  ${card('What counted, and what did not', splitCard)}
  ${card('Followers', followerRows)}
</div>

<style>
.sec { font-size:.82rem; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); margin:1.6rem 0 .8rem; }
table.chan td { vertical-align:middle; }
table.chan th.cmp, table.chan td.bar { background:var(--accent-soft); }
th.cmp { text-align:left; font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; color:var(--accent); }
td.bar { min-width:9rem; }
td.bar span { font-variant-numeric:tabular-nums; font-weight:650; font-size:.85rem; }
.meter { display:inline-block; width:5.5rem; height:.5rem; background:var(--line); border-radius:99px;
  overflow:hidden; margin-right:.5rem; vertical-align:middle; }
.meter i { display:block; height:100%; background:var(--accent); }
.meter i.m-ok { background:var(--ok); }
.den { font-size:.68rem; font-weight:400; line-height:1.2; }
.two { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:1.1rem; margin-top:1.1rem; }
.two .card { margin:0; }
.bars { width:100%; height:74px; display:block; }
.bars rect { fill:var(--accent); opacity:.28; }
.bars rect.now { opacity:.85; }
.spark { width:100%; height:34px; display:block; margin:0 0 .5rem; }
.spark polyline { stroke:var(--accent); stroke-width:1.5px; stroke-linejoin:round; stroke-linecap:round; }
.trend { font-size:.78rem; color:var(--muted); margin:0 0 .6rem; display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; }
.axis { display:flex; justify-content:space-between; gap:.6rem; font-size:.72rem; color:var(--faint); margin-top:.3rem; }
.kv { display:grid; grid-template-columns:1fr auto; gap:0; margin:0; font-size:.86rem; }
.kv > div { display:contents; }
.kv dt { color:var(--muted); padding:.2rem 0; }
.kv dd { margin:0; padding:.2rem 0; text-align:right; font-variant-numeric:tabular-nums; font-weight:600; }
.tile i .pill { margin-right:.35rem; }
.tile i em { font-style:normal; }
.pill.thin { font-weight:500; }
</style>`;

  return layout({ title: 'Stats', path: '/stats', email, tz, body, wide: true });
}

/** Name what this platform does NOT report, so a missing row reads as an API limit. */
function unreported(metrics) {
  const missing = Object.entries(metrics).filter(([, v]) => v === 'no').map(([k]) => k);
  if (!missing.length) return '';
  return `Not reported here: ${missing.join(', ')}.`;
}
