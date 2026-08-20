/*
 * Verifying the assertion Cloudflare Access puts on every request it admits.
 *
 * This is the second lock on the same door. `workers_dev = false` and the
 * Access application in front of the hostname are the first; if either is ever
 * detached or misconfigured, requests arrive here with no assertion and are
 * refused. Since the dashboard now shares a hostname with public paths (the
 * short links) that matters more than it used to: the gate must not depend on
 * Access path-ordering, and here it doesn't.
 */

let jwksCache = { at: 0, keys: null };

async function jwks(env) {
  if (jwksCache.keys && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const res = await fetch(`https://${env.ACCESS_TEAM}/cdn-cgi/access/certs`);
  const { keys } = await res.json();
  jwksCache = { at: Date.now(), keys };
  return keys;
}

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/**
 * @returns {Promise<string|null>} the identity's email, or null if no good.
 */
export async function accessIdentity(request, env) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return null;
  const [rawHeader, rawPayload, rawSignature] = jwt.split('.');
  if (!rawSignature) return null;

  let header; let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(rawHeader)));
    payload = JSON.parse(new TextDecoder().decode(b64url(rawPayload)));
  } catch { return null; }

  const jwk = (await jwks(env)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key,
    b64url(rawSignature), new TextEncoder().encode(`${rawHeader}.${rawPayload}`));
  if (!ok) return null;

  // Audience and expiry are checked here too. A signature alone would accept a
  // valid token minted for a DIFFERENT application in the same Access org.
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(env.ACCESS_AUD)) return null;
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
  return payload.email || 'unknown';
}

// Compared byte by byte in constant time. A length-leaking early return on a
// bearer token is a small thing, but it costs nothing to not do it.
export function tokenOk(given, expected) {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// Crockford base32, no vowels — a code is read aloud and typed by hand often
// enough that I and O and U are not worth the support cost.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now = Date.now()) {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) { time = ALPHABET[t % 32] + time; t = Math.floor(t / 32); }
  const rand = crypto.getRandomValues(new Uint8Array(16));
  return time + Array.from(rand, (b) => ALPHABET[b % 32]).join('').slice(0, 16);
}

/** A short, lowercase, unambiguous link code. */
export function shortCode(len = 5) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join('').toLowerCase();
}
