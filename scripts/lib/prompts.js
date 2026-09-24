/*
 * The course site's own list of prompt pages, and what it means for us.
 *
 * PROMPTITYOURSELF.COM OWNS THE PIY NUMBERS (issue #46, owner's decision
 * 2026-09-24). It publishes /prompts.json: number, code, slug, url, and the
 * YouTube ids of the shorts each page gathers. So both questions we ask of it
 * are answered there and never here:
 *   - queue-add: which number does this prompt page have?  (by slug)
 *   - yt-description: is this Short a PIY one, and which number?  (by video id)
 *
 * curl -4, not fetch: this box has no IPv6 route and undici's Happy Eyeballs
 * window gives up before trying IPv4 (CLAUDE.md, Traps).
 */
const { execFileSync } = require('child_process');
const voice = require('./voice');

const indexUrl = () => `${new URL(voice.config().links.course).origin}/prompts.json`;

const cache = new Map();
function read(src = indexUrl()) {
  if (!cache.has(src)) {
    const text = execFileSync('curl', ['-4', '-sL', '--fail', '--max-time', '20', '--', src],
      { encoding: 'utf8', maxBuffer: 1 << 24 });
    cache.set(src, JSON.parse(text).prompts || []);
  }
  return cache.get(src);
}

const validCode = (p) => p && /^\d{3,4}$/.test(String(p.code || ''));

/** The prompt page a YouTube Short belongs to, or null when it is not a PIY short. */
function forShort(videoId, { index } = {}) {
  const hit = read(index).find((p) => (p.shorts || []).includes(videoId));
  return validCode(hit) ? hit : null;
}

/*
 * The line a PIY Short's description carries above the show blurb (mate,
 * 2026-09-25: "we can do both"). Both addresses are typed, never tapped — a url
 * in a Short's description is plain text — and they go to two different places
 * for two different reasons: the prompt this video used, and the show.
 */
function line(page) {
  if (!page) return null;
  return voice.config().youtubeDescription.piyLine.split('{code}').join(page.code);
}

/*
 * Put the PIY line directly above the tail, once. Pure, so the sync's
 * "already what we would write" compare stays a string compare: a description
 * that already carries the line is returned unchanged, which is what stops a
 * second copy landing on every run.
 */
function place(text, tail, piy) {
  if (!piy || text.includes(piy)) return text;
  const at = text.lastIndexOf(tail);
  if (at < 0) return `${text.trim()}\n\n${piy}`;
  return `${text.slice(0, at)}${piy}\n\n${text.slice(at)}`;
}

module.exports = { read, forShort, line, place, indexUrl };
