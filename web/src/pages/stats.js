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

/*
 * OUR OWN HANDS COME OFF THE SCOREBOARD (mate, 2026-09-20: "remove our shares,
 * so when I reshare or like with my normal account... or if it is not possible
 * just deduct always 2 likes and 2 reshares from every post, that is a safe way").
 *
 * It is not possible the honest way: no platform's analytics say WHO liked or
 * shared, so his own like and repost from his personal account are
 * indistinguishable from a stranger's. So it is the flat deduction he named,
 * applied per platform-post to every row before anything on this page adds
 * them up — the tiles, the channel table, the age-matched trend and the
 * revision trail all inherit it. Clamped at zero: a post nobody but him
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
 * Handled the way a channel younger than the window already is: the trend is
 * REFUSED and given a reason, never rendered as a percentage. The number itself
 * still shows; it is only the comparison that is withheld.
 */
export const YT_VIEW_UNIT_CHANGED = '2026-08-24';

/*
 * Exported so it can be tested against fixed dates. Testing it through the
 * rendered page cannot work: the windows are computed from today's clock, so
 * an assertion that the trend is refused would start failing on its own the
 * day the older window clears the boundary. A pure function and two dates is
 * stable for ever.
 */
export const viewsUnitBlocked = (from) =>
  (from < YT_VIEW_UNIT_CHANGED ? 'unit changed 24 Aug' : null);

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
/*
 * SEEN AND ACTIONS GET NO WEEK-ON-WEEK ARROW, since 2026-09-14.
 *
 * daily_metric is not activity by day; it is lifetime accrual attributed to
 * the post's publish date, and it keeps moving for weeks. The revision table
 * recorded since 26 Aug says how much: at the end of its own day a Facebook
 * post's reach is 75% of what it will settle at, LinkedIn 66%, Instagram 70%,
 * and none but TikTok is settled a week later. So "the recent seven complete
 * days" is ~85% settled against a prior window at ~97%, and a channel doing
 * exactly the same reads −10 to −20% every single week — past the ±5% band
 * this page calls "about the same". The three guards below all close lies in
 * the flattering direction; this was the one lying the other way.
 *
 * Deleted rather than caveated (his rule). Clicks and cadence keep their
 * arrows: a click is stamped when it happens and a day we posted is a fact by
 * midnight. Followers keep theirs: a level, read the same way both ends.
 */
/*
 * THE SETTLE TABLE WAS RECORDED FOR THREE WEEKS AND READ BY NOTHING. THIS READS
 * IT (2026-09-15, mate: "I want to see some trends").
 *
 * The reason seen and actions lost their arrow on 14 Sep was never that the
 * numbers were wrong. It was that the two windows were measured at different
 * MATURITIES: daily_metric is lifetime accrual attributed to a publish date and
 * it keeps climbing for weeks, so last week is ~85% settled against the week
 * before at ~97%, and a channel doing exactly the same reads -10 to -20%.
 *
 * `daily_metric_revision` fixes that, because it is the same number at every
 * age. Read every day at ONE age and the two windows become comparable: a day
 * from last week at 24 hours old against a day from the week before at 24 hours
 * old. The settle curve cancels instead of being subtracted.
 *
 * AGE 1 DAY, and the choice is forced rather than tuned. The youngest day in
 * the recent window is yesterday, so one day is the most maturity every day in
 * both windows is guaranteed to have. Asking for more would silently drop the
 * newest day and quietly shorten the window.
 *
 * Three ways this can still lie, all closed below:
 *   - A SERIES THAT DID NOT EXIST YET IS NOT A ZERO. If the first write landed
 *     after the cut, the value at that age is unknown and the day is dropped
 *     from BOTH sides, never counted as nothing.
 *   - A DAY MISSING FROM ONE WINDOW MUST BE MISSING FROM THE OTHER, or the
 *     comparison is seven days against six. The pair is assembled per platform
 *     and a day is used only when both windows can answer at the same age.
 *   - THE AGE IS PRINTED ON THE PAGE. A trend whose method is invisible is one
 *     nobody can challenge, and this one has already been wrong once.
 */
export const TREND_AGE_DAYS = 1;

/**
 * The value a metric held at a given instant, read out of the revision trail.
 *
 * A revision row holds the value that WAS live and was replaced at
 * `superseded_at`. So the value live at T is the first revision superseded
 * AFTER T; if nothing was superseded after T the current row has never moved
 * since and is the answer.
 *
 * @returns {number|null} null means "not knowable at that age", never zero.
 */
