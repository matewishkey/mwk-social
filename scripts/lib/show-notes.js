/*
 * Show notes for an EPISODE, written from the website's own editorial record
 * rather than guessed from auto-captions.
 *
 * `matewishkey.com/api/content.json` (contract: API.md in matewishkey-web) is
 * the record of the show: every episode with its number, outcome, chapters,
 * guests and topics, every wish with the episodes it was worked on in, and
 * the people and topics they point at. Issue #40 (2026-09-18) handed it over
 * with the exact shape below, which is what the site had been hand-assembling
 * for the videos that had notes at all.
 *
 * What this replaces: for an episode, the model-written opening. That opening
 * was regenerated from the transcript on every run, so an applied description
 * never matched byte for byte and re-proposed itself, and four rebuilds sat
 * re-drafted nightly for a week. Everything here is deterministic: the same
 * content.json and the same tail render the same bytes, so the sync loop
 * converges the first time it writes.
 *
 * Three rules from the handover that are easy to get wrong:
 *   - `0:00 Start` is mandatory. YouTube ignores a chapter list whose first
 *     entry is not 0:00, silently. chapters[] begins wherever the first real
 *     chapter is, so it is prepended here.
 *   - h:mm:ss past an hour, m:ss below it. Most sessions run over two hours.
 *   - The wishes come off the WISH (`wishes[].episodes[]`), the guest chain off
 *     the OTHER episodes' `guests[]`. Neither is stored on the episode, on
 *     purpose: two copies of a relation disagree the first time a slug moves.
 *
 * `learned[]` is NOT printed. It is paragraphs, not lines — E010 carries seven
 * of them at up to 300 characters each — and YouTube's description stops at
 * 5,000. The chapter list already carries the timeline; the takeaways live on
 * the episode page the description links to. Its optional `at` is therefore
 * never touched, which is the one thing the handover asked for about it.
 */
'use strict';

const { execFileSync } = require('child_process');

const SITE = 'https://matewishkey.com';
const CONTENT_URL = `${SITE}/api/content.json`;
// YouTube's own cap. Over it the write fails, so it is checked here, where the
// section that could be dropped is named, rather than at the API.
const DESCRIPTION_MAX = 5000;

let cached = null;

/*
 * The live document. curl -4 rather than fetch: the site sits behind
 * Cloudflare, which answers on IPv6, and this box has no IPv6 route — the same
 * trap that makes Node's fetch time out on a Meta CDN (CLAUDE.md, Traps).
 */
function load() {
  if (cached) return cached;
  const text = execFileSync('curl', ['-4', '-sS', '--max-time', '30', CONTENT_URL],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const doc = JSON.parse(text);
  if (!Array.isArray(doc.episodes)) throw new Error(`${CONTENT_URL}: no episodes[]`);
  cached = doc;
  return doc;
}

/** For tests: hand in a document instead of fetching one. */
function useContent(doc) { cached = doc; }

const videoIdOf = (url) => {
  const m = String(url || '').match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
};

/** The episode whose uncut recording is this video, or null. */
function episodeFor(videoId, doc = load()) {
  const ep = doc.episodes.find((e) => e.published !== false && videoIdOf(e.raw && e.raw.url) === videoId);
  return ep || null;
}

const num = (n) => `E${String(n).padStart(3, '0')}`;

/** m:ss under an hour, h:mm:ss over it. */
function stamp(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

const abs = (p) => (/^https?:/.test(p) ? p : `${SITE}${p}`);

/**
 * The description for one episode.
 *
 * @param {object} episode  an entry of content.json's episodes[]
 * @param {object} opts
 * @param {string} opts.tail  the show blurb with this video's link in it (voice.showBlurb)
 * @param {string} [opts.tags]  the hashtag line, or '' for none
 * @param {object} [opts.doc]  the content document (tests); defaults to the live one
 */
function render(episode, { tail, tags = '', doc = load() }) {
  if (!episode || !Number.isInteger(episode.number)) throw new Error('not an episode with a number');
  if (!tail) throw new Error('an episode description needs the show tail');

  const people = new Map((doc.people || []).map((p) => [p.slug, p]));
  const topics = new Map((doc.topics || []).map((t) => [t.slug, t]));
  const episodes = (doc.episodes || []).filter((e) => e.published !== false && Number.isInteger(e.number))
    .sort((a, b) => a.number - b.number);
  const guestNames = (episode.guests || []).map((g) => (people.get(g) || {}).name || g);

  const out = [];
  out.push(`${num(episode.number)} - UNCUT - with ${guestNames.join(' and ')}`);
  out.push(String(episode.outcome || '').trim());
  out.push(`Full show notes and what got built: ${abs(episode.url)}`);

  const worked = (episode.topics || []).map((t) => topics.get(t)).filter(Boolean);
  if (worked.length) {
    out.push(['WHAT WE WORKED ON', ...worked.map((t) => `${t.title} - ${abs(t.url)}`)].join('\n'));
  }

  const wishes = (doc.wishes || []).filter((w) => w.published !== false
    && (w.episodes || []).some((e) => (e && (e.id || e)) === episode.slug));
  if (wishes.length) {
    out.push(['THE WISHES, IN THEIR OWN WORDS',
      ...wishes.map((w) => `"${String(w.quote).trim()}" - ${abs(w.url || `/wishes/${w.slug}/`)}`)].join('\n'));
  }

  const chapters = (episode.chapters || []).slice().sort((a, b) => a.at - b.at);
  const lines = chapters.map((c) => `${stamp(c.at)} ${c.title}`);
  if (!chapters.length || chapters[0].at > 0) lines.unshift('0:00 Start');
  out.push(['CHAPTERS', ...lines].join('\n'));

  for (const slug of episode.guests || []) {
    const name = (people.get(slug) || {}).name || slug;
    const more = episodes.filter((e) => e.slug !== episode.slug && (e.guests || []).includes(slug));
    if (!more.length) continue;
    out.push([`MORE WITH ${name.toUpperCase()}`,
      ...more.map((e) => `${num(e.number)} ${e.title} - ${abs(e.url)}`)].join('\n'));
  }

  const i = episodes.findIndex((e) => e.slug === episode.slug);
  const prev = i > 0 ? episodes[i - 1] : null;
  const next = i >= 0 && i < episodes.length - 1 ? episodes[i + 1] : null;
  const rest = ['THE REST OF THE SHOW'];
  if (prev) rest.push(`Previous: ${num(prev.number)} ${prev.title} - ${abs(prev.url)}`);
  if (next) rest.push(`Next: ${num(next.number)} ${next.title} - ${abs(next.url)}`);
  rest.push(`Every episode: ${SITE}/episodes/`);
  out.push(rest.join('\n'));

  const minutes = episode.raw && episode.raw.minutes;
  if (minutes) out.push(`This is the UNCUT session, ${minutes} minutes with the waiting left in. A cut version is coming.`);

  out.push(tail.trim());
  if (tags && tags.trim()) out.push(tags.trim());

  const text = out.filter(Boolean).join('\n\n');
  if (text.length > DESCRIPTION_MAX) {
    throw new Error(`${num(episode.number)}'s description is ${text.length} characters against YouTube's ${DESCRIPTION_MAX} — shorten the chapter list on the site`);
  }
  return text;
}

module.exports = { load, useContent, episodeFor, render, stamp, videoIdOf, DESCRIPTION_MAX, SITE };
