/*
 * Check an episode BEFORE anything renders.
 *
 * The failure that matters here is not a crash — it is a card that renders
 * wrongly and looks fine. Two of the four icons once came out as empty squares
 * after a rename and nothing said so, and a tone name that is not a tone leaves
 * a cost sitting in plain ink on a card whose whole job is to mark costs.
 *
 * So this refuses the episode rather than drawing it. Every message names the
 * field and what it should have been, because the person fixing it is editing
 * json by hand.
 */
'use strict';

const ICONS = ['bank', 'card', 'rise', 'glass', 'cal'];
const TONES = ['good', 'warn', 'bad'];

function validate(d) {
  const out = [];
  const need = (obj, path, keys) => {
    for (const k of keys) {
      if (obj == null || obj[k] === undefined || obj[k] === '') out.push(`${path}.${k} is missing`);
    }
  };

  need(d, 'episode', ['title', 'sub', 'stamp', 'fine']);
  // Three portrait cards means three headings, or card 2 and 3 silently reuse card 1's.
  need(d, 'episode', ['title2', 'sub2', 'title3', 'sub3']);

  if (!Array.isArray(d.charts) || !d.charts.length) out.push('charts is missing or empty');
  for (const [gi, g] of (d.charts || []).entries()) {
    need(g, `charts[${gi}]`, ['head']);
    if (!Array.isArray(g.bars) || !g.bars.length) { out.push(`charts[${gi}].bars is empty`); continue; }
    for (const [bi, b] of g.bars.entries()) {
      const at = `charts[${gi}].bars[${bi}]`;
      need(b, at, ['label', 'show']);
      // One scale carries several time frames, so a bar without its period is a
      // 50-day cost that reads as a two-year one.
      if (!b.period) out.push(`${at}.period is missing — every bar must say what window it covers`);
      if (typeof b.value !== 'number' || !Number.isFinite(b.value)) out.push(`${at}.value must be a number`);
      if (b.value < 0) out.push(`${at}.value is negative — costs are positive here`);
      if (b.tone && !TONES.includes(b.tone)) out.push(`${at}.tone "${b.tone}" is not one of ${TONES.join(', ')}`);
    }
  }

  if (!Array.isArray(d.columns) || !d.columns.length) out.push('columns is missing or empty');
  for (const [i, c] of (d.columns || []).entries()) {
    const at = `columns[${i}]`;
    need(c, at, ['name', 'lead', 'leadNote', 'verdict', 'icon']);
    if (c.icon && !ICONS.includes(c.icon)) out.push(`${at}.icon "${c.icon}" is not one of ${ICONS.join(', ')}`);
    if (c.mark && !TONES.includes(c.mark)) out.push(`${at}.mark "${c.mark}" is not one of ${TONES.join(', ')}`);
    if (!Array.isArray(c.rows) || c.rows.length < 2) out.push(`${at}.rows needs at least two rows`);
    // The last row is styled as the answer, so it has to BE the answer.
    const last = (c.rows || [])[(c.rows || []).length - 1];
    if (last && !/^costs? you/i.test(String(last[0]))) {
      out.push(`${at}: the last row is "${last[0]}" — it is rendered as the answer, so it should start "Costs you"`);
    }
  }

  need(d.lodge || {}, 'lodge', ['title', 'text']);
  need(d.generous || {}, 'generous', ['title', 'close']);
  if (!Array.isArray((d.generous || {}).points) || !d.generous.points.length) {
    out.push('generous.points is empty');
  }
  need(d.box || {}, 'box', ['title', 'note']);
  if (!Array.isArray((d.box || {}).rows) || !d.box.rows.length) out.push('box.rows is empty');
  for (const [i, r] of ((d.box || {}).rows || []).entries()) {
    if (r[1] && r[2] && !TONES.includes(r[2])) out.push(`box.rows[${i}] tone "${r[2]}" is not a tone`);
  }

  // The date is the point of a card people are invited to re-run. A stamp with no
  // year in it is a stamp somebody forgot to change.
  if (d.stamp && !/\b20\d{2}\b/.test(d.stamp)) out.push('stamp has no year in it');

  return out;
}

module.exports = { validate, ICONS, TONES };
