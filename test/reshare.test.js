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
      if (body.platforms[0].accountId === 'co') throw new Error('422 duplicate content');
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

/*
 * WHO POSTS AND WHO REPOSTS, since 2026-09-14. His profile is the native post;
 * the page and the other profile repost it. The 30-follower page had the native
 * post for a month while the 7,222 followers behind the two profiles got a
 * plain repost of it — and the repost under HER name carried a first-person
 * call to action in his voice. Words under a person's name have to be theirs.
 */
test('his profile posts natively; the page and the other profile repost', () => {
  withAccounts([
    LI('Mate Wish Key', 'co'), LI('Mate Visky', 'a'), LI('Zsuzsanna Elma Fay', 'b'),
  ], (reshare) => {
    const { owner, native, reposters } = reshare.linkedinAccounts();
    assert.equal(owner._id, 'a');
    assert.equal(native._id, 'a', 'the native post goes out under his name');
    assert.deepStrictEqual(reposters.map((r) => r._id), ['co', 'b'],
      'the page first, then the other profile; never the owner reposting himself');
  });
});

test('with his profile not connected, the old shape applies and says so', () => {
  withAccounts([LI('Mate Wish Key', 'co'), LI('Zsuzsanna Elma Fay', 'b')], (reshare) => {
    const { owner, native, reposters } = reshare.linkedinAccounts();
    assert.equal(owner, null);
    assert.equal(native._id, 'co', 'falls back to the page rather than posting to nobody');
    assert.deepStrictEqual(reposters.map((r) => r._id), ['b']);
  });
});

test('nothing in his voice goes out under another person\'s name', async () => {
  const path = require.resolve('../scripts/lib/api.js');
  const real = require.cache[path];
  delete require.cache[require.resolve('../scripts/lib/reshare.js')];
  const bodies = [];
  require.cache[path] = new Module(path, null);
  require.cache[path].loaded = true;
  require.cache[path].exports = {
    cli: () => ({ accounts: [LI('Mate Wish Key', 'co'), LI('Mate Visky', 'a'), LI('Zsuzsanna Elma Fay', 'b')] }),
    api: async (_m, _e, { body }) => { bodies.push(body); return { post: { _id: 'ok' } }; },
  };
  try {
    const reshare = require('../scripts/lib/reshare.js');
    const out = await reshare.reshareAll('https://linkedin.com/x', 'his words on top', { lagMinutes: 0 });
    assert.equal(bodies.length, 2);
    const page = bodies.find((b) => b.platforms[0].accountId === 'co');
    const hers = bodies.find((b) => b.platforms[0].accountId === 'b');
    assert.ok(page && hers, 'both repost');
    assert.equal(page.content, 'his words on top', 'the page carries his words');
    assert.ok(page.platforms[0].platformSpecificData.firstComment, 'the page carries the tracked CTA');
    assert.ok(!('content' in hers), 'her repost carries none of his words');
    assert.ok(!hers.platforms[0].platformSpecificData.firstComment, 'and no comment in his voice');
    assert.equal(out.find((r) => r.account === 'Zsuzsanna Elma Fay').plain, true);
    // Positive control: the owner never reposts his own post.
    assert.ok(!bodies.some((b) => b.platforms[0].accountId === 'a'));
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

/*
 * Two accounts reposting the same thing in the same minute reads as one person
 * running two accounts — which it is. Spaced out, each is somebody sharing
 * something they saw, and each gets its own pass at the feed. Mate's call,
 * 2026-08-22: "keep them out of sync... let's have some wait time."
 *
 * Zernio holds the later one via scheduledFor, so nothing has to stay running
 * on this box for the second repost to happen.
 */
test('the first account reposts now and the rest are staggered', async () => {
  const path = require.resolve('../scripts/lib/api.js');
  const real = require.cache[path];
  delete require.cache[require.resolve('../scripts/lib/reshare.js')];
  const bodies = [];
  require.cache[path] = new Module(path, null);
  require.cache[path].loaded = true;
  require.cache[path].exports = {
    cli: () => ({ accounts: [LI('Mate Wish Key', 'co'), LI('Mate Visky', 'a'), LI('Suzy Fay', 'b')] }),
    api: async (_m, _e, { body }) => { bodies.push(body); return { post: { _id: 'ok' } }; },
  };
  try {
    const reshare = require('../scripts/lib/reshare.js');
    const before = Date.now();
    const out = await reshare.reshareAll('https://linkedin.com/x', null, { lagMinutes: 240 });

    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].publishNow, true, 'the first goes out immediately');
    assert.ok(!bodies[0].scheduledFor);

    assert.ok(!bodies[1].publishNow, 'the second must not also publish now');
    const at = new Date(bodies[1].scheduledFor).getTime();
    const gapMin = (at - before) / 60000;
    assert.ok(gapMin > 239 && gapMin < 242, `second repost is ${gapMin} minutes out, expected ~240`);

    assert.equal(out[0].delayMinutes, 0);
    assert.equal(out[1].delayMinutes, 240);
  } finally {
    if (real) require.cache[path] = real; else delete require.cache[path];
    delete require.cache[require.resolve('../scripts/lib/reshare.js')];
  }
});

test('with one personal account there is nothing to stagger', async () => {
  const path = require.resolve('../scripts/lib/api.js');
  const real = require.cache[path];
  delete require.cache[require.resolve('../scripts/lib/reshare.js')];
  const bodies = [];
  require.cache[path] = new Module(path, null);
  require.cache[path].loaded = true;
  require.cache[path].exports = {
    cli: () => ({ accounts: [LI('Mate Wish Key', 'co'), LI('Mate Visky', 'a')] }),
    api: async (_m, _e, { body }) => { bodies.push(body); return { post: { _id: 'ok' } }; },
  };
  try {
    const reshare = require('../scripts/lib/reshare.js');
    await reshare.reshareAll('https://linkedin.com/x');
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].publishNow, true, 'a lone account must not be delayed for no reason');
  } finally {
    if (real) require.cache[path] = real; else delete require.cache[path];
    delete require.cache[require.resolve('../scripts/lib/reshare.js')];
  }
});
