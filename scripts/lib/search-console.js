/*
 * Google Search Console, read only (mate, 2026-09-25): how often his two sites
 * appear in Google, and how often somebody clicks through.
 *
 * A SERVICE ACCOUNT, NOT HIS LOGIN. `gsc-reader@mwk-social-stats` lives in its
 * own Google Cloud project with only the Search Console API enabled, and he
 * added it to each property as a Restricted user, so it can read and change
 * nothing. Its key is MWK_GSC_KEY (base64 JSON) in td-sops/apps/mwk-social.
 * A personal OAuth token would have expired under the Workspace's Cloud
 * session control; this one never asks anybody anything.
 *
 * ⚠ SEARCH CONSOLE IS ~2-3 DAYS BEHIND, so the newest days are missing, not
 * zero. The page reads weeks for the same reason it does for visits.
 *
 * curl -4: no IPv6 route on this box (CLAUDE.md, Traps).
 */
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { siteHosts } = require('./site-visits');

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const iso = (d) => d.toISOString().slice(0, 10);
const b64url = (b) => Buffer.from(b).toString('base64url');

function key() {
  const raw = process.env.MWK_GSC_KEY;
  if (!raw) throw new Error('MWK_GSC_KEY is not set (run through scripts/with-secrets.sh)');
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
}

function curl(args, input = null) {
  const out = execFileSync('curl', ['-4', '-sS', '--max-time', '30', ...args],
    { input, encoding: 'utf8', maxBuffer: 1 << 24 });
  const json = JSON.parse(out);
  if (json.error) throw new Error(`google: ${json.error.message || json.error_description || JSON.stringify(json.error)}`);
  return json;
}

function token() {
  const k = key();
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: k.client_email, scope: SCOPE,
    aud: k.token_uri, iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(k.private_key).toString('base64url');
  const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${head}.${claim}.${sig}`;
  return curl(['-X', 'POST', '--data-binary', '@-', k.token_uri], body).access_token;
}

function api(tok, method, pathname, body = null) {
  const conf = [`header = "Authorization: Bearer ${tok}"`, 'header = "Content-Type: application/json"',
    `request = "${method}"`];
  if (body) conf.push(`data = ${JSON.stringify(JSON.stringify(body))}`);
  return curl(['--config', '-', `https://searchconsole.googleapis.com${pathname}`], conf.join('\n'));
}

/** The properties the robot can see. Empty until he adds it as a user. */
function properties(tok = token()) {
  return (api(tok, 'GET', '/webmasters/v3/sites').siteEntry || []).map((s) => s.siteUrl);
}

/*
 * { sites: [{ host, property, days: [{date, clicks, impressions}] }], missing: [host] }
 * A site whose property the robot cannot see is named in `missing`, so the
 * page can say "not connected" rather than print zeros.
 */
function searchStats({ days = 56, now = new Date() } = {}) {
  const tok = token();
  const visible = properties(tok);
  const sites = [];
  const missing = [];
  for (const host of siteHosts()) {
    const property = visible.find((p) => p === `sc-domain:${host}`)
      || visible.find((p) => p.replace(/\/$/, '') === `https://${host}`);
    if (!property) { missing.push(host); continue; }
    const res = api(tok, 'POST', `/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
      startDate: iso(new Date(now - days * 86400_000)), endDate: iso(now), dimensions: ['date'], rowLimit: 500,
    });
    sites.push({ host, property,
      days: (res.rows || []).map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions })) });
  }
  return { fetchedAt: now.toISOString(), sites, missing };
}

module.exports = { searchStats, properties, token };