export function valueAtAge(revs, current, atIso, metric) {
  const ordered = [...revs].sort((a, b) => a.superseded_at.localeCompare(b.superseded_at));
  // Nothing existed yet: the earliest value we hold was WRITTEN after the cut.
  if (ordered.length && ordered[0].written_at > atIso) return null;
  const after = ordered.find((r) => r.superseded_at > atIso);
  if (after) return after[metric] || 0;
  if (!current) return null;
  // Never superseded after the cut. If the only write we know of is itself
  // later than the cut, we cannot claim it existed then.
  if (!ordered.length && current.updated_at > atIso) return null;
  return current[metric] || 0;
}

/** `date` + n days, as the UTC instant the revision trail is stamped in. */
export const cutFor = (date, ageDays) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + ageDays * 86400_000).toISOString();

/**
 * Age-matched totals for one metric over a set of days, per platform.
 *
 * Returns `{ total, usedDays, droppedDays }`. A day is used only when it can be
 * answered at the requested age; the count of the ones that could not is
 * returned rather than swallowed, because "7 days" and "4 days we could read"
 * are different claims.
 */
export function ageMatchedTotal(days, byKey, metric, ageDays) {
  let total = 0; const used = []; const dropped = [];
  for (const { date, platform } of days) {
    const key = `${date}|${platform}`;
    const entry = byKey[key];
    if (!entry) { dropped.push(key); continue; }
    const v = valueAtAge(entry.revisions || [], entry.current, cutFor(date, ageDays), metric);
    if (v === null) { dropped.push(key); continue; }
    total += v; used.push(key);
  }
  return { total, usedDays: used.length, droppedDays: dropped.length };
}

