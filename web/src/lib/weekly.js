/*
 * THE WEEKS THE STATS PAGE IS DRAWN FROM (2026-09-25, design 07: "tabs, graphs
 * not text, the journey with percentages, and baseline data").
 *
 * Eight blocks of seven whole days, the newest ending YESTERDAY, so today is in
 * none of them (a morning against seven full days draws a collapse that is only
 * the clock). "This week" is the newest block; the BASELINE is the four blocks
 * before it: their mean, and their lowest and highest as the normal range.
 *
 * What each series means, and where it can mislead, is decided here once, so
 * no chart invents its own reading:
 *
 *   seen, actions, posts   by the day the POST WAS PUBLISHED, lifetime so far
 *                          (that is how daily_metric attributes them). So the
 *                          newest week is always the youngest and still
 *                          growing: the page marks it, and a "below the band"
 *                          there is not yet a finding. Our own like, share and
 *                          first comment are already off (withoutOwnActions).
 *   clicks                 counted people (lib/clicks.js), by the day of the
 *                          click. Exact. Show, course, booking button and the
 *                          link between the two sites are four kinds, never
 *                          added together.
 *   visits                 Cloudflare Web Analytics, SAMPLED 1 in 10, so
 *                          estimates in tens. null before the site was tracked.
 *   google                 Search Console, two or three days behind.
 *   followers              at each week's end, only accounts that were already
 *                          connected in the first week with a reading.
 *                          Connecting an account is not growth: a LinkedIn
 *                          profile arrived on 22 Aug with 5,040 followers.
 *
 * A PLATFORM THAT DID NOT EXIST CANNOT HAVE GROWN. Weeks that end before a
 * platform's first row are null, a gap, never a zero, and a baseline built
 * from fewer than two real weeks is no baseline at all.
 *
 * THE RATES ARE RATIOS OF COUNTS, NOT PEOPLE MOVING ALONG. "0.6 reactions per
 * 100 seen" divides two totals from the same week; it does not follow anybody.
 * The one rate that reads as a share, links over site visits, is the share of
 * visits our links could account for: every counted click lands on the site,
 * but visits are sampled, so it is approximate and says so.
 */

export const WEEKS = 8;
export const BASE_WEEKS = 4;
export const THIS = WEEKS - 1;
const BASE_FROM = THIS - BASE_WEEKS;

const shift = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** Oldest first: [{from, to}] x n, the newest ending the day before `today`. */
export function weekBlocks(today, n = WEEKS) {
  const out = [];
  let to = shift(today, -1);
  for (let i = 0; i < n; i++) { const from = shift(to, -6); out.unshift({ from, to }); to = shift(from, -1); }
  return out;
}

/** Mean and range of the four weeks before this one, or null with under two real weeks. */
export function baseline(series) {
  const vals = series.slice(BASE_FROM, THIS).filter((v) => v != null);
  if (vals.length < 2) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { mean, min: Math.min(...vals), max: Math.max(...vals), weeks: vals.length };
}

/** above / inside / below the normal range, or none. */
export function status(v, bl) {
  if (v == null || !bl) return 'none';
  if (v > bl.max) return 'above';
  if (v < bl.min) return 'below';
  return 'inside';
}

/*
 * This week against the baseline mean, in percent. For a COUNT it is withheld
 * (null) when the mean is under 3: against a mean of 0.25 one click is +300%,
 * which is noise dressed as a finding, so the page prints the mean instead.
 * A RATE ("0.6 per 100") is small by nature, so rates pass minMean 0 and only
 * a zero mean withholds it.
 */
export const SMALL_BASE = 3;
export function pctVs(v, bl, minMean = SMALL_BASE) {
  if (v == null || !bl || !bl.mean || bl.mean < minMean) return null;
  return Math.round(((v - bl.mean) / bl.mean) * 100);
}

/** a per 100 b, one decimal; null when either side is missing or b is zero. */
export const per100 = (a, b) => (a == null || !b ? null : Math.round((a / b) * 1000) / 10);

const seenOf = (r) => r.views || r.impressions || 0;
const ACTIONS = ['likes', 'comments', 'shares', 'saves'];

/*
 * Everything the tabs draw. Inputs are plain rows, so a test can hand it a
 * fixture and read the series back.
 *   daily        daily_metric rows, own actions already taken off
 *   clicks       [{day, kind, platform}] counted clicks, kind: show|course|booking|sitelink
 *   followers    follower_point rows [{day, account_id, followers}]
 *   sites        the 'sites' snapshot body (visits), or null
 *   search       the 'search' snapshot body (Google), or null
 *   platformSince {platform: first date in daily_metric}, over the WHOLE table
 */
