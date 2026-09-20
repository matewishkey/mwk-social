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

/*
 * The first line of his words is the YouTube title, and YouTube cuts it at
 * 100. Nothing said so until 2026-09-20; a long opening sentence would have
 * gone out chopped. The positive control is the same body with youtube left
 * out of --platforms, which must pass — the cap is YouTube's, not ours.
 */
test('a first line over 100 characters is refused when YouTube may carry it', () => {
  const long = `${'a'.repeat(101)}\nsecond line`;
  assert.throws(() => parse(['--body', long]), /first line becomes the YouTube title and is 101/);
  assert.throws(() => parse(['--body', long, '--platforms', 'youtube,facebook']), /YouTube cuts it at 100/);
  assert.doesNotThrow(() => parse(['--body', long, '--platforms', 'facebook,threads']));
  assert.doesNotThrow(() => parse(['--body', `${'a'.repeat(100)}\nsecond line`]));
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

/*
 * A held item. The queue could express "not too fast" and not "not until
 * Monday", so a run laid out over three weeks emptied itself in two days.
 *
 * The hold WAS a bare date, which sorts before every timestamp inside its own
 * day and so unlocked at midnight UTC. That made 10:05 Brisbane the publish
 * time of every held item, eleven days running, so since 2026-09-21 it is
 * stored as a full timestamp with 0-60 minutes rolled into it. The claim still
 * compares it against an ISO now; a timestamp compares the same way a date did.
 */
test('--at rides into the insert, and no --at is NULL rather than a date', () => {
  const held = parse(['--body', 'x', '--at', '2026-08-31']);
  assert.match(sqlFor(held, '01ABC', [null, null], [null, null], 'now'), /'2026-08-31T00:\d\d:00\.000Z'\)/);
  const free = parse(['--body', 'x']);
  assert.equal(free.at, undefined);
  assert.match(sqlFor(free, '01ABC', [null, null], [null, null], 'now'), /NULL\);/);
});

test('a hold that is not a date is refused, not held for ever', () => {
  for (const bad of ['monday', '31-08-2026', '2026-8-31', '2026-13-99']) {
    assert.throws(() => parse(['--body', 'x', '--at', bad]), /--at/);
  }
});

test('a bare hold date sorts before every moment of its own day', () => {
  // This is the whole reason the claim can compare a date against a timestamp.
  assert.ok('2026-08-31' <= '2026-08-31T00:00:00.000Z');
  assert.ok('2026-08-31' <= '2026-08-31T23:59:59.999Z');
  assert.ok(!('2026-08-31' <= '2026-08-30T23:59:59.999Z'));
});

test('the claim query actually reads not_before, or the column is decoration', () => {
  const fs = require('node:fs');
  const api = fs.readFileSync(require.resolve('../web/src/api.js'), 'utf8');
  const claim = api.slice(api.indexOf('async function claim'));
  assert.match(claim, /not_before IS NULL OR not_before <= \?1/);
});
