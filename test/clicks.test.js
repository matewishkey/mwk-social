/*
 * What counts as a click.
 *
 * The dashboard counted 182 human clicks where about 49 stand up, and the whole
 * shape of the answer was wrong with them: the YouTube description read as the
 * biggest click source we have (87) when it is very nearly the smallest (2).
 * Nothing was broken — `bot = 0` did exactly what it says, and the fetchers
 * that present as an ordinary browser walked straight through it.
 *
 * These tests pin the rule and, more importantly, pin that every query which
 * counts clicks goes through it. A raw `bot = 0` added to one new query is how
 * this comes back, and it would come back silently and flatteringly.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'web', 'src', ...p), 'utf8');
const clicksSrc = read('lib', 'clicks.js');
const indexSrc = read('index.js');

/*
 * The window is a measured value, not a round one: the gap distribution runs
 * dense to 5s, thin to 46s, then jumps to 94s. Anything inside that gap is the
 * same decision; a value outside it is a different claim and should have to
 * change this test to land.
 */
test('the burst window sits in the gap the data actually shows', () => {
  const m = clicksSrc.match(/export const BURST_SECONDS = (\d+)/);
  assert.ok(m, 'BURST_SECONDS must be stated');
  const s = Number(m[1]);
  assert.ok(s > 46 && s < 94, `BURST_SECONDS ${s} is outside the measured gap (46s..94s)`);
});

/*
 * SYMMETRIC, and this is the whole finding. A backward-looking de-duplication
 * ("not within 60s AFTER a previous hit") is the obvious way to write this and
 * keeps the first hit of every fetch wave — still a crawler. On the real table
 * that is the difference between 30 counted YouTube-description clicks and 2.
 */
test('a click counts only if nothing else hit that code on EITHER side', () => {
  assert.match(clicksSrc, /ABS\(/, 'the window must be symmetric, or every fetch wave still counts once');
  assert.match(clicksSrc, /b\.id <> \$\{alias\}\.id/, 'a hit must not exclude itself');
  assert.match(clicksSrc, /b\.code = \$\{alias\}\.code/, 'the window is per code');
});

test('counted() requires both halves: flagged human AND alone', () => {
  const { counted } = evalModule(clicksSrc);
  const sql = counted('c');
  assert.match(sql, /c\.bot = 0/, 'the User-Agent test is still the first filter');
  assert.match(sql, /NOT EXISTS/, 'and it is no longer the only one');
});

/*
 * The one that matters in a year. Every query that counts clicks for display
 * must go through lib/clicks.js — a new one written with `bot = 0` would look
 * right, pass review, and quietly restore the old number.
 */
test('no query counts clicks with a bare bot = 0', () => {
  for (const file of ['index.js', 'api.js', path.join('pages', 'stats.js'), path.join('pages', 'links.js')]) {
    const src = read(...file.split(path.sep));
    // Prose in a comment is fine; SQL is not. Look only at lines that are SQL.
    const offending = src.split('\n').filter((l) => /bot\s*=\s*[01]/.test(l) && !/^\s*\*/.test(l));
    assert.deepStrictEqual(offending, [], `${file} compares bot directly: ${offending.join(' | ')}`);
  }
});

test('index.js counts clicks through the shared rule everywhere', () => {
  assert.match(indexSrc, /import \{ counted, automated \} from '\.\/lib\/clicks\.js'/);
  // Every SELECT that reads the click table must mention counted() or be the
  // split query, which classifies rather than filters.
  const uses = indexSrc.match(/\$\{counted\('c'\)\}/g) || [];
  assert.ok(uses.length >= 6, `expected every click query to use counted(); found ${uses.length}`);
});

/*
 * A tiny loader, because web/src is ESM and the tests are CommonJS. The exports
 * are kept as plain locals so they can still call each other — counted() is
 * built out of alone(), and rewriting both to properties would break that.
 */
function evalModule(src) {
  const names = [...src.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);
  const body = src.replace(/^export const /gm, 'const ');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn { ${names.join(', ')} };`)();
}
