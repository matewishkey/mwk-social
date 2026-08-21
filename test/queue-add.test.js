/*
 * Queueing from the box. The dangerous part is not the network — it is the
 * text: his words go into a SQL literal, and an apostrophe is the most ordinary
 * character in English prose. The one time this was done by hand it had to be
 * escaped by hand too.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { lit, sqlFor, parse } = require('../scripts/queue-add.js');

test('an apostrophe in his words cannot end the string early', () => {
  assert.equal(lit("Nobody's brother"), "'Nobody''s brother'");
  assert.equal(lit("'; DROP TABLE queue_item; --"), "'''; DROP TABLE queue_item; --'");
});

test('nothing is not an empty string, it is NULL', () => {
  for (const empty of [null, undefined, '']) assert.equal(lit(empty), 'NULL');
});

test('every column the insert names has a value, and the counts match', () => {
  const opt = parse(['--body', "It's fine", '--platforms', 'linkedin,threads',
    '--topics', '#Invoicing, LatePayments']);
  const sql = sqlFor(opt, '01ABC', [null, null], [null, null], '2026-08-21T00:00:00.000Z');
  const columns = sql.match(/\(([^)]*)\)\nVALUES/s)[1].split(',').length;
  // The values list is one parenthesised group; count top-level commas in it.
  const values = sql.slice(sql.indexOf('VALUES')).split('\n').join(' ');
  const depth = [];
  let top = 1;
  for (const ch of values.slice(values.indexOf('(') + 1, values.lastIndexOf(')'))) {
    if (ch === "'") { depth[0] = !depth[0]; continue; }
    if (depth[0]) continue;
    if (ch === ',') top++;
  }
  assert.equal(top, columns, `${top} values for ${columns} columns`);
});

test('a mistyped platform is refused rather than posted nowhere', () => {
  assert.throws(() => parse(['--body', 'x', '--platforms', 'facebok']), /not a platform: facebok/);
});

test('no platforms means wherever it fits, not nowhere', () => {
  const opt = parse(['--body', 'x']);
  assert.deepEqual(opt.platforms, []);
  assert.match(sqlFor(opt, '01ABC', [null, null], [null, null], 'now'), /'\[\]'/);
});

test('topics lose their hash and their spaces', () => {
  assert.deepEqual(parse(['--body', 'x', '--topics', ' #Invoicing , LatePayments ']).topics,
    ['Invoicing', 'LatePayments']);
});

test('the defaults are a first comment and a personal repost', () => {
  const on = parse(['--body', 'x']);
  assert.equal(on.firstComment, 1);
  assert.equal(on.reshare, 1);
  const off = parse(['--body', 'x', '--no-first-comment', '--no-reshare']);
  assert.equal(off.firstComment, 0);
  assert.equal(off.reshare, 0);
});
