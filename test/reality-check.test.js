/*
 * The reality-check card generator.
 *
 * What is worth pinning here is not the design — it is the two ways a card can
 * come out WRONG and look fine: an icon name that renders an empty square (which
 * happened, to two of four, after a rename), and a cost sitting in plain ink on a
 * card whose only job is to mark costs. Both are caught before anything renders.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { validate, ICONS, TONES } = require('../scripts/reality-check/validate.js');
const DIR = path.join(__dirname, '..', 'scripts', 'reality-check');
const example = () => JSON.parse(fs.readFileSync(path.join(DIR, 'example.json'), 'utf8'));

test('the example in the repo is a valid episode', () => {
  assert.deepEqual(validate(example()), []);
});

test('an icon name nothing draws is refused, not rendered as an empty square', () => {
  const d = example();
  d.columns[0].icon = 'spiral';                 // the real rename that broke two cards
  assert.match(validate(d).join('\n'), /icon "spiral" is not one of/);
});

test('every icon the validator allows is one the renderer can actually draw', () => {
  // The two lists living apart is exactly how the empty squares happened.
  const src = fs.readFileSync(path.join(DIR, 'compare.js'), 'utf8');
  const block = src.slice(src.indexOf('const ICONS'), src.indexOf('const chip'));
  for (const name of ICONS) {
    assert.ok(new RegExp(`\\b${name}\\s*:`).test(block), `compare.js has no icon called ${name}`);
  }
});

test('a bar with no period is refused, because one scale carries several windows', () => {
  const d = example();
  delete d.charts[0].bars[1].period;
  assert.match(validate(d).join('\n'), /period is missing/);
});

test('a tone that is not a tone would leave a cost in plain ink', () => {
  const d = example();
  d.columns[1].mark = 'danger';
  assert.match(validate(d).join('\n'), /mark "danger" is not one of/);
  const e = example();
  e.charts[0].bars[0].tone = 'green';
  assert.match(validate(e).join('\n'), /tone "green" is not one of/);
  assert.deepEqual(TONES, ['good', 'warn', 'bad']);
});

test('the last row of a column is styled as the answer, so it must be one', () => {
  const d = example();
  d.columns[0].rows[d.columns[0].rows.length - 1] = ['Interest', '$0'];
  assert.match(validate(d).join('\n'), /rendered as the answer/);
});

test('an undated card is refused — the whole point is that it can be re-run', () => {
  const d = example();
  d.stamp = 'Rates as published recently.';
  assert.match(validate(d).join('\n'), /stamp has no year/);
});

test('the three portrait cards each need their own heading', () => {
  // Without these, cards 2 and 3 silently reuse card 1's title and read as duplicates.
  for (const k of ['title2', 'sub2', 'title3', 'sub3']) {
    const d = example();
    delete d[k];
    assert.match(validate(d).join('\n'), new RegExp(`episode\\.${k} is missing`));
  }
});

test('compare.js refuses to render rather than drawing a broken card', () => {
  const src = fs.readFileSync(path.join(DIR, 'compare.js'), 'utf8');
  assert.match(src, /const problems = validate\(d\)/);
  assert.match(src, /process\.exit\(65\)/);
});

test('the renderer measures its own overflow instead of cropping silently', () => {
  // A card that loses its bottom row and says nothing is the one that gets published.
  const src = fs.readFileSync(path.join(DIR, 'compare.js'), 'utf8');
  assert.match(src, /scrollHeight - c\.clientHeight/);
  assert.match(src, /OVERFLOW/);
});

test('the brand is vendored, licences included, and not re-typed', () => {
  const brand = JSON.parse(fs.readFileSync(path.join(DIR, 'brand', 'brand.json'), 'utf8'));
  assert.equal(brand.colors.red, '#e2342b');
  assert.equal(brand.colors.redDeep, '#f0524a');
  for (const f of ['Fraunces.ttf', 'JetBrainsMono.ttf', 'Manrope.ttf']) {
    assert.ok(fs.existsSync(path.join(DIR, 'brand', 'fonts', f)), `${f} is not vendored`);
  }
  const ofl = fs.readdirSync(path.join(DIR, 'brand', 'fonts')).filter((f) => f.startsWith('OFL-'));
  assert.equal(ofl.length, 3, 'every vendored face needs its licence beside it');
});
