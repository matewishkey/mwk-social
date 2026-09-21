/*
 * A PLATFORM HIS WORDS WILL NOT FIT IS A DECISION, AND IT USED TO BE MADE
 * NINE HOURS AFTER ANYBODY WAS LOOKING.
 *
 * 2026-09-21: a 318 character caption was queued for "wherever it fits" and
 * announced as going to all eight platforms. At 10:45 the next morning the
 * publisher did exactly the right thing — X takes 280, his words are never
 * truncated, so X was dropped and the reason was logged. Nobody read the log.
 * The post was live and one channel short before anybody knew.
 *
 * The fix is not new behaviour at publish time, it is the same answer
 * computed at the keyboard. These tests pin: the shared implementation (so
 * the queue and the publisher cannot disagree), the named/implied split, and
 * the one output line a human actually reads.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const captions = require('../scripts/lib/captions');
const { parse } = require('../scripts/queue-add.js');

// The real caption, as stored on queue_item 01M2Z38W6ED0EC8D8SXKH1SNB4.
const REFUND = `The company has an agent. You have an agent. Let them fight it out.

That is how my wife got a refund after the deadline had passed. She pasted one prompt, added the order details, and waited.

If you want help setting up your own prompting, come on the show.

Thanks @thechrisgoor #couchtocreator

Prompt it yourself!`;

test('the caption that actually went out is caught, and only X is caught', () => {
  assert.equal(REFUND.length, 318, 'fixture drifted from the caption that shipped');
  const problems = captions.wontFit(REFUND);
  assert.deepStrictEqual(problems.map((p) => p.platform), ['twitter'],
    'X is the only cap his words broke — Threads at 500 took it fine');
  assert.equal(problems[0].max, 280);
  assert.equal(problems[0].length, 318);
});

/*
 * X counts a url as 23 characters whatever its length, so measuring the raw
 * string would refuse a post that fits. The control is the same text on a
 * platform that counts honestly.
 */
test('a url costs 23 on X and its real length everywhere else', () => {
  const text = `come on the show ${'https://matewishkey.com/some/very/long/path/indeed'}`;
  assert.equal(captions.captionLength('twitter', text), 'come on the show '.length + 23);
  assert.equal(captions.captionLength('threads', text), text.length);
});

test('an empty platform list means every platform is a candidate', () => {
  const long = 'x'.repeat(600);
  const all = captions.wontFit(long).map((p) => p.platform);
  assert.ok(all.includes('twitter'), '280');
  assert.ok(all.includes('threads'), '500');
  assert.ok(!all.includes('facebook'), 'facebook takes 63k and must never be flagged');
  assert.ok(!all.includes('linkedin'), '3000 is not broken by 600 characters');
});

test('a platform he did not ask for is never flagged', () => {
  const long = 'x'.repeat(600);
  assert.deepStrictEqual(captions.wontFit(long, ['facebook', 'linkedin']), []);
  assert.deepStrictEqual(captions.wontFit(long, ['threads']).map((p) => p.platform), ['threads']);
});

/*
 * The split that matters. Naming a platform it cannot fit is a mistake worth
 * stopping; "wherever it fits" already says a drop is acceptable, so that one
 * is reported rather than refused.
 */
test('naming a platform his words will not fit refuses the queue', () => {
  assert.throws(
    () => parse(['--body', REFUND, '--platforms', 'twitter,facebook']),
    /twitter takes 280 characters and his words are 318/);
});

test('the refusal says how to get out of it', () => {
  assert.throws(() => parse(['--body', REFUND, '--platforms', 'twitter']),
    /Shorten it, or leave twitter out of --platforms/);
});

test('"wherever it fits" is allowed through, and records what it will miss', () => {
  const opt = parse(['--body', REFUND]);
  assert.deepStrictEqual(opt.wontFit.map((p) => p.platform), ['twitter'],
    'it must be recorded, or nothing can report it');
  assert.equal(opt.wontFit[0].named, false);
});

test('a caption that fits everywhere records nothing and says nothing', () => {
  const opt = parse(['--body', 'Chris fixed his own website in an afternoon.']);
  assert.deepStrictEqual(opt.wontFit, []);
  assert.equal(captions.wontFitLine(opt.wontFit), null);
  assert.equal(captions.wontFitLine(undefined), null, 'an older caller must not crash');
});

test('the line names the platform, the length and the cap', () => {
  const line = captions.wontFitLine(captions.wontFit(REFUND));
  assert.match(line, /will NOT go to twitter/);
  assert.match(line, /318/);
  assert.match(line, /280/);
});

/*
 * THE ONE THAT MATTERS IN A YEAR. Two copies of this rule is how one of them
 * drifts, and the drift is silent: the queue would promise a platform the
 * publisher then drops, which is the bug this file exists for.
 */
test('there is exactly one captionLength, and both callers use it', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'scripts', f), 'utf8');
  const post = read('post.js');
  assert.ok(!/function captionLength/.test(post),
    'post.js has grown its own captionLength back — it must import the shared one');
  assert.match(post, /require\('\.\/lib\/captions'\)/);
  assert.match(read('queue-add.js'), /require\('\.\/lib\/captions'\)/);
});

test('queue-add prints the warning on the queued line, not further up', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'queue-add.js'), 'utf8');
  const queued = src.indexOf('queued ${id}');
  assert.ok(queued > 0, 'the success line moved');
  // Search FROM the success line: there is a second call on the dry-run path
  // above it, and a plain indexOf finds that one and proves nothing.
  const warn = src.indexOf('wontFitLine', queued);
  assert.ok(warn > queued && warn - queued < 400,
    'the warning must sit with the line he reads; higher up is the journal problem again');
});

test('a dry run says it too, because that is when he is deciding', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'queue-add.js'), 'utf8');
  const dry = src.indexOf("'-- --dry-run: nothing written, nothing uploaded'");
  const warn = src.lastIndexOf('wontFitLine', dry);
  assert.ok(dry > 0 && warn > 0 && dry - warn < 400 && warn < dry,
    'the dry-run path must print the warning as well as the success path');
});
