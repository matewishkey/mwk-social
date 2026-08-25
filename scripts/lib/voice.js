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
    // The guard matches ANY of these. The primary must be among them, or a
    // plain comment would compose fine and then not be recognised as ours.
    cached.markers = cached.markers && cached.markers.length ? cached.markers : [cached.marker];
    if (!cached.markers.includes(cached.marker)) {
      throw new Error(`${CONFIG_PATH}: markers must include the primary marker "${cached.marker}"`);
    }
    const short = cached.shortLink;
    if (short && short.enabled) {
      if (!short.host) throw new Error(`${CONFIG_PATH}: shortLink.enabled needs shortLink.host`);
      if (!cached.markers.some((m) => short.host.includes(m.split('/')[0]))) {
        throw new Error(`${CONFIG_PATH}: no marker would match a ${short.host} link — the guard would re-comment on every post`);
      }
    }
    for (const v of [...cached.firstComment.plain, ...cached.firstComment.episode]) {
      if (!v.includes('{show}')) throw new Error(`${CONFIG_PATH}: every variant must contain {show} — offender: ${v.slice(0, 40)}`);
      if (v.includes('{episodes}') && !cached.links.episodes) {
        throw new Error(`${CONFIG_PATH}: a variant asks for {episodes} but links.episodes is not set`);
      }
    }
    const blurb = (cached.youtubeDescription || {}).showBlurb;
    if (blurb && !blurb.includes('{show}')) {
      throw new Error(`${CONFIG_PATH}: youtubeDescription.showBlurb must contain {show} — without it every video would share one untracked link`);
    }
    // Same rule as profileCta, for the same reason: the guard finds the CTA by
    // matching the text, so a phrasing it does not know is a comment we wrote
    // and cannot recognise — and the watcher writes another one, every run.
    for (const [platform, phrase] of Object.entries(cached.firstComment.profileCtaBy || {})) {
      if (!cached.markers.includes(phrase)) {
        throw new Error(`${CONFIG_PATH}: firstComment.profileCtaBy.${platform} "${phrase}" is not in markers[] — the guard would re-comment on every one of them`);
      }
    }
  }
  return cached;
}

/*
 * A variant that carries a url of its own, whichever form it takes. Used to drop
 * one from the pool where urls are not clickable — see usable() below.
 */
const CARRIES_URL = /\{episodeUrl\}|\{episodes\}|https?:\/\//;

const marker = () => config().marker;
const markers = () => config().markers.slice();

/**
 * Does this text already carry our call to action, whoever put it there?
 *
 * Matches any known marker, which is what lets the CTA change host without the
 * watcher re-commenting on every post it wrote before the change.
 */
const carriesCta = (text) => {
  const t = String(text || '');
  return config().markers.some((m) => t.includes(m));
};

/**
 * What {show} becomes where no url can be followed.
 *
 * Per platform, because "link in my bio" is Instagram's words and would be
 * nonsense under a YouTube Short — there the clickable thing is the channel,
 * which is YouTube's own documented way out of a Short. Falls back to the
 * default, so a platform that needs no override does not need an entry.
 */
const profileCta = (platform = null) => {
  const fc = config().firstComment;
  return (platform && (fc.profileCtaBy || {})[platform]) || fc.profileCta;
};

