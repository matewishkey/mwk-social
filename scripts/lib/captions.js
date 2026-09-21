/*
 * HOW LONG A CAPTION IS WHERE IT IS GOING, AND WHO WILL NOT TAKE IT.
 *
 * `captionLength` lived in post.js alone, so the publisher knew a post would
 * not fit X and the thing that QUEUES it did not. On 2026-09-21 a 318
 * character caption was queued for "wherever it fits", announced as going to
 * all eight platforms, and X was dropped at publish time with a line in the
 * journal nobody was reading. The post was fine everywhere else; the problem
 * was that the decision happened nine hours after the last human looked.
 *
 * So it is one module with two callers, rather than one caller that knows and
 * one that guesses. A test pins that post.js does not grow its own copy back.
 */
'use strict';

const platforms = require('./platforms');
const { URL_RE } = require('./shortlink');

/*
 * X counts every url as 23 characters however long it is — t.co wraps them
 * all — so measuring the raw string overstates our own short codes and would
 * refuse a post that actually fits. Everywhere else a character is a
 * character.
 */
function captionLength(platform, text) {
  if (platform !== 'twitter') return text.length;
  return text.replace(URL_RE, 'x'.repeat(23)).length;
}

/**
 * THE TITLE IS THE FIRST LINE OF HIS WORDS, and three things already meant
 * that before anything asked for it by name.
 *
 * Zernio makes the first line of the content a YouTube video's title;
 * queue-add refuses a first line over 100 characters for that reason; and
 * post.js takes the same line as a Pinterest pin's title. The short-caption
 * rule (mate, 2026-09-22) is the fourth reader, and it is the one that makes
 * the line load-bearing on its own — so all four go through here rather than
 * spelling `split('\n')[0]` out again.
 *
 * The first NON-EMPTY line, not literally line one: a body that opens with a
 * blank line has a title, and every caller wanting the bare `[0]` was really
 * asking for this.
 *
 * @param {string} body his words, as stored on the queue item.
 * @returns {string} the title line, trimmed; '' when there are no words.
 */
function titleLine(body) {
  return String(body == null ? '' : body).split('\n').map((l) => l.trim()).find(Boolean) || '';
}

/**
 * Which platforms HIS WORDS ALONE are too long for.
 *
 * His words are never truncated (post.js gives up our tags, then our link, and
 * stops), so a platform whose cap his words exceed is one that will not carry
 * this post at all. That is a decision worth making at the keyboard.
 *
 * @param {string} body his words, with no link and no tags — what is stored.
 * @param {string[]} wanted the item's platform list. EMPTY MEANS EVERY
 *   platform, because an empty list means "wherever it fits" and every
 *   platform is therefore a candidate.
 * @returns {{platform:string,length:number,max:number,named:boolean}[]}
 *   sorted by platform. `named` is whether he asked for that one by name,
 *   which is the difference between a refusal and a note.
 */
function wontFit(body, wanted = []) {
  const out = [];
  for (const platform of Object.keys(platforms.PLATFORMS)) {
    const { captionMax: max } = platforms.get(platform);
    if (!max) continue;                       // no cap worth the name (Facebook's 63k)
    if (wanted.length && !wanted.includes(platform)) continue;
    const length = captionLength(platform, body);
    if (length > max) out.push({ platform, length, max, named: wanted.includes(platform) });
  }
  return out.sort((a, b) => a.platform.localeCompare(b.platform));
}

/** One line a human reads, or null when everything fits. */
function wontFitLine(problems) {
  if (!problems || !problems.length) return null;
  return 'will NOT go to ' + problems
    .map((p) => `${p.platform} (his words are ${p.length}, cap ${p.max})`).join(', ');
}

module.exports = { captionLength, titleLine, wontFit, wontFitLine };
