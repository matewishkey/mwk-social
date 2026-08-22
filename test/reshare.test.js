/*
 * LinkedIn resharing.
 *
 * The rule this file exists for: a second personal account was connected on
 * 2026-08-22 and was invisible to the entire pipeline the moment it arrived —
 * `personal` was `all.find(a => a !== company)`, which returns the first one
 * and silently drops the rest. No error, no warning, just one fewer repost than
 * anybody expected. `find` where it should be `filter` is the whole bug.
 */
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

// accounts:list goes through lib/api's `cli`, so the fake goes in there.
function withAccounts(accounts, fn) {
  const path = require.resolve('../scripts/lib/api.js');
  const real = require.cache[path];
  delete require.cache[require.resolve('../scripts/lib/reshare.js')];
  require.cache[path] = new Module(path, null);
  require.cache[path].filename = path;
  require.cache[path].loaded = true;
  require.cache[path].exports = {
    cli: () => ({ accounts }),
    api: async () => ({ post: { _id: 'p1' } }),
  };
  try {
    return fn(require('../scripts/lib/reshare.js'));
  } finally {
    if (real) require.cache[path] = real; else delete require.cache[path];
    delete require.cache[require.resolve('../scripts/lib/reshare.js')];
  }
}

const LI = (displayName, id) => ({ platform: 'linkedin', displayName, _id: id });

test('every personal account is returned, not just the first', () => {
  withAccounts([
    LI('Mate Visky', 'a'), LI('Mate Wish Key', 'co'), LI('Zsuzsanna Elma Fay', 'b'),
  ], (reshare) => {
    const { company, personal } = reshare.linkedinAccounts();
    assert.equal(company._id, 'co');
    assert.deepStrictEqual(personal.map((p) => p._id), ['a', 'b'],
      'a third account must not vanish — this is the bug this file is about');
  });
});

test('the company page is matched on its name, not its position', () => {
  withAccounts([
    LI('Mate Wish Key', 'co'), LI('Mate Visky', 'a'),
  ], (reshare) => {
    assert.equal(reshare.linkedinAccounts().company._id, 'co');
    assert.deepStrictEqual(reshare.linkedinAccounts().personal.map((p) => p._id), ['a']);
  });
});

test('other platforms and dead connections are left out', () => {
  withAccounts([
    LI('Mate Wish Key', 'co'), LI('Mate Visky', 'a'),
    { platform: 'facebook', displayName: 'Mate Wish Key', _id: 'fb' },
    { platform: 'linkedin', displayName: 'Old One', _id: 'x', isActive: false },
  ], (reshare) => {
    const { all, personal } = reshare.linkedinAccounts();
    assert.deepStrictEqual(all.map((a) => a._id), ['co', 'a']);
    assert.deepStrictEqual(personal.map((p) => p._id), ['a']);
  });
});

test('with no company page at all, every account counts as personal', () => {
  withAccounts([LI('Mate Visky', 'a'), LI('Zsuzsanna Elma Fay', 'b')], (reshare) => {
    const { company, personal } = reshare.linkedinAccounts();
    assert.equal(company, undefined);
    assert.equal(personal.length, 2);
  });
});

/*
 * One account failing must not cost the others, and must never cost the post,
 * which is already live by the time any of this runs. Same rule as the publish
 * groups in run-queue.js, learned the same expensive way.
 */
test('one account failing does not stop the rest', async () => {
  const path = require.resolve('../scripts/lib/api.js');
  const real = require.cache[path];
  delete require.cache[require.resolve('../scripts/lib/reshare.js')];
  require.cache[path] = new Module(path, null);
  require.cache[path].loaded = true;
  require.cache[path].exports = {
    cli: () => ({ accounts: [LI('Mate Wish Key', 'co'), LI('Mate Visky', 'a'), LI('Suzy Fay', 'b')] }),
    api: async (_m, _e, { body }) => {
      if (body.platforms[0].accountId === 'a') throw new Error('422 duplicate content');
      return { post: { _id: 'ok' } };
    },
  };
  try {
    const reshare = require('../scripts/lib/reshare.js');
    const out = await reshare.reshareAll('https://linkedin.com/feed/update/urn:li:share:1');
    assert.equal(out.length, 2);
    assert.equal(out[0].ok, false);
    assert.match(out[0].error, /422/);
    assert.equal(out[1].ok, true, 'the second account must still have reposted');
  } finally {
    if (real) require.cache[path] = real; else delete require.cache[path];
    delete require.cache[require.resolve('../scripts/lib/reshare.js')];
  }
});

test('a plain repost omits content entirely, rather than sending an empty one', async () => {
  const path = require.resolve('../scripts/lib/api.js');
  const real = require.cache[path];
  delete require.cache[require.resolve('../scripts/lib/reshare.js')];
  let seen = null;
  require.cache[path] = new Module(path, null);
  require.cache[path].loaded = true;
  require.cache[path].exports = {
    cli: () => ({ accounts: [LI('Mate Wish Key', 'co'), LI('Mate Visky', 'a')] }),
    api: async (_m, _e, { body }) => { seen = body; return { post: { _id: 'ok' } }; },
  };
  try {
    const reshare = require('../scripts/lib/reshare.js');
    await reshare.reshareAll('https://linkedin.com/x');
    // The docs are explicit: leave commentary OUT for a one-click repost. An
    // empty string is not the same thing.
    assert.ok(!('content' in seen), 'content must be absent, not empty');
    assert.equal(seen.platforms[0].platformSpecificData.reshareUrl, 'https://linkedin.com/x');

    await reshare.reshareAll('https://linkedin.com/x', '  a thought  ');
    assert.equal(seen.content, 'a thought');
  } finally {
    if (real) require.cache[path] = real; else delete require.cache[path];
    delete require.cache[require.resolve('../scripts/lib/reshare.js')];
  }
});
