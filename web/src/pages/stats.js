/*
 * Stats, for a channel this size.
 *
 * The opinion baked in here, because it is the whole reason the page looks like
 * this: at our follower counts, followers are not the scoreboard. Five things
 * are worth watching, in this order —
 *
 *   1. the latest posts   how each one is doing, per platform, with its age
 *   2. views              did anyone see it
 *   3. actions per post   did anyone care (per post, so it compares across
 *                         channels — see the channel table for why a RATE
 *                         cannot)
 *   4. link clicks        the show (mwk.show) and the course (piy.show), never
 *                         added together
 *   5. follower growth    last: on the video platforms views do not come from
 *                         followers (TikTok says so outright), so it is the
 *                         result of good posts, not their cause
 *
 * Cadence left the page on 2026-09-24: the queue's pace sets it now, so it is
 * not a lever anybody pulls by looking here.
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
import { esc, card, layout, num, when } from '../lib/html.js';

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

/** The ISO day n days from the given one. Negative goes back. */
const shift = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** A short, human day: "18 Aug". The window labels, not the data. */
const short = (iso) => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })
      .format(new Date(`${iso}T00:00:00Z`));
  } catch { return iso; }
};

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

/*
 * THE PAIRING THE HEADER PROMISED AND THE CODE NEVER DID (found 2026-09-24).
 * "A day missing from one window must be missing from the other" was written
 * above and ageMatchedTotal() was called on each window separately — so the
 * older week lost four days the revision trail had not started recording yet
 * while the newer week kept all seven, and the page printed video views up
 * +6,891% (3.1k against 44). Day i of the newer week is now paired with day i
 * of the older one, per platform, and a pair is used only when BOTH can be read
 * at the same age. A platform-day with no row at all is a day nothing went out
 * there: a real zero, not an unknown.
 */