const SETTLING = 'still settling';

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
  followerHistory = [], clicksByDay = [], platformSince = {}, accountSince = {}, website = [],
  revisions = [], funnel = [] }) {
  // Before anything is summed: see OWN_ACTIONS.
  daily = withoutOwnActions(daily);
  revisions = withoutOwnActions(revisions);

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

  /*
   * The site-wide views total sums YouTube and TikTok, so it carries YouTube's
   * unit change whether or not the tile says YouTube. Blocked only when YouTube
   * actually contributed views to the older window — otherwise the caveat would
   * sit on a number YouTube had no part in.
   */
  const ytViewsBlocked = daily.some((r) => r.platform === 'youtube' && r.views
    && within(r.date, priorFrom, priorTo)) ? viewsUnitBlocked(priorFrom) : null;

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
  const ORDER = ['facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'threads', 'twitter', 'pinterest'];
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
        // fairFor first: "this channel is too new" beats "the unit moved",
        // because a channel with no older window has nothing to compare either way.
        blocked: fairFor(p.platform)
          || (p.platform === 'youtube' && seenKey === 'views' ? viewsUnitBlocked(priorFrom) : null)
          || SETTLING,
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

  /*
   * The website's own codes — the booking buttons — in their own card, and
   * called what they are. A hit here is a button press by somebody already on
   * the site; nothing joins it to the post that brought them (no cookie, no
   * parameter, by his rule), most arrive with no referer, and the two buttons
   * on two different pages have been pressed within three seconds of each
   * other three times, which is a crawler or him, not a prospect. Not a social
   * result, and never added to the social numbers above.
   */
  const websiteRows = website.length ? `<table>
    <thead><tr><th>button</th><th class="num">presses</th></tr></thead>
    <tbody>${website.map((w) => `<tr>
      <td>${esc(w.note || w.code)}<div class="faint" style="font-size:.72rem">${esc(w.code)}</div></td>
      <td class="num">${w.n}</td></tr>`).join('')}</tbody></table>
    <p class="note">Calendar-button presses on matewishkey.com itself, in the same window. Not clicks
      from social — nothing links a press to the post that brought the person, and some pairs are a
      crawler pressing both buttons at once. Bookings actually made are not measured anywhere.</p>`
    : '<p class="empty">No button presses on the site in this window.</p>';

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

  /*
   * ---- age-matched seen and actions --------------------------------------
   * The pair the settle curve used to make meaningless. Every day on both
   * sides is read at TREND_AGE_DAYS old, so the curve cancels rather than
   * being subtracted from the newer week. A day that cannot be answered at
   * that age is dropped from BOTH windows, never counted as a zero, and the
   * number of dropped days is printed rather than hidden.
   */
  const byKey = {};
  for (const r of daily) byKey[`${r.date}|${r.platform}`] = { current: r, revisions: [] };
  for (const r of revisions) {
    const k = `${r.date}|${r.platform}`;
    if (!byKey[k]) byKey[k] = { current: null, revisions: [] };
    byKey[k].revisions.push(r);
  }
  const daysIn = (a, b) => daily.filter((r) => within(r.date, a, b))
    .map((r) => ({ date: r.date, platform: r.platform }));
  const recentDays = daysIn(recentFrom, recentTo);
  const priorDays = daysIn(priorFrom, priorTo);

  /*
   * `dropped` is counted ONCE, not once per metric. Whether a platform-day can
   * be read at an age is a fact about the row existing, not about which column
   * you ask for, so summing it across four action metrics reported 44 missing
   * days where there were 11. A number four times too big in a caveat is still
   * a wrong number, and this one would have made the page look unusable.
   */
  const matchedPair = (metrics) => {
    let now = 0; let before = 0; let dropped = null;
    for (const m of metrics) {
      const a = ageMatchedTotal(recentDays, byKey, m, TREND_AGE_DAYS);
      const b = ageMatchedTotal(priorDays, byKey, m, TREND_AGE_DAYS);
      now += a.total; before += b.total;
      if (dropped === null) dropped = a.droppedDays + b.droppedDays;
    }
    return { now, before, dropped: dropped || 0 };
  };
  const seenM = matchedPair(['reach']);
  const impM = matchedPair(['impressions']);
  const viewsM = matchedPair(['views']);
  const actM = matchedPair(['likes', 'comments', 'shares', 'saves']);
  // Reach where we have it, impressions where we do not, the same way the
  // unmatched row already chose.
  const seenNow = seenM.now || impM.now;
  const seenBefore = seenM.before || impM.before;
  // Same days for every metric, so the largest single count is the answer.
  const matchedDropped = Math.max(seenM.dropped, viewsM.dropped, actM.dropped);

  /*
   * ---- the funnel ---------------------------------------------------------
   * The only thing on this page that answers the question the project exists
   * for. Four stages: a post is seen, somebody clicks out of it, somebody on
   * /show opens the booking calendar, somebody books.
   *
   * THE LAST STAGE IS NOT ZERO, IT IS UNMEASURED, and the difference is the
   * whole point. The calendar is Google's and nothing reports back from it, so
   * writing 0 there would be inventing a measurement to complete a picture.
   * "Nobody booked" is his to say; "we cannot see bookings" is ours.
   *
   * The two booking codes are `campaign = 'book'` on his own site, so a press
   * is somebody already on /show reaching for the calendar. That makes the
   * social-clicks row NOT a parent of it: most people who reach /show never
   * came through one of our links at all, and stacking them as a funnel with a
   * percentage between would claim a path the data cannot trace. They are shown
   * as separate counts with that said out loud.
   */
  const stage = (k) => funnel.find((f) => f.stage === k) || { all_time: 0, recent: 0, days: 0 };
  const social = stage('social');
  const bookPublic = stage('30zc4');
  const bookPrivate = stage('g9q8j');
  const pressesAll = (bookPublic.all_time || 0) + (bookPrivate.all_time || 0);
  const firstClickEver = funnel.reduce((min, f) =>
    (f.first_seen && (!min || f.first_seen < min) ? f.first_seen : min), null);
  // Two identical columns are not a finding, they are a window that has not
  // opened yet. Say which it is.
  const windowsOverlap = firstClickEver && firstClickEver >= shift(new Date().toISOString().slice(0, 10), -days);

  const funnelRow = (name, row, note = '') => `<tr>
    <td>${esc(name)}${note ? `<em class="sub">${esc(note)}</em>` : ''}</td>
    <td class="num">${esc(num(row.all_time || 0))}</td>
    <td class="num faint">${esc(num(row.recent || 0))}</td>
    <td class="num faint">${row.days ? `${esc(String(row.days))} days` : ''}</td></tr>`;

  const funnelCard = card('Does any of it produce a guest', `
    <div class="wrap"><table>
      <thead><tr><th></th><th class="num">all time</th><th class="num">last ${days} days</th>
        <th class="num">spread over</th></tr></thead>
      <tbody>
        ${funnelRow('clicked a link in a post', social, 'people leaving a post, counted')}
        ${funnelRow('opened the show booking calendar', bookPublic, 'the button on /show')}
        ${funnelRow('opened the private session calendar', bookPrivate, 'the one-to-one button')}
        <tr><td>booked a slot<em class="sub">Google\u2019s calendar, nothing reports back</em></td>
          <td class="num">${'\u2014'}</td><td class="num faint">${'\u2014'}</td>
          <td class="num faint">not measured</td></tr>
      </tbody>
    </table></div>
    <p class="note">${pressesAll
      ? `<b>${esc(num(pressesAll))} presses on a booking button, across ${esc(String(Math.max(bookPublic.days || 0, bookPrivate.days || 0)))} separate days.</b>
         People are reaching the calendar. Whether any of them finished is the one step here that is
         not instrumented, and it is not going to be: it is a Google page and it tells us nothing.
         If the answer is still no guests, the leak is between opening that calendar and confirming
         a time, which is a thing to look at in a browser rather than in this table.`
      : 'Nobody has opened a booking calendar yet.'}
      The booking buttons live on matewishkey.com, so a press is somebody already on the page.
      Most of them did not arrive through one of our links, which is why these rows are counts
      rather than a funnel with percentages between them: the path is not traceable and a
      percentage would claim it was.${windowsOverlap
        ? ` <b>The two columns are nearly the same window right now</b> \u2014 the first click ever recorded
          is ${esc(firstClickEver)}, so almost everything is inside the last ${days} days. They will
          separate as the record gets longer.` : ''}</p>`);

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
      ${wowRow('reach, summed', seenNow, seenBefore, num)}
      ${wowRow('video views', viewsM.now, viewsM.before, num, ytViewsBlocked)}
      ${wowRow('likes, comments, shares, saves', actM.now, actM.before, num)}
      ${wowRow('actions per post', cadenceNow ? actM.now / Math.max(recent.posts, 1) : 0,
        cadenceBefore ? actM.before / Math.max(prior.posts, 1) : 0, (v) => v.toFixed(1))}
      ${wowRow('link clicks from social (people)', clicksNow, clicksBefore, (v) => String(v))}
      ${wowRow('days we posted', cadenceNow, cadenceBefore, (v) => `${v}/7`)}
    </tbody></table></div>
  <p class="note">Both columns are seven whole days and today is in neither, because putting a
    morning against a full week draws a fall that is only the clock.
    <b>Reach, views and actions are read at ${TREND_AGE_DAYS} day old on both sides.</b> Those numbers
    keep climbing for weeks after a post goes out, so comparing last week as it stands against the
    week before as it ended made a flat channel read ten to twenty per cent down every time. Reading
    every day at the same age cancels that instead of subtracting it, which is what the revision
    trail has been recorded for. It also means these four rows are lower than the totals above:
    they are the same days caught younger, on purpose.${matchedDropped
      ? ` ${matchedDropped} platform-day${matchedDropped === 1 ? '' : 's'} could not be read at that age and
        ${matchedDropped === 1 ? 'was' : 'were'} left out of both columns rather than counted as nothing.` : ''}
    Clicks and days posted are final by midnight and need none of this.</p>`;

  const body = `
<h1>Stats</h1>
<p class="lede">Last ${spanDays || days} days${dates.length ? `, ${esc(dates[0])} to ${esc(dates[dates.length - 1])}` : ''}.
  Trend compares ${esc(short(recentFrom))}–${esc(short(recentTo))} against ${esc(short(priorFrom))}–${esc(short(priorTo))}.</p>

<div class="tiles">
  ${trendTile(num(tot.reach || tot.impressions || 0), 'reach, summed', 'plain',
    'FB + IG + LI added up — not a count of people', null)}
  ${trendTile(num(tot.views || 0), 'video views', 'plain', '', null)}
  ${trendTile(perPostAll.toFixed(1), 'actions per post',
    perPostAll >= 4 ? 'ok' : perPostAll >= 2 ? 'warn' : 'bad', 'did anyone care', null)}
  ${trendTile(human, 'link clicks from social', human ? 'ok' : 'plain',
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

${funnelCard}

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

${card('On the website', websiteRows)}

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
