/*
 * EVERY JOB REFUSES A FLAG IT DOES NOT KNOW, AND THERE IS ONE DASHBOARD CLIENT.
 *
 * `--help` once published a queued item (#37) because the publisher read its
 * flags with `argv.includes()` and let everything else through. That script
 * was fixed, three others were not, and CLAUDE.md carried the list of which
 * was which for a month. The list is a test now: a script that grows a main()
 * without a refusal fails here, not in production.
 *
 * Same for the Worker client. Four scripts carried a byte-identical fetch to
 * the dashboard; one of them would have been missed on the day the header or
 * the timeout changed. The second test fails if a copy comes back.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { flags } = require('../scripts/lib/args');

const SCRIPTS = path.join(__dirname, '..', 'scripts');

test('flags: a switch, a valued flag, and everything else refused', () => {
  const spec = { '--dry-run': { key: 'dryRun' }, '--days': { key: 'days', value: true } };
  assert.deepStrictEqual(flags([], spec), { _: [], dryRun: false, days: null });
  assert.deepStrictEqual(flags(['--dry-run', '--days', '7'], spec), { _: [], dryRun: true, days: '7' });
  assert.throws(() => flags(['--dryrun'], spec), /unknown argument: --dryrun/);
  assert.throws(() => flags(['--days'], spec), /--days wants a value/);
  assert.throws(() => flags(['--days', '--dry-run'], spec), /--days wants a value/, 'the next flag is not a value');
  // A bare word is a typo unless the script says it takes positionals.
  assert.throws(() => flags(['gUAo3DSGf-o'], spec), /unknown argument/);
  assert.deepStrictEqual(flags(['gUAo3DSGf-o', '--dry-run'], spec, { positional: true }),
    { _: ['gUAo3DSGf-o'], dryRun: true, days: null });
});

/*
 * Behaviour, not source: each job is run with a flag it cannot know, with the
 * dashboard env removed, and must die on the flag — before it reads its env,
 * before it touches the network. The positive control is that the same
 * invocation with a REAL flag gets past the parser to the script's own next
 * complaint.
 */
test('every job dies on an unknown flag before it reads its env', () => {
  const run = (script, args) => {
    try {
      execFileSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
        env: { ...process.env, MWK_LOG_URL: '', MWK_LOG_TOKEN: '' },
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000,
      });
      return { code: 0, err: '' };
    } catch (e) { return { code: e.status, err: String(e.stderr) }; }
  };
  for (const script of ['run-queue.js', 'ship-events.js', 'ship-stats.js', 'yt-description.js']) {
    const bad = run(script, ['--bogus']);
    assert.notEqual(bad.code, 0, `${script} must refuse --bogus`);
    assert.match(bad.err, /unknown argument: --bogus/, `${script}: ${bad.err.slice(0, 200)}`);
    assert.doesNotMatch(bad.err, /MWK_LOG_URL/, `${script} must refuse the flag before it reads its env`);
  }
  // Controls: a real flag gets through the parser to the script's own logic.
  assert.match(run('ship-stats.js', ['--days', 'abc']).err, /whole number of days/);
  assert.match(run('yt-description.js', ['--repropose']).err, /needs at least one video id/);
});

test('every script with a main() refuses an unknown argument somewhere', () => {
  for (const f of fs.readdirSync(SCRIPTS).filter((n) => n.endsWith('.js'))) {
    const s = fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
    if (!/^(async )?function main\(/m.test(s)) continue;
    const refuses = s.includes("require('./lib/args')") || /unknown (argument|option)/.test(s);
    assert.ok(refuses, `scripts/${f} has a main() and no refusal for an unknown flag`);
  }
});

/*
 * shortlink.js keeps its own fetch ON PURPOSE: it has to fail open, because a
 * dashboard that is down must not cost a post its comment. Everything else
 * goes through lib/dashboard.js.
 */
test('the dashboard is called from one place, plus the one that fails open', () => {
  // Keyed on the env var, not on the bearer header: Zernio and the model API
  // are bearer-authed too and are not this client's business.
  const copies = [];
  for (const dir of [SCRIPTS, path.join(SCRIPTS, 'lib')]) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const s = fs.readFileSync(path.join(dir, f), 'utf8');
      // The READ, not the name: ship-events.js documents the variable in its
      // header and that is not a second client.
      if (s.includes('process.env.MWK_LOG_URL')) copies.push(path.relative(SCRIPTS, path.join(dir, f)));
    }
  }
  assert.deepStrictEqual(copies.sort(), ['lib/dashboard.js', 'lib/shortlink.js']);
});