export function weekly({ today, daily = [], clicks = [], followers = [], sites = null, search = null, platformSince = {} }) {
  const weeks = weekBlocks(today);
  const inW = (d, w) => d >= w.from && d <= w.to;
  const per = (fn) => weeks.map(fn);

  const sumDaily = (w, fn, plat) => daily.reduce((a, r) =>
    (inW(r.date, w) && (!plat || r.platform === plat) ? a + fn(r) : a), 0);
  const clicksOf = (kind, w, plat) => clicks.reduce((a, c) =>
    (c.kind === kind && inW(c.day, w) && (!plat || c.platform === plat) ? a + 1 : a), 0);

  // Before a platform's first row it did not exist: a gap, not a zero.
  const since = (plat) => platformSince[plat] || null;
  const firstEver = Object.values(platformSince).sort()[0] || null;
  const live = (w, plat) => { const s = plat ? since(plat) : firstEver; return !s || w.to >= s; };
  const gated = (fn, plat) => per((w) => (live(w, plat) ? fn(w) : null));

  const visitSeries = (host) => {
    const s = ((sites && sites.sites) || []).find((x) => x.host === host);
    if (!s) return per(() => null);
    return per((w) => ((s.since && w.to < s.since) ? null
      : s.days.reduce((a, d) => (inW(d.date, w) ? a + d.visits : a), 0)));
  };
  const googleSeries = (host, key) => {
    const s = ((search && search.sites) || []).find((x) => x.host === host);
    if (!s) return per(() => null);
    const first = s.days.map((d) => d.date).sort()[0];
    return per((w) => ((!first || w.to < first) ? null
      : s.days.reduce((a, d) => (inW(d.date, w) ? a + (d[key] || 0) : a), 0)));
  };

  // Followers: accounts with a reading by the end of the first week that has any.
  const days = followers.map((f) => f.day).sort();
  const firstDay = days[0] || null;
  const at = (acc, day) => {
    let best = null;
    for (const f of followers) if (f.account_id === acc && f.day <= day && (!best || f.day > best.day)) best = f;
    return best ? best.followers : null;
  };
  const firstWeek = firstDay ? weeks.find((w) => w.to >= firstDay) : null;
  const accounts = firstWeek ? [...new Set(followers.map((f) => f.account_id))].filter((a) => at(a, firstWeek.to) != null) : [];
  const followerSeries = per((w) => (!firstDay || w.to < firstDay ? null
    : accounts.reduce((s, a) => s + (at(a, w.to) || 0), 0)));

  const hosts = ((sites && sites.sites) || []).map((x) => x.host);
  const [showHost = null, courseHost = null] = hosts;

  const series = {
    posts: gated((w) => sumDaily(w, (r) => r.post_count || 0)),
    seen: gated((w) => sumDaily(w, seenOf)),
    actions: gated((w) => sumDaily(w, (r) => ACTIONS.reduce((a, k) => a + (r[k] || 0), 0))),
    showClicks: gated((w) => clicksOf('show', w)),
    courseClicks: gated((w) => clicksOf('course', w)),
    bookingPresses: gated((w) => clicksOf('booking', w)),
    siteLinkClicks: gated((w) => clicksOf('sitelink', w)),
    visitsShow: showHost ? visitSeries(showHost) : per(() => null),
    visitsCourse: courseHost ? visitSeries(courseHost) : per(() => null),
    googleShown: showHost ? googleSeries(showHost, 'impressions') : per(() => null),
    googleClicked: showHost ? googleSeries(showHost, 'clicks') : per(() => null),
    followers: followerSeries,
  };

  const platforms = Object.keys(platformSince).sort((a, b) => (platformSince[a] < platformSince[b] ? -1 : 1));
  const byPlatform = Object.fromEntries(platforms.map((p) => [p, {
    since: since(p),
    posts: gated((w) => sumDaily(w, (r) => r.post_count || 0, p), p),
    seen: gated((w) => sumDaily(w, seenOf, p), p),
    actions: gated((w) => sumDaily(w, (r) => ACTIONS.reduce((a, k) => a + (r[k] || 0), 0), p), p),
    showClicks: gated((w) => clicksOf('show', w, p), p),
  }]));

  const rateOf = (fn) => weeks.map((_, i) => fn(i));
  const rates = {
    reactedPer100Seen: rateOf((i) => per100(series.actions[i], series.seen[i])),
    clickedPer100Seen: rateOf((i) => per100(series.showClicks[i], series.seen[i])),
    linksShareOfVisits: rateOf((i) => per100(series.showClicks[i], series.visitsShow[i])),
    pressesPer100Visits: rateOf((i) => per100(series.bookingPresses[i], series.visitsShow[i])),
    googleClickPer100Shown: rateOf((i) => per100(series.googleClicked[i], series.googleShown[i])),
  };
  return { weeks, series, byPlatform, rates, showHost, courseHost };
}
