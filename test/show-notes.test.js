/*
 * AN EPISODE'S DESCRIPTION IS WRITTEN FROM THE SITE, AND IT IS THE SAME BYTES
 * EVERY TIME.
 *
 * Issue #40 handed over content.json with the exact shape a description takes.
 * These pin the parts of that shape that are easy to get wrong — the mandatory
 * 0:00, the hour boundary in timestamps, relations read off the wish and off
 * the OTHER episodes rather than off the episode — and the one absence that is
 * deliberate: learned[] is never printed, so its optional `at` is never touched.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const notes = require('../scripts/lib/show-notes.js');

const DOC = {
  people: [
    { slug: 'bernadett-doka', name: 'Bernadett Doka', kind: 'guest', url: '/guests/bernadett-doka/' },
    { slug: 'adrienn-volcz', name: 'Adrienn Volcz', kind: 'guest', url: '/guests/adrienn-volcz/' },
  ],
  topics: [
    { slug: 'survey-creation', title: 'Survey creation', url: '/topics/survey-creation/' },
    { slug: 'website-building', title: 'Website building', url: '/topics/website-building/' },
  ],
  episodes: [
    { slug: 'her-first-terminal', number: 1, title: 'First terminal. Agent running.', guests: ['bernadett-doka'],
      topics: ['website-building'], outcome: 'Her first terminal.', raw: { url: 'https://www.youtube.com/watch?v=EkDrk_-Y5V8', minutes: 91 },
      chapters: [{ at: 0, title: 'Hello' }], learned: [{ title: 'Standalone, no timestamp' }], published: true, url: '/episodes/her-first-terminal/' },
    { slug: 'movement-into-xero', number: 3, title: 'Xero, Dropbox, OneDrive. Connected.', guests: ['adrienn-volcz'],
      topics: [], outcome: 'Xero.', raw: { url: 'https://www.youtube.com/watch?v=gT4JOsLi_l0', minutes: 191 },
      chapters: [], published: true, url: '/episodes/movement-into-xero/' },
    { slug: 'she-built-the-surveys-herself', number: 7, title: 'Psychologist. Surveys. Done.', guests: ['bernadett-doka'],
      topics: ['survey-creation', 'website-building'], outcome: 'She came back with the questionnaire finished.',
      raw: { url: 'https://www.youtube.com/watch?v=q7zYRxJuWaI', minutes: 106 },
      chapters: [{ at: 46, title: 'Second' }, { at: 1, title: 'First' }, { at: 3725, title: 'Past the hour' }],
      learned: [{ at: 4603, title: 'One project, one job' }, { title: 'No timestamp, on purpose' }],
      published: true, url: '/episodes/she-built-the-surveys-herself/' },
    { slug: 'unpublished', number: 8, title: 'Draft', guests: ['bernadett-doka'], topics: [], outcome: 'x',
      raw: { url: 'https://www.youtube.com/watch?v=fcVMh77mFVY', minutes: 1 }, chapters: [], published: false, url: '/episodes/unpublished/' },
  ],
  wishes: [
    { slug: 'a-questionnaire-for-her-clients', quote: 'I want a questionnaire.', guest: 'bernadett-doka', published: true,
      episodes: [{ id: 'a-website-for-her-practice', at: 5820 }, { id: 'she-built-the-surveys-herself', at: 75 }] },
    { slug: 'somebody-elses', quote: 'Not this episode.', guest: 'adrienn-volcz', published: true,
      episodes: [{ id: 'movement-into-xero', at: 1 }] },
  ],
};
notes.useContent(DOC);

const TAIL = 'Bring me something you wish your computer did.\nhttps://mwkshow.com/abcde';

test('the episode is found by its uncut recording, and a plain video is not an episode', () => {
  assert.equal(notes.episodeFor('q7zYRxJuWaI').number, 7);
  assert.equal(notes.episodeFor('gUAo3DSGf-o'), null, 'a video no episode names must stay null, never guessed');
  assert.equal(notes.episodeFor('fcVMh77mFVY'), null, 'an unpublished episode is not an episode yet');
});

test('timestamps: m:ss under an hour, h:mm:ss over it', () => {
  assert.equal(notes.stamp(1), '0:01');
  assert.equal(notes.stamp(46), '0:46');
  assert.equal(notes.stamp(3599), '59:59');
  assert.equal(notes.stamp(3600), '1:00:00');
  assert.equal(notes.stamp(3725), '1:02:05');
});

test('the description carries every section in the handover\'s order, with 0:00 Start prepended', () => {
  const ep = notes.episodeFor('q7zYRxJuWaI');
  const text = notes.render(ep, { tail: TAIL, tags: '#MWKShow #PIY' });
  const lines = text.split('\n');
  assert.equal(lines[0], 'E007 - UNCUT - with Bernadett Doka');
  assert.equal(lines[2], 'She came back with the questionnaire finished.');
  assert.match(text, /Full show notes and what got built: https:\/\/matewishkey\.com\/episodes\/she-built-the-surveys-herself\//);
  assert.match(text, /WHAT WE WORKED ON\nSurvey creation - https:\/\/matewishkey\.com\/topics\/survey-creation\/\nWebsite building - /);
  // Off the wish's own episode list — and only the wish that names this episode.
  assert.match(text, /THE WISHES, IN THEIR OWN WORDS\n"I want a questionnaire\." - https:\/\/matewishkey\.com\/wishes\/a-questionnaire-for-her-clients\//);
  assert.ok(!text.includes('Not this episode'), 'a wish worked on elsewhere must not appear');
  // Chapters sorted, 0:00 Start prepended because the first real one is at 0:01.
  assert.match(text, /CHAPTERS\n0:00 Start\n0:01 First\n0:46 Second\n1:02:05 Past the hour\n/);
  // The guest chain is the OTHER published episodes with her, never this one, never the draft.
  assert.match(text, /MORE WITH BERNADETT DOKA\nE001 First terminal\. Agent running\. - https:\/\/matewishkey\.com\/episodes\/her-first-terminal\/\n/);
  assert.ok(!/MORE WITH BERNADETT DOKA[\s\S]*E007/.test(text), 'the episode must not list itself');
  assert.ok(!text.includes('E008'), 'an unpublished episode is not in the chain');
  assert.match(text, /THE REST OF THE SHOW\nPrevious: E003 Xero, Dropbox, OneDrive\. Connected\. - https:\/\/matewishkey\.com\/episodes\/movement-into-xero\/\nEvery episode: https:\/\/matewishkey\.com\/episodes\/\n/);
  assert.ok(!text.includes('Next:'), 'the latest published episode has no next');
  assert.match(text, /This is the UNCUT session, 106 minutes with the waiting left in\./);
  assert.ok(text.trimEnd().endsWith('#MWKShow #PIY'), 'the tag line closes it');
  assert.ok(text.includes(TAIL), 'the show tail is in it, verbatim');
  assert.ok(text.indexOf(TAIL) < text.indexOf('#MWKShow'), 'the tail sits before the tags');
  // learned[] is deliberately absent, so its optional `at` is never invented.
  assert.ok(!text.includes('One project, one job'), 'learned[] is not printed');
  assert.equal(notes.render(ep, { tail: TAIL, tags: '#MWKShow #PIY' }), text, 'deterministic: the same input renders the same bytes');
});

test('an episode with nothing to relate still renders, without empty sections', () => {
  const ep = notes.episodeFor('gT4JOsLi_l0');
  const text = notes.render(ep, { tail: TAIL });
  assert.equal(text.split('\n')[0], 'E003 - UNCUT - with Adrienn Volcz');
  assert.ok(!text.includes('WHAT WE WORKED ON'), 'no topics, no section');
  assert.match(text, /CHAPTERS\n0:00 Start\n\n/, 'no chapters still gets the mandatory 0:00');
  assert.match(text, /THE WISHES, IN THEIR OWN WORDS\n"Not this episode\."/);
  assert.ok(!text.includes('MORE WITH'), 'her only episode: no chain');
  assert.match(text, /Previous: E001 .*\nNext: E007 /);
});

test('a description over YouTube\'s 5,000 is refused, not truncated', () => {
  const ep = { ...notes.episodeFor('q7zYRxJuWaI'),
    chapters: Array.from({ length: 200 }, (_, i) => ({ at: i * 10, title: `Chapter ${i} with a long enough title to add up` })) };
  assert.throws(() => notes.render(ep, { tail: TAIL }), /against YouTube's 5000/);
});

/*
 * The wiring in yt-description.js: an episode is decided BEFORE the swap path,
 * because every episode already carried our tail and "ours === tail" would
 * have said nothing to do for ever. Read off the source, since the order is
 * the fix.
 */
test('sync() asks whether a video is an episode before it takes the swap path', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'yt-description.js'), 'utf8');
  const syncAt = src.indexOf('async function sync(');
  const episodeAt = src.indexOf('if (showNotes.episodeFor(id))', syncAt);
  const swapAt = src.indexOf('const ours = voice.findBlurb(existing);', syncAt);
  assert.ok(episodeAt > syncAt && swapAt > syncAt, 'both branches must exist inside sync()');
  assert.ok(episodeAt < swapAt, 'the episode branch has to come before the swap path');
  const buildAt = src.indexOf('async function build(');
  const body = src.slice(buildAt, src.indexOf('const blurbChosen'));
  assert.ok(body.indexOf('showNotes.episodeFor(id)') < body.indexOf("throw new Error('no transcript available"),
    'build() must decide the episode case before it can fail on a missing transcript');
});
