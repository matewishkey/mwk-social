/*
 * The typos are deliberate, so the tests are about what must NOT happen: a
 * broken link, a mangled handle, a draft that renders differently the second
 * time, or a reply so mangled it reads as illiterate rather than fast.
 */
const test = require('node:test');
const assert = require('node:assert');

const typos = require('../scripts/lib/typos');

const LONG = 'Same reason people pay a developer three grand for a contact form. '
  + 'You cannot price what you have never built yourself.';

/* --------------------------------------------------------------- determinism */

/*
 * The dashboard shows the draft and then the box posts it, minutes or hours
 * later, from the same seed. If those two renders differ, he approved one thing
 * and published another — which is the whole reason this is seeded rather than
 * random.
 */
test('the same text and seed render byte for byte the same', () => {
  for (const seed of ['a', 'b', 'reply:123']) {
    assert.strictEqual(typos.humanise(LONG, { seed }), typos.humanise(LONG, { seed }));
  }
});

test('different seeds give different slips', () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(typos.humanise(LONG, { seed: `s${i}` }));
  assert.ok(seen.size > 5, `20 seeds produced only ${seen.size} distinct drafts`);
});

/* ------------------------------------------------------- what must not change */

test('a url is never touched', () => {
  const text = 'Bring it to the show and we will build it on your own machine, '
    + 'no terminal needed: https://mwkshow.com/ab12 and you keep what we make.';
  for (let i = 0; i < 200; i++) {
    assert.ok(typos.humanise(text, { seed: `s${i}` }).includes('https://mwkshow.com/ab12'),
      `seed s${i} damaged the link`);
  }
});

test('a handle and a hashtag are never touched', () => {
  const text = 'Ask @theChrisDo about pricing, he is very good on this and does not '
    + 'sugarcoat any of it, which is rarer than it should be. #MWKShow';
  for (let i = 0; i < 200; i++) {
    const out = typos.humanise(text, { seed: `s${i}` });
    assert.ok(out.includes('@theChrisDo'), `seed s${i} damaged the handle`);
    assert.ok(out.includes('#MWKShow'), `seed s${i} damaged the hashtag`);
  }
});

test('a number is never touched — a wrong price is not a typo', () => {
  const text = 'They quoted him 4500 dollars for something that took an afternoon, '
    + 'and he had already paid half of it before anyone looked at the brief.';
  for (let i = 0; i < 100; i++) {
    assert.ok(typos.humanise(text, { seed: `s${i}` }).includes('4500'));
  }
});

test('editable() refuses everything that carries meaning', () => {
  for (const w of ['https://x.com/a', 'www.xero.com', '@genemarks', '#PIY',
    'mwkshow.com/ab12', '4500', 'v2.1', 'a', 'the', 'AI']) {
    assert.equal(typos.editable(w), false, `${w} must be left alone`);
  }
  for (const w of ['reason', 'people', 'afternoon', "don't"]) {
    assert.equal(typos.editable(w), true, `${w} should be fair game`);
  }
});

/* ---------------------------------------------------------------- how sparse */

test('a short reply gets no typo at all', () => {
  const short = 'Yeah, that is the bit that gets everyone.';
  assert.ok(short.length < 60);
  for (let i = 0; i < 50; i++) {
    assert.strictEqual(typos.humanise(short, { seed: `s${i}` }), short);
  }
});

test('never more than two slips, whatever the length', () => {
  const text = `${LONG} ${LONG} ${LONG}`;   // ~360 chars, well past an X reply
  for (let i = 0; i < 100; i++) {
    assert.ok(typos.plan(text, { seed: `s${i}` }).length <= 2);
  }
});

test('one slip per word at most', () => {
  for (let i = 0; i < 100; i++) {
    const chosen = typos.plan(LONG, { seed: `s${i}` }).map((p) => p.index);
    assert.equal(new Set(chosen).size, chosen.length);
  }
});

test('the opening word is left alone — that is the one everyone sees', () => {
  // The FIRST word, not the first phrase: "reason" is fair game, "Same" is not.
  for (let i = 0; i < 200; i++) {
    assert.ok(typos.humanise(LONG, { seed: `s${i}` }).startsWith('Same '),
      `seed s${i} damaged the opening word`);
  }
});

/* ------------------------------------------------------------ the slips work */

test('every slip changes exactly one word and leaves the rest alone', () => {
  for (let i = 0; i < 100; i++) {
    const before = LONG.split(' ');
    const after = typos.humanise(LONG, { seed: `s${i}` }).split(' ');
    assert.equal(before.length, after.length, 'word count must not change');
    const diff = before.filter((w, j) => w !== after[j]);
    assert.ok(diff.length <= 2, `${diff.length} words changed`);
  }
});

test('a substituted letter is one of the keys next to it', () => {
  // The whole point of the feature: a slip has to look like a thumb, not like a
  // shuffled alphabet.
  let checked = 0;
  for (let i = 0; i < 400; i++) {
    for (const p of typos.plan(LONG, { seed: `s${i}` })) {
      if (p.kind !== 'adjacent') continue;
      const was = p.from[p.at].toLowerCase();
      const now = p.to[p.at].toLowerCase();
      assert.ok(typos.NEIGHBOURS[was].includes(now),
        `${p.from} -> ${p.to}: '${now}' is not next to '${was}'`);
      checked++;
    }
  }
  assert.ok(checked > 20, `only ${checked} adjacent slips seen — the sample is too thin to prove anything`);
});

test('the kinds that can spell a real word are the rare ones', () => {
  // "show" minus its h is "sow", which reads as a mistake of meaning rather
  // than of fingers. Those kinds stay in, because people make them — but they
  // must not be what the drafts are mostly made of.
  const n = {};
  for (let i = 0; i < 600; i++) {
    for (const p of typos.plan(LONG, { seed: `s${i}` })) n[p.kind] = (n[p.kind] || 0) + 1;
  }
  const total = Object.values(n).reduce((a, b) => a + b, 0);
  assert.ok(total > 100, 'sample too thin');
  assert.ok((n.drop || 0) / total < 0.25, `drop is ${Math.round(100 * n.drop / total)}% of slips`);
  assert.ok((n.adjacent || 0) / total > 0.3, 'the keyboard-neighbour slip should dominate');
});

test('drop and swap are kept off short words, where they spell real ones', () => {
  for (const kind of ['drop', 'swap']) {
    const min = typos.WEIGHTS.find(([k]) => k === kind)[2];
    assert.ok(min >= 6, `${kind} must not be applied to words under 6 letters`);
    assert.equal(typos.pickKind('show', 0.999), 'double',
      'a four-letter word must only get the two safe kinds');
  }
});
