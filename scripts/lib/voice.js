/*
 * Everything the pipeline says out loud, composed from config/voice.json.
 *
 * The same three lines under every post is dull to read and is a spam signal to
 * the platforms, so the invitation rotates: a variant is chosen deterministically
 * from the post's own key, which means re-running a job renders the identical
 * comment (safe) while consecutive posts differ (varied). Some of the time the
 * comment quotes a real guest wish pulled from the show's feed.
 *
 * Two things are never negotiable: the URL is emitted byte-for-byte from the
 * config, and the marker substring survives into the output. The duplicate guard
 * keys off that marker — break it and the watcher comments twice on every post.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const CONFIG_PATH = process.env.MWK_VOICE_CONFIG ||
  path.join(__dirname, '..', '..', 'config', 'voice.json');

let cached = null;
function config() {
  if (!cached) {
    cached = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!cached.marker) throw new Error(`${CONFIG_PATH}: marker is required`);
    if (!cached.links || !cached.links.show) throw new Error(`${CONFIG_PATH}: links.show is required`);
    if (!cached.links.show.includes(cached.marker)) {
      throw new Error(`${CONFIG_PATH}: links.show must contain the marker "${cached.marker}"`);
    }
    for (const v of [...cached.firstComment.plain, ...cached.firstComment.episode]) {
      if (!v.includes('{show}')) throw new Error(`${CONFIG_PATH}: every variant must contain {show} — offender: ${v.slice(0, 40)}`);
    }
  }
  return cached;
}

const marker = () => config().marker;
const alwaysTags = () => config().tags.always.slice();
const blockedTags = () => new Set(config().tags.blocked);
const maxTopicTags = () => config().tags.maxTopic;
const capFor = (platform) => (config().tags.caps || {})[platform] ?? null;

// Deterministic, uniformly distributed, and stable across runs and machines.
function hash(str, salt = '') {
  return parseInt(crypto.createHash('sha256').update(`${salt}:${str}`).digest('hex').slice(0, 8), 16);
}

/* ---------------------------------------------------------------- the feed */

let feedCache = { at: 0, items: null };

// The show's RSS. Each item's description opens with the guest's own wish in
// quotes, which is the only part worth quoting back.
function latestEpisodes({ maxAgeMs = 3600_000 } = {}) {
  if (feedCache.items && Date.now() - feedCache.at < maxAgeMs) return feedCache.items;
  let xml;
  try {
    xml = execFileSync('curl', ['-sL', '--max-time', '20', '-A', 'mwk-social/1.0', '--', config().feed],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 22 });
  } catch {
    feedCache = { at: Date.now(), items: [] };   // freshness must never block a comment
    return [];
  }
  const items = [];
  for (const block of xml.split('<item>').slice(1)) {
    const pick = (tag) => {
      const m = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
      return m ? unescapeXml(m[1].trim()) : '';
    };
    const description = pick('description');
    // "I should focus on sales, because …  — A sales channel of his own, …"
    const wish = (description.split(' — ')[0] || '').trim().replace(/^["“]|["”]$/g, '');
    const link = pick('link');
    if (!wish || !link || !/\/episodes\//.test(link)) continue;
    items.push({ wish, title: pick('title'), url: link, pubDate: pick('pubDate') });
  }
  feedCache = { at: Date.now(), items };
  return items;
}

const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

/* ------------------------------------------------------------ the comment */

/**
 * Compose the first comment for one post.
 *
 * @param {string} key       stable per post, e.g. "instagram:18146814235536540"
 * @param {object} opts
 * @param {string} opts.platform
 * @param {string[]} opts.topicTags  bare names, no leading '#'
 * @param {number} opts.avoidIndex   variant index used last on this platform
 * @param {boolean} opts.noEpisode   force a plain variant
 * @param {number} opts.variantIndex pin one plain variant instead of rotating
 * @returns {{text: string, variant: string, index: number}}
 */
function firstComment(key, { platform, topicTags = [], avoidIndex = -1, noEpisode = false,
  variantIndex = null } = {}) {
  const cfg = config();
  const fc = cfg.firstComment;

  // Pinning names a line out of the plain list, so it also rules out an episode
  // variant: a human picked that exact wording and must get it, not a quote.
  const pinned = Number.isInteger(variantIndex);
  const episodes = (noEpisode || pinned) ? [] : latestEpisodes();
  const wantEpisode = episodes.length > 0 &&
    (hash(key, 'mix') % 1000) / 1000 < (fc.episodeMixRatio ?? 0);

  const pool = wantEpisode ? fc.episode : fc.plain;
  let index;
  if (pinned) {
    if (variantIndex < 0 || variantIndex >= pool.length) {
      throw new Error(`no such comment variant: ${variantIndex} (0-${pool.length - 1})`);
    }
    index = variantIndex;
  } else {
    index = hash(key, platform || '') % pool.length;
    if (pool.length > 1 && index === avoidIndex) index = (index + 1) % pool.length;
  }

  const episode = episodes[hash(key, 'ep') % Math.max(episodes.length, 1)] || null;
  let text = pool[index]
    .replace(/\{show\}/g, cfg.links.show)
    .replace(/\{wish\}/g, episode ? episode.wish : '')
    .replace(/\{episodeTitle\}/g, episode ? episode.title : '')
    .replace(/\{episodeUrl\}/g, episode ? episode.url : '');

  const tags = tagLine(platform, topicTags);
  if (tags) text += `\n\n${tags}`;

  if (!text.includes(cfg.marker)) {
    throw new Error(`composed comment lost the marker "${cfg.marker}" — refusing to post`);
  }
  return { text, variant: wantEpisode ? 'episode' : 'plain', index };
}

/**
 * The always-on tags first — the motto short form and the brand — then as many
 * topic tags as the platform's cap allows. Instagram's cap of 5 counts the
 * caption too, so callers that put hashtags in the caption must not use this for
 * the comment as well.
 */
function tagLine(platform, topicTags = []) {
  const cfg = config();
  const cap = capFor(platform);
  // A cap tighter than the always-on pair wins: X allows one tag, so it gets
  // #PIY alone rather than two tags on a one-tag budget.
  const always = cap === null ? cfg.tags.always : cfg.tags.always.slice(0, cap);
  const room = cap === null ? cfg.tags.maxTopic : Math.max(0, cap - always.length);
  const blocked = blockedTags();
  const topics = topicTags
    .map((t) => String(t).replace(/^#/, ''))
    .filter((t) => t && !blocked.has(t.toLowerCase()))
    .slice(0, Math.min(room, cfg.tags.maxTopic))
    .map((t) => `#${t}`);
  return [...always, ...topics].join(' ');
}

const showBlurb = () => config().youtubeDescription.showBlurb;

module.exports = {
  config, marker, alwaysTags, blockedTags, maxTopicTags, capFor,
  firstComment, tagLine, latestEpisodes, showBlurb, hash, CONFIG_PATH,
};
