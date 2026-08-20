/*
 * Composing a caption for a platform, and recognising the same clip across them.
 *
 * The opening of the source caption is carried through verbatim into every
 * mirror. That is not cosmetic: it is what makes a post we published detectable
 * as a duplicate by the next run, and by a human reading two feeds side by side.
 * Break that invariant and the dedupe matcher loses its strongest signal.
 */
'use strict';

const platforms = require('./platforms');
const voice = require('./voice');

const URL_RE = /https?:\/\/\S+/g;
const TAG_RE = /#[\p{L}\p{N}_]+/gu;

/** Split a source caption into the words, the hashtags and the links. */
function parseSource(text = '') {
  const urls = text.match(URL_RE) || [];
  const hashtags = (text.match(TAG_RE) || []).map((t) => t.slice(1));
  const body = text
    .replace(URL_RE, ' ')
    .replace(TAG_RE, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { body, hashtags, urls };
}

/**
 * The matching key: what survives copying a caption between platforms.
 * Emoji, punctuation, hashtags, links and case all vary; the words do not.
 */
function normalizeKey(text = '', length = 64) {
  return parseSource(text).body
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, '')
    .slice(0, length);
}

/** Do two captions describe the same clip? Requires a real prefix, not a stub. */
function prefixMatch(a, b, minChars = 32) {
  if (!a || !b) return false;
  const n = Math.min(a.length, b.length);
  if (n < minChars) return false;
  return a.slice(0, n) === b.slice(0, n);
}

const visibleLength = (text, urlLength) => (urlLength
  ? text.replace(URL_RE, 'x'.repeat(urlLength)).length
  : text.length);

/** Trim to a limit on a word boundary, never severing a URL. */
function truncate(text, max, urlLength) {
  if (visibleLength(text, urlLength) <= max) return text;
  const words = text.split(/(\s+)/);
  let out = '';
  for (const w of words) {
    const next = out + w;
    if (visibleLength(next, urlLength) > max - 1) break;
    out = next;
  }
  return out.trimEnd() + '…';
}

/**
 * Compose the caption for one platform.
 *
 * @returns {{text: string, warnings: string[]}}
 */
function compose(platform, { body, sourceTags = [], topicTags = [] } = {}) {
  const cfg = platforms.get(platform);
  const warnings = [];
  const parts = [body.trim()];

  if (cfg.linkPlacement === 'caption') {
    parts.push(voice.config().links.show);
  }

  if (cfg.hashtagsInCaption !== 0) {
    const wanted = cfg.hashtagsInCaption === 'all'
      ? [...topicTags, ...sourceTags]
      : topicTags;
    const line = voice.tagLine(platform, wanted);
    if (line) parts.push(line);
  }

  let text = parts.filter(Boolean).join('\n\n');
  const before = text;
  text = truncate(text, cfg.captionMax, cfg.urlLength);
  if (text !== before) warnings.push(`truncated to ${cfg.captionMax} chars`);

  // The invariants. Both are failures we have actually shipped once.
  if (!text.startsWith(body.trim().slice(0, 24))) {
    throw new Error(`${platform}: caption lost the source opening — dedupe depends on it`);
  }
  const marker = voice.marker();
  if (cfg.markerInCaption && !text.includes(marker)) {
    throw new Error(`${platform}: link belongs in the caption here but the marker is missing`);
  }
  if (!cfg.markerInCaption && text.includes(marker)) {
    throw new Error(`${platform}: the link belongs in the first comment, not the caption`);
  }
  if (cfg.hashtagsInCaption === 0 && TAG_RE.test(text)) {
    TAG_RE.lastIndex = 0;
    throw new Error(`${platform}: hashtags in the caption would eat the comment's budget`);
  }
  TAG_RE.lastIndex = 0;

  return { text, warnings };
}

module.exports = { parseSource, normalizeKey, prefixMatch, compose, truncate, visibleLength };