export function pairedTotals({ daily, byKey, metrics, recentFrom, priorFrom, days, ageDays }) {
  const platforms = [...new Set(daily.map((r) => r.platform))];
  let now = 0; let before = 0; let dropped = 0;
  const read = (date, platform, metric) => {
    const e = byKey[`${date}|${platform}`];
    if (!e) return 0;
    return valueAtAge(e.revisions || [], e.current, cutFor(date, ageDays), metric);
  };
  for (const platform of platforms) {
    for (let i = 0; i < days; i++) {
      const dn = shift(recentFrom, i); const db = shift(priorFrom, i);
      const vals = metrics.map((m) => [read(dn, platform, m), read(db, platform, m)]);
      if (vals.some(([a, b]) => a === null || b === null)) { dropped += 1; continue; }
      for (const [a, b] of vals) { now += a; before += b; }
    }
  }
  return { now, before, dropped };
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
  split = [], links = 0, days = WINDOW_DAYS,
  followerHistory = [], clicksByDay = [], platformSince = {}, accountSince = {},
  revisions = [], funnel = [], course = [], courseHost = null, postClicks = [] }) {
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
  const perPostNow = perPostOf(recent);
  const perPostBefore = perPostOf(prior);


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
  <p class="note"><b>Posts, per post and clicks compare across channels.</b> Seen does not: each
    platform counts it differently (reach, impressions or plays), so it is shown with its own unit.</p>`
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



  /*
   * The course's own card (2026-09-23). Its clicks are excluded from every
   * social number and from the guest funnel above; here they are by profile,
   * off the ending he put on each bio link.
   */
  const courseAll = course.reduce((a, c) => a + (c.recent || 0), 0);
  const courseRows = course.length ? `<table>
    <thead><tr><th>link</th><th class="num">all time</th><th class="num">last ${days} days</th></tr></thead>
    <tbody>${course.map((c) => `<tr>
      <td>${esc(c.tag || 'no ending, the generic link')}<div class="faint" style="font-size:.72rem">${esc(`${courseHost || ''}/${c.code}${c.tag ? `/${c.tag}` : ''}`)}</div></td>
      <td class="num">${esc(num(c.all_time || 0))}</td><td class="num faint">${esc(num(c.recent || 0))}</td></tr>`).join('')}</tbody></table>
    <p class="note">People, counted the same way as everything else. The ending names the profile
      it was put on, not the person: a link can be copied anywhere. Not included in the social
      clicks or the guest funnel.</p>`
    : '<p class="empty">Nobody has opened a course link yet.</p>';


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

  /*
   * `dropped` is counted ONCE, not once per metric. Whether a platform-day can
   * be read at an age is a fact about the row existing, not about which column
   * you ask for, so summing it across four action metrics reported 44 missing
   * days where there were 11. A number four times too big in a caveat is still
   * a wrong number, and this one would have made the page look unusable.
   */
  const matchedPair = (metrics) => pairedTotals({ daily, byKey, metrics,
    recentFrom, priorFrom, days: TREND_DAYS, ageDays: TREND_AGE_DAYS });
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
   * TOO LITTLE HISTORY IS A REASON, NOT A PERCENTAGE (2026-09-24). With the
   * revision trail starting mid-week, the pairs that survived were three quiet
   * days against three busy ones and the page printed views +4,774%. Past a
   * quarter of the pairs dropped, the matched rows say why instead of a number.
   */
  const pairsAll = new Set(daily.map((r) => r.platform)).size * TREND_DAYS;
  const thinHistory = pairsAll && matchedDropped / pairsAll > 0.25 ? 'not enough history yet' : null;

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
        ${funnelRow('clicked a show link in a post', social, 'people leaving a post, counted')}
        ${funnelRow('opened the show booking calendar', bookPublic, 'the button on /show')}
        ${funnelRow('opened the private session calendar', bookPrivate, 'the one-to-one button')}
        <tr><td>booked a slot<em class="sub">Google\u2019s calendar, nothing reports back</em></td>
          <td class="num">${'\u2014'}</td><td class="num faint">${'\u2014'}</td>
          <td class="num faint">not measured</td></tr>
      </tbody>
    </table></div>
    <p class="note">${pressesAll
      ? `<b>${esc(num(pressesAll))} presses on a booking button, over ${esc(String(Math.max(bookPublic.days || 0, bookPrivate.days || 0)))} days.</b>
         People reach the calendar; whether they finish is Google's page and is not measured. `
      : 'Nobody has opened a booking calendar yet. '}The buttons are on matewishkey.com, so these are
      counts, not a funnel: most presses did not come through one of our links.${windowsOverlap
        ? ` <b>The two columns are nearly the same window right now</b> — the first click ever recorded
          is ${esc(firstClickEver)}.` : ''}</p>`);

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
      ${wowRow('video views', viewsM.now, viewsM.before, num, ytViewsBlocked || thinHistory)}
      ${wowRow('likes, comments, shares, saves', actM.now, actM.before, num, thinHistory)}
      ${wowRow('actions per post', cadenceNow ? actM.now / Math.max(recent.posts, 1) : 0,
        cadenceBefore ? actM.before / Math.max(prior.posts, 1) : 0, (v) => v.toFixed(1), thinHistory)}
      ${wowRow('clicks on show links (people)', clicksNow, clicksBefore, (v) => String(v))}
    </tbody></table></div>
  <p class="note">Seven whole days each, today in neither. Views and actions are read at
    ${TREND_AGE_DAYS} day old on both sides, so a young week is not compared with a settled one.${matchedDropped
      ? ` ${matchedDropped} platform-day${matchedDropped === 1 ? '' : 's'} could not be read at that age and ${matchedDropped === 1 ? 'is' : 'are'} left out of both.` : ''}</p>`;

  const body = `
<h1>Stats</h1>
<p class="lede">Last ${spanDays || days} days. Trends compare ${esc(short(recentFrom))}–${esc(short(recentTo))}
  with ${esc(short(priorFrom))}–${esc(short(priorTo))}. The show is mwk.show, the course is piy.show; their clicks are never added together.</p>

<div class="tiles">
  ${trendTile(num(recent.views || 0), 'video views, last 7 days', 'plain', 'still growing for weeks', null)}
  ${trendTile(perPostNow.toFixed(1), 'actions per post, last 7 days', 'plain', 'our own taken off', null)}
  ${trendTile(human, 'show link clicks', human ? 'ok' : 'plain',
    crawler || unknown ? `${crawler + unknown} crawler hits not counted` : 'people, not crawlers',
    change(clicksNow, clicksBefore))}
  ${trendTile(courseAll, 'course link clicks', courseAll ? 'ok' : 'plain', 'piy.show', null)}
  ${trendTile(num(followersNow), 'followers', 'plain',
    bothEnds.length ? `${bothEnds.length} account${bothEnds.length === 1 ? '' : 's'}` : '',
    fFirst === fLast ? { text: 'one reading so far', tone: 'plain', dir: '', note: true }
      : change(followersNow, followersThen))}
</div>

${card('Latest posts', latestPostsCard({ posts: ((snapshots.posts || {}).body) || [], postClicks, tz }))}

${card('By format: Shorts, Reels, live', formatCard({ formats: (snapshots.formats || {}).body || null }))}

${card('Channels, side by side', channelTable)}

${card('Week on week', wow)}

${funnelCard}

<div class="two">
  ${card('Show link clicks, by channel', clickRows)}
  ${card('The course', courseRows)}
</div>

${card('Followers', followerRows)}

<style>
.sec { font-size:.82rem; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); margin:1.6rem 0 .8rem; }
table.chan td { vertical-align:middle; }
em.sub { display:block; font-style:normal; font-size:.75rem; color:var(--faint); }
table.posts td.post { min-width:16rem; }
table.posts td.top { color:var(--ok); font-weight:650; }
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
