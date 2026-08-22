/*
 * Deliberate typos, made with the keys next to the right ones.
 *
 * A drafted reply that is spelled perfectly every time reads as a machine, and
 * on X that is the one thing that gets a reply buried. His own replies have
 * slips in them, so the drafts do too — mate's call, 2026-08-22, and his words
 * for it were "keep some typos there, use nearby buttons".
 *
 * Three rules make this safe to run unattended:
 *
 *   - DETERMINISTIC. Same text and same seed render the identical result, so a
 *     draft shown on the dashboard is byte-for-byte what gets posted. The same
 *     reason the rotating first comment is keyed off the post rather than a
 *     random number: a re-render that differs is a draft nobody approved.
 *   - NOTHING THAT CARRIES MEANING gets touched — no url, no @handle, no
 *     #hashtag, no number. A typo in a link is a broken link, not a human
 *     moment.
 *   - SPARSE. One slip per couple of sentences reads as a person typing on a
 *     phone. Three reads as illiterate, and a reply that reads as illiterate
 *     does more damage than a reply that reads as generated.
 */
'use strict';

const crypto = require('crypto');

/*
 * QWERTY neighbours — the physical keys either side of each letter, which is
 * what a thumb actually hits. Built from the standard layout: same row on both
 * sides, plus the two keys nearest on the rows above and below.
 */
const NEIGHBOURS = {
  q: 'wa',    w: 'qeas',  e: 'wrsd',  r: 'etdf',  t: 'ryfg',
  y: 'tugh',  u: 'yihj',  i: 'uojk',  o: 'ipkl',  p: 'ol',
  a: 'qwsz',  s: 'awedzx', d: 'serfxc', f: 'drtgcv', g: 'ftyhvb',
  h: 'gyujbn', j: 'huikmn', k: 'jiolm', l: 'kop',
  z: 'asx',   x: 'zsdc',  c: 'xdfv',  v: 'cfgb',  b: 'vghn',
  n: 'bhjm',  m: 'njk',
};