const shortLink = () => config().shortLink || { enabled: false };
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
  variantIndex = null, showUrl = null, noTags = false, linkLive = true } = {}) {
  const cfg = config();
  const fc = cfg.firstComment;

  /*
   * On Instagram and TikTok a url in a post or a comment is plain text — the
   * whole link-in-bio industry exists because of it. `linkLive: false` says so,
   * and two things follow: {show} becomes the bio phrasing instead of a tracked
   * code, and any variant carrying a SECOND url is dropped from the pool,
   * because that url is just as dead as the CTA one would have been.
   *
   * The test is any url, not one named placeholder. It was `{episodeUrl}` alone,
   * which was right for exactly as long as that was the only variant carrying a
   * link — the archive line added on 2026-08-24 would have printed a dead
   * matewishkey.com/episodes/ under every Instagram post. A literal http:// in a
   * hand-written variant is caught by the same expression.
   */
  const usable = (pool) => (linkLive ? pool : pool.filter((v) => !CARRIES_URL.test(v)));

  // Pinning names a line out of the plain list, so it also rules out an episode
  // variant: a human picked that exact wording and must get it, not a quote.
  const pinned = Number.isInteger(variantIndex);
  const episodes = (noEpisode || pinned) ? [] : latestEpisodes();
  const wantEpisode = episodes.length > 0 &&
    (hash(key, 'mix') % 1000) / 1000 < (fc.episodeMixRatio ?? 0);

  const pool = usable(wantEpisode ? fc.episode : fc.plain);
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
    .replace(/\{show\}/g, linkLive ? (showUrl || cfg.links.show) : profileCta(platform))
    .replace(/\{wish\}/g, episode ? episode.wish : '')
    .replace(/\{episodeTitle\}/g, episode ? episode.title : '')
    .replace(/\{episodeUrl\}/g, episode ? episode.url : '')
    .replace(/\{episodes\}/g, cfg.links.episodes || '');

  // noTags is for a platform whose CAPTION already carries them — repeating the
  // list under the post shows it twice, and on Instagram would spend the cap
  // twice. Defensive, not a stated Instagram rule — see CLAUDE.md, corrected 2026-08-24.
  const tags = noTags ? '' : tagLine(platform, topicTags);
  if (tags) text += `\n\n${tags}`;

  // Any known marker will do: with a short link the text carries mwkshow.com/…
  // rather than the long URL, and both must count as "this is ours".
  if (!carriesCta(text)) {
    throw new Error(`composed comment carries none of the markers ${cfg.markers.join(', ')} — refusing to post`);
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
  // #MWKShow alone — the brand, since slice() keeps the first — rather than two
  // tags on a one-tag budget.
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

/*
 * The constant tail of every YouTube description. `{show}` is substituted with
 * whatever link the caller has minted for that video, so a click can be traced
 * back to the episode it came from — which episode is pulling is the one thing
 * YouTube's own analytics will not tell us. With no argument it renders the
 * plain sign-up url, which is what every description carried before 2026-08-23.
 */
/*
 * The tail of a YouTube description, with its link slot filled in.
 *
 * There is no longer a "the link is dead here" branch. A Short's description
 * does render every url as plain text, so the address cannot be CLICKED — but
 * naming the channel instead left the video with no address at all, and mate
 * found exactly that on the dashboard on 2026-08-25. A Short now gets a short,
 * typeable code (mwkshow.com/s3) which a person can read off the screen and
 * type; yt-description.js asks for the `s` sequence, and that is the only
 * difference between a Short's tail and any other.
 *
 * `link` being null is the never-fatal path: a mint we could not make falls
 * back to the plain address rather than costing the description.
 */
const showBlurb = (link = null) =>
  config().youtubeDescription.showBlurb.split('{show}').join(link || config().links.show);

/*
 * Find OUR blurb inside a description, whatever went into its {show} slot.
 *
 * The point is that "ours" must not mean "carries the exact link we would mint
 * today". yt-description used to test for two literal shapes — the current tail
 * and the plain-url one — so a description holding any THIRD shape (an older
 * code, a Short's channel phrasing) read as "not ours", took the full rebuild
 * path, and came back as a model-rewritten summary for him to re-approve. Words
 * he already said yes to, changed for no reason he asked for.
 *
 * Matching the constant halves either side of the slot recognises every shape
 * at once and keeps the fix to the one line that is actually out of date.
 *
 * @returns {string|null} the exact substring to swap, or null if not ours.
 */
function findBlurb(text) {
  const yd = config().youtubeDescription;
  const body = String(text || '');
  /*
   * Today's wording first, then every wording this channel has carried.
   *
   * Without the past list this function is only honest until the next time the
   * blurb is edited: `before` is the whole blurb up to the slot, so changing one
   * paragraph makes every description already written unrecognisable, and an
   * unrecognised blurb takes the REBUILD path — a fresh model-written opening
   * for all of them. The 2026-08-24 fix taught this function to see past the
   * link that went into the slot; this teaches it to see past the prose around
   * it, which is the same lesson one layer out.
   */
  let best = null;
  for (const raw of [yd.showBlurb, ...(yd.showBlurbPast || [])]) {
    const at = raw.indexOf('{show}');
    if (at < 0) continue;
    const before = raw.slice(0, at);
    const after = raw.slice(at + '{show}'.length);
    const start = body.indexOf(before);
    if (start < 0) continue;
    const slotAt = start + before.length;

    let found;
    if (after) {
      const end = body.indexOf(after, slotAt);
      if (end < 0) continue;
      found = body.slice(start, end + after.length);
    } else {
      /*
       * The blurb ENDS with its link slot — true since the "Live on ..." line
       * was dropped on 2026-08-25 — so there is no constant text after it to
       * anchor on, and indexOf('') answers with the slot's own start. That
       * returned a blurb cut off immediately before its address, and the swap
       * would then have left the old url stranded on the line.
       *
       * The slot runs to the end of ITS LINE: a url has no whitespace in it,
       * and the profile phrasings ("link in my bio") have spaces but never a
       * newline.
       */
      const nl = body.indexOf('\n', slotAt);
      found = body.slice(start, nl < 0 ? body.length : nl);
    }
    /*
     * LONGEST WINS, rather than first match, and this is load-bearing.
     *
     * Today's blurb and the one retired on 2026-08-25 share every word before
     * the slot — the only difference is the trailing "Live on ..." line. So on
     * a description still carrying that line BOTH patterns match, and the newer
     * (shorter) one matches a strict prefix of the older. Returning it would
     * swap the prose and leave the Live line sitting underneath, orphaned:
     * precisely the line the change exists to remove, surviving the change.
     */
    if (!best || found.length > best.length) best = found;
  }
  return best;
}

module.exports = {
  config, marker, markers, carriesCta, shortLink, alwaysTags, blockedTags, maxTopicTags, capFor,
  firstComment, tagLine, latestEpisodes, showBlurb, findBlurb, profileCta, hash, CONFIG_PATH,
};
