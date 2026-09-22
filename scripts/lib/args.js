/*
 * FLAGS ARE REFUSED, NOT IGNORED.
 *
 * `argv.includes('--dry-run')` reads the one flag it was asked about and lets
 * every other argument through — so `--dryrun`, `--dry_run` and `--help` are
 * all "no flags", which for the publisher was a live post (#37: `--help`
 * claimed an item and posted it to three platforms while somebody looked up
 * the flag list; Instagram and TikTok cannot delete). Four scripts were fixed
 * one at a time and three kept the bare `includes()`; this is the one parser
 * so the next script cannot be the fourth.
 *
 * Two shapes only, because that is all the jobs need: a boolean switch, and a
 * switch that takes exactly one value. Anything with positionals or repeated
 * flags (post.js, queue-add.js, first-comment.js) has its own parser and its
 * own refusal already.
 */
'use strict';

const fs = require('fs');

/**
 * @param {string[]} argv `process.argv.slice(2)`
 * @param {Record<string, { key: string, value?: boolean }>} spec
 *   `'--dry-run': { key: 'dryRun' }` for a switch,
 *   `'--days': { key: 'days', value: true }` for one that takes the next arg.
 * @param {{ positional?: boolean }} [opts] allow bare arguments (video ids);
 *   they come back under `_`. Off by default, so a typo cannot hide as one.
 * @returns {Record<string, any>} every key from the spec, `false`/`null` when
 *   absent, plus `_` when positionals are allowed.
 */
function flags(argv, spec, opts = {}) {
  const out = { _: [] };
  for (const f of Object.values(spec)) out[f.key] = f.value ? null : false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const f = spec[a];
    if (f) {
      if (!f.value) { out[f.key] = true; continue; }
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} wants a value`);
      out[f.key] = v;
      i++;
      continue;
    }
    if (opts.positional && !a.startsWith('-')) { out._.push(a); continue; }
    throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

/**
 * The header comment of a script, verbatim — it is the usage text and the
 * only copy of it, so `--help` cannot drift from what the file says.
 */
function usageFromHeader(file) {
  const src = fs.readFileSync(file, 'utf8');
  const header = src.slice(src.indexOf('/*'), src.indexOf('*/'));
  return header.replace(/^\/\*\n?/, '').replace(/^ ?\* ?/gm, '').trimEnd();
}

module.exports = { flags, usageFromHeader };
