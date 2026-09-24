const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const prompts = require('../scripts/lib/prompts');
const voice = require('../scripts/lib/voice');

function withIndex(list, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-'));
  const f = path.join(dir, 'prompts.json');
  fs.writeFileSync(f, JSON.stringify({ prompts: list }));
  try { return fn(`file://${f}`); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('a Short is PIY only when the course site lists it, and the number is the site one', () => {
  withIndex([
    { code: '005', slug: 'how-we-use-ai-in-2026', shorts: ['HBt7-bHwnX4'] },
    { code: '002', slug: 'fix-errors-with-ai', shorts: ['X_mPQ-pN_dM', 'dCkWZVH4cYM'] },
    { code: '', slug: 'no-number-yet', shorts: ['nonumber123'] },
  ], (index) => {
    assert.strictEqual(prompts.forShort('HBt7-bHwnX4', { index }).code, '005');
    assert.strictEqual(prompts.forShort('dCkWZVH4cYM', { index }).code, '002', 'a page may gather two shorts');
    assert.strictEqual(prompts.forShort('someShowClip', { index }), null, 'a show short gets no line');
    assert.strictEqual(prompts.forShort('nonumber123', { index }), null, 'a page without a code is not live');
  });
});

test('the PIY line goes above the show tail exactly once, and a re-run changes nothing', () => {
  const tail = voice.showBlurb('mwk.show/s12');
  const piy = prompts.line({ code: '005' });
  assert.strictEqual(piy, 'The prompt: piy.show/005');

  const before = `A clip about agents.\n\n${tail}\n\n#mwkshow #piy #promptityourself`;
  const once = prompts.place(before, tail, piy);
  assert.strictEqual(once, `A clip about agents.\n\n${piy}\n\n${tail}\n\n#mwkshow #piy #promptityourself`);
  assert.strictEqual(prompts.place(once, tail, piy), once, 'no second copy on the next sync');

  // The swap path still finds the blurb after the line went in above it, so a
  // later tail change does not turn a PIY Short into a rebuild.
  assert.strictEqual(voice.findBlurb(once), tail);

  // The control: a show short is left exactly as it was.
  assert.strictEqual(prompts.place(before, tail, null), before);
});
