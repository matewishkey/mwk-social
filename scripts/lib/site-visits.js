/*
 * Visits to his two websites, from Cloudflare Web Analytics (mate, 2026-09-25:
 * "add visitor statistics ... so we can see in relation how we are
 * progressing").
 *
 * WEB ANALYTICS, NOT THE ZONE'S REQUEST LOG. The zone counts every request,
 * and on matewishkey.com that read 500-900 "unique visitors" a day against
 * 30-180 browser page loads: nearly all of it is crawlers and asset fetches.
 * Web Analytics is the beacon a browser runs, so a bot that does not execute
 * JavaScript never appears. Both sites have it auto-installed at the edge.
 *
 * ⚠ IT IS SAMPLED 1 IN 10. `avg.sampleInterval` read 10 on both sites
 * (2026-09-25), and every count comes back as a multiple of ten. At our size a
 * day of "30 visits" is three page loads Cloudflare happened to keep, so the
 * page reads WEEKS, and says the numbers are estimates.
 *
 * ⚠ ONE SITE TAG COVERS EVERY SUBDOMAIN. matewishkey.com's tag also counts
 * editor., social. (this dashboard), jessica. and a dozen project hosts — his
 * own tools, more page loads than the site itself on some days. So every
 * query filters `requestHost` to the site's own host.
 *
 * Which sites: the show's and the course's origins in config/voice.json, the
 * same two addresses everything else here points at. The account is resolved
 * from the zone, never written down (this repo is public).
 *
 * curl -4 with the token on stdin: no IPv6 route on this box (CLAUDE.md,
 * Traps), and a header on argv is readable by anyone running `ps`.
 */
const { execFileSync } = require('child_process');
const voice = require('./voice');

const API = 'https://api.cloudflare.com/client/v4';

function cf(pathname, body = null) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not set (run through scripts/with-secrets.sh)');
  const conf = [`header = "Authorization: Bearer ${token}"`, 'header = "Content-Type: application/json"'];
  if (body) conf.push(`data = ${JSON.stringify(JSON.stringify(body))}`);
  const out = execFileSync('curl', ['-4', '-sS', '--max-time', '30', '--config', '-', `${API}${pathname}`],
    { input: conf.join('\n'), encoding: 'utf8', maxBuffer: 1 << 24 });
  const json = JSON.parse(out);
  if (json.errors && json.errors.length) throw new Error(`cloudflare ${pathname}: ${JSON.stringify(json.errors).slice(0, 200)}`);
  return json;
}

/** The two hosts, show first. */
function siteHosts() {
  const links = voice.config().links;
  return [links.show, links.course].filter(Boolean).map((u) => new URL(u).hostname);
}

const zoneOf = (host) => host.split('.').slice(-2).join('.');
const iso = (d) => d.toISOString().slice(0, 10);

function query(accountTag, siteTag, host, from) {
  const f = `{siteTag:"${siteTag}", requestHost:"${host}", date_geq:"${from}", bot:0}`;
  const q = `{ viewer { accounts(filter:{accountTag:"${accountTag}"}) {
    d: rumPageloadEventsAdaptiveGroups(limit:200, filter:${f}, orderBy:[date_ASC]) { count sum { visits } dimensions { date } }
    r: rumPageloadEventsAdaptiveGroups(limit:25, filter:${f}, orderBy:[sum_visits_DESC]) { sum { visits } dimensions { refererHost } }
    s: rumPageloadEventsAdaptiveGroups(limit:1, filter:${f}) { avg { sampleInterval } }
  } } }`;
  return cf('/graphql', { query: q }).data.viewer.accounts[0];
}

/*
 * { sites: [{ host, since, days: [{date, views, visits}], referrers: [{host, visits}], sampleInterval }] }
 * `since` is when the site's tag was created: before it, a missing day is
 * "not tracked", not zero. Referrers cover the last 28 days only.
 */
function siteVisits({ days = 56, now = new Date() } = {}) {
  const from = iso(new Date(now - days * 86400_000));
  const refFrom = iso(new Date(now - 28 * 86400_000));
  const sites = [];
  for (const host of siteHosts()) {
    const zone = cf(`/zones?name=${zoneOf(host)}`).result[0];
    if (!zone) throw new Error(`no Cloudflare zone for ${host}`);
    const account = zone.account.id;
    const tags = cf(`/accounts/${account}/rum/site_info/list`).result || [];
    const tag = tags.find((t) => (t.ruleset || {}).zone_name === zoneOf(host));
    if (!tag) throw new Error(`${host} has no Web Analytics site`);
    const a = query(account, tag.site_tag, host, from);
    const r = query(account, tag.site_tag, host, refFrom).r;
    sites.push({
      host,
      since: String(tag.created || '').slice(0, 10) || null,
      days: (a.d || []).map((g) => ({ date: g.dimensions.date, views: g.count, visits: g.sum.visits })),
      referrers: (r || []).map((g) => ({ host: g.dimensions.refererHost || '', visits: g.sum.visits }))
        .filter((x) => x.visits > 0),
      sampleInterval: ((a.s || [])[0] || { avg: {} }).avg.sampleInterval || null,
    });
  }
  return { fetchedAt: now.toISOString(), sites };
}

module.exports = { siteVisits, siteHosts };