// Words that must survive intact whatever else happens to the sentence.
const SACRED = /^(?:[@#]|https?:|www\.)|[./]\w|\d/;

/*
 * A small deterministic PRNG. Same shape as voice.hash — sha256 of the seed,
 * read as integers — but it has to yield a SEQUENCE rather than one number, so
 * the counter goes into the digest rather than being kept as state.
 */
function rng(seed) {
  let n = 0;
  return () => {
    const d = crypto.createHash('sha256').update(`${seed}:${n++}`).digest();
    return d.readUInt32BE(0) / 0x1_0000_0000;
  };
}

/* ------------------------------------------------------------ the four slips */

/*
 * Each takes a word and a random float, and returns the word with one slip in
 * it — or null when it cannot make one without touching something it should
 * not. `at` is chosen by the caller so no kind is ever biased toward the ends.
 */
const KINDS = {
  // The key next door, which is far and away the most common real typo.
  adjacent(word, at) {
    const c = word[at].toLowerCase();
    const near = NEIGHBOURS[c];
    if (!near) return null;
    const swap = near[Math.floor((at * 7 + word.length) % near.length)];
    return word.slice(0, at) + (word[at] === c ? swap : swap.toUpperCase()) + word.slice(at + 1);
  },

  // Two letters arriving in the wrong order — the fast-typing slip.
  swap(word, at) {
    if (at + 1 >= word.length) return null;
    if (word[at] === word[at + 1]) return null;   // swapping 'll' changes nothing
    return word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2);
  },

  // A held key.
  double(word, at) {
    if (word[at] === word[at + 1] || word[at] === word[at - 1]) return null;
    return word.slice(0, at + 1) + word[at] + word.slice(at + 1);
  },

  // A key that never registered.
  drop(word, at) {
    if (word[at] === word[at + 1] || word[at] === word[at - 1]) return null;
    return word.slice(0, at) + word.slice(at + 1);
  },
};

/*
 * Weighted, and not evenly. `adjacent` and `double` are the ones that read as
 * typing; `drop` and `swap` are the ones that can accidentally spell a real
 * different word — "show" loses an h and becomes "sow", which reads as a
 * mistake of meaning rather than of fingers. They are still in, because people
 * do make them, just rarer and only on longer words where the result is
 * unlikely to be a word at all.
 */
const WEIGHTS = [
  ['adjacent', 0.40, 4],
  ['double',   0.25, 4],
  ['swap',     0.20, 6],
  ['drop',     0.15, 6],
];

/** Pick a kind this word is long enough for, from a float in [0,1). */
function pickKind(word, r) {
  const usable = WEIGHTS.filter(([, , min]) => word.length >= min);
  const total = usable.reduce((n, [, w]) => n + w, 0);
  let t = r * total;
  for (const [name, w] of usable) { t -= w; if (t <= 0) return name; }
  return usable.length ? usable[usable.length - 1][0] : null;
}

/*
 * The apostrophe one is different enough to sit outside the table: it is not a
 * slip of position, it is the thing everybody does on a phone keyboard, and it
 * applies to the whole word rather than one letter of it.
 */
const CONTRACTION = /^(\w+)['’](\w+)$/;

/* ------------------------------------------------------------------ the plan */

/** Is this word safe to damage? */
function editable(word) {
  return word.length >= 4 && !SACRED.test(word) && /^[A-Za-z][A-Za-z'’]*$/.test(word);
}

/*
 * Work out which words get slips and what kind, WITHOUT applying them. Exported
 * because it is the part worth reading in a test: what changed, where, and why
 * nothing else did.
 *
 * The first word is left alone deliberately. A typo in the opening word is the
 * one a reader is guaranteed to see, and it reads as careless rather than fast.
 */
function plan(text, { seed = '', max = null } = {}) {
  const words = String(text).split(/(\s+)/);           // keeps the whitespace
  const idx = [];
  for (let i = 0; i < words.length; i++) if (editable(words[i])) idx.push(i);

  // Under 60 characters, nothing: a one-line reply that is misspelled reads as
  // careless, where the same slip inside a paragraph reads as fast. Above that,
  // one per ~140 characters and never more than two — X caps a reply at 280, so
  // two is the ceiling in practice.
  const len = String(text).length;
  const budget = max ?? (len < 60 ? 0 : Math.min(2, Math.floor(len / 140) + 1));
  const cap = Math.max(0, Math.min(budget, Math.floor(idx.length / 5)));
  if (!cap || idx.length < 2) return [];

  const rand = rng(seed);
  const chosen = [];
  const taken = new Set();
  // Skip the first editable word — see above.
  const pool = idx.slice(1);

  for (let attempt = 0; attempt < pool.length * 3 && chosen.length < cap; attempt++) {
    const i = pool[Math.floor(rand() * pool.length)];
    if (taken.has(i)) continue;
    const word = words[i];

    const m = word.match(CONTRACTION);
    if (m && rand() < 0.5) {
      taken.add(i);
      chosen.push({ index: i, kind: 'apostrophe', from: word, to: `${m[1]}${m[2]}` });
      continue;
    }

    // Somewhere in the middle of the word: the first and last letters of a word
    // are the two a reader checks, so a slip there is the one that gets noticed.
    const at = 1 + Math.floor(rand() * Math.max(1, word.length - 2));
    const kind = pickKind(word, rand());
    const to = kind && KINDS[kind](word, at);
    if (!to || to === word) continue;

    taken.add(i);
    chosen.push({ index: i, kind, at, from: word, to });
  }

  return chosen.sort((a, b) => a.index - b.index);
}

/*
 * Put the slips in. Returns the text unchanged when there was nothing safe to
 * do — a reply with no typo is fine, a reply with a broken link is not.
 */
function humanise(text, opts = {}) {
  const words = String(text).split(/(\s+)/);
  for (const slip of plan(text, opts)) words[slip.index] = slip.to;
  return words.join('');
}

module.exports = { humanise, plan, editable, pickKind, NEIGHBOURS, KINDS, WEIGHTS };
