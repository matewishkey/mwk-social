/*
 * Finding a post worth replying to on X, and writing the reply.
 *
 * The strategy came out of measurement, not a guess, and the first version of
 * it was wrong. Searching all of X for strangers asking answerable questions
 * returned 0 usable posts out of 168 — the people this show is for are not on X
 * phrasing their problems in searchable ways, and half of what matches is
 * marketers using the same words. What DOES work is the opposite and is what X
 * itself rewards: reply early, to accounts already in your niche, with
 * something specific. Measured on the follow list, 22 people produced 6 posts
 * worth answering in 24 hours — more than the five a day he wants.
 *
 * Three rules hold the whole thing up:
 *
 *   1. NEVER under someone selling. Mate's rule, 2026-08-22, in his words:
 *      "I do not want to go behind other gurus when they are promoting their
 *      stuff, that is not nice." The triage exists to enforce it.
 *   2. NO LINK, ever. X deprioritises a post carrying an external url and a
 *      reply is the worst place to spend that. The route to the show is the
 *      bio, which is why the bio link is the tracked one.
 *   3. NOTHING GOES OUT UNATTENDED. Everything here drafts; he releases.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const typos = require('./typos');
const { api } = require('./api');

const CONFIG_PATH = process.env.MWK_REPLIES_CONFIG ||
  path.join(__dirname, '..', '..', 'config', 'replies.json');

let cached = null;
function config() {
  if (!cached) cached = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return cached;
}

/* --------------------------------------------------------------- the search */

// X caps a query at 512 characters, so the watch list goes out in chunks.
function queriesFor(handles, perQuery = 8) {
  const out = [];
  for (let i = 0; i < handles.length; i += perQuery) {
    out.push(`(${handles.slice(i, i + perQuery).map((h) => `from:${h}`).join(' OR ')}) -is:retweet -is:reply lang:en`);
  }
  return out;
}

/*
 * A high-water mark per query, and it is what makes this affordable.
 *
 * X bills half a cent PER POST RETURNED. Five chunk queries at forty posts each
 * is 200 reads, a dollar, every run — and best practice says run often, because
 * a reply inside the first half hour is the one that travels. At a twenty
 * minute cadence that is seventy dollars a day for the same tweets over and
 * over. `sinceId` makes each run return only what is genuinely new, which for
 * thirty-nine accounts is a few dozen posts across a whole day.
 *
 * Outside the repo, next to the other run state, because it is a fact about
 * this box's history rather than about the project.
 */
const CURSOR_PATH = process.env.MWK_REPLY_CURSOR ||
  path.join(process.env.HOME || '/tmp', '.local', 'state', 'mwk-social', 'reply-cursor.json');

function cursors() {
  try { return JSON.parse(fs.readFileSync(CURSOR_PATH, 'utf8')); } catch { return {}; }
}

function saveCursors(next) {
  fs.mkdirSync(path.dirname(CURSOR_PATH), { recursive: true });
  fs.writeFileSync(CURSOR_PATH, JSON.stringify(next, null, 1));
}

/*
 * The key is the query itself, not its position in the list: adding one handle
 * to the watch list reshuffles every chunk, and a cursor keyed by index would
 * then be applied to the wrong set of people — silently, and in the direction
 * that HIDES posts.
 */
const cursorKey = (query) => require('crypto').createHash('sha1').update(query).digest('hex').slice(0, 12);

async function search(accountId, query, { limit = 40, sinceId = null } = {}) {
  const q = { accountId, query, limit };
  if (sinceId) q.sinceId = sinceId;
  const r = await api('GET', '/twitter/search', { query: q });
  return { tweets: r.tweets || [], newestId: (r.meta || {}).newestId || null };
}

/*
 * Every chunk query, from wherever each one got to last time. Returns the
 * tweets and a `commit` the caller runs only once the run has actually
 * succeeded — advancing the cursor before the work is done would drop those
 * posts for ever, which is the same rule ship-events.js follows.
 */
async function sweep(accountId, queries, { first = 40, fresh = 40 } = {}) {
  const was = cursors();
  const now = { ...was };
  const tweets = [];
  for (const query of queries) {
    const key = cursorKey(query);
    try {
      const r = await search(accountId, query, {
        limit: was[key] ? fresh : first,
        sinceId: was[key] || null,
      });
      tweets.push(...r.tweets);
      if (r.newestId) now[key] = r.newestId;
    } catch (err) {
      // One chunk failing must not advance its cursor, and must not stop the
      // others: a bad handle in one group would otherwise blind the whole run.
      console.error(`search failed: ${err.message.slice(0, 120)}`);
    }
  }
  return { tweets, commit: () => saveCursors(now) };
}

/* ---------------------------------------------------------------- the sieve */

/*
 * Everything that can be decided without spending a model call. Order matters
 * only for the reason each rejection is reported — it is what tells you whether
 * a quiet day is a quiet feed or a broken filter.
 */
function sieve(tweets, { known = new Set(), recentAuthors = new Set(), now = Date.now() } = {}) {
  const cfg = config();
  const pick = cfg.pick;
  const blocked = [...cfg.avoid.promo, ...cfg.avoid.bait, ...cfg.avoid.nogo];
  const kept = [];
  const dropped = {};
  const drop = (why) => { dropped[why] = (dropped[why] || 0) + 1; };

  // Newest first, so when the cap bites it keeps the freshest — a reply inside
  // the first half hour is the one that travels.
  const sorted = [...tweets].sort((a, b) => new Date(b.created) - new Date(a.created));

  for (const t of sorted) {
    if (known.has(String(t.id))) { drop('already seen'); continue; }
    if (recentAuthors.has(t.author.username)) { drop('author replied to recently'); continue; }
    const ageH = (now - new Date(t.created).getTime()) / 3600000;
    if (ageH > pick.maxAgeHours) { drop('too old'); continue; }
    if (t.replyCount > pick.maxRepliesOnPost) { drop('already a crowd'); continue; }
    const low = t.text.toLowerCase();
    if (blocked.some((b) => low.includes(b))) { drop('blocked phrase'); continue; }
    if (t.text.replace(/https?:\/\/\S+/g, '').trim().length < 60) { drop('nothing to answer'); continue; }
    kept.push(t);
  }
  return { kept, dropped };
}

/* ---------------------------------------------------------------- the model */

async function gemini(prompt, { model, timeout = 120000 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set (it comes from ~/.secrets, via with-secrets.sh)');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model || config().triage.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(timeout),
    });
  const j = await res.json();
  if (j.error) throw new Error(`gemini: ${j.error.message}`);
  return JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
}

/*
 * One call for the whole batch: is this worth a reply, and is it worth it TO
 * US? "Substantive" alone is not the bar — the first run of this rated a
 * designer's post about signage and a net-worth post as worth answering, and
 * neither has anything to do with somebody stuck doing their own admin.
 */
function triagePrompt(tweets) {
  return `You are choosing which posts are worth a thoughtful public reply.

WHO IS REPLYING. He runs a live show. Someone turns up with a real problem out of their own work,
or an idea they have never tested, and they build it together on that person's own computer while
they talk. No terminal, no experience needed. The people it is for are shop owners, freelancers,
designers, photographers, consultants, teachers, doctors — people who never learned to code and
now feel shut out. He is not a teacher or an expert. He has just built the thing before.

Classify each numbered post as exactly one of:

  worth   — a substantive post he could add a SPECIFIC thought to, and that is at least adjacent to
            his world: doing work by hand, paying someone for something small, tools, pricing,
            being stuck, being shut out of technology, running a one-person business.
  offtopic— substantive, but nothing to do with any of that. Sport, net worth, motivation,
            fitness, a design portfolio piece, industry news. A polite reply here is filler.
  promo   — they are selling or promoting: a course, a book, a waitlist, a newsletter push, an ad,
            or a success story being used as marketing. NEVER reply under somebody selling.
  bait    — engagement bait, a poll, "reply with X", a thread that exists to be bookmarked.
  noise   — a joke, a quote, a personal aside, or a fragment with no point in it.

Be hard on "worth". A quiet day is fine; a filler reply is not.
Also say, for a "worth" post, whether an invitation to the show would be NATURAL here — true only
if this person, or the people reading, plausibly have a problem the show could build. Usually false.

Return JSON:
{"verdicts":[{"n":1,"verdict":"worth","why":"<10 words: what specifically he could add>","inviteFits":false}]}

${tweets.map((t, i) => `${i + 1}. @${t.author.username}: ${t.text.replace(/\n/g, ' ').slice(0, 300)}`).join('\n\n')}`;
}

async function triage(tweets) {
  if (!tweets.length) return [];
  const { verdicts = [] } = await gemini(triagePrompt(tweets));
  return verdicts
    .map((v) => ({ ...v, tweet: tweets[v.n - 1] }))
    .filter((v) => v.tweet && v.verdict === 'worth');
}

/* ---------------------------------------------------------------- the draft */

function draftPrompt(tweet, why, inviteFits) {
  const d = config().draft;
  return `Write ONE reply to the post below, as him.

WHO HE IS. He runs a live show where somebody turns up with a real problem out of their own work
and they build it together on that person's own computer, unedited, three to four hours. It is for
people who never learned to code — shop owners, freelancers, designers, teachers. He is not an
expert or a teacher; he is someone who has built the thing before and will do it with you.

THE POST
@${tweet.author.username}: ${tweet.text.replace(/\n/g, ' ').slice(0, 500)}

WHY IT IS WORTH ANSWERING: ${why}

RULES, all of them:
${d.rules.map((r) => `- ${r}`).join('\n')}
- Under ${d.maxChars} characters. Shorter is better. Two sentences is plenty.
${inviteFits
  ? '- An invitation fits here. ONE clause at the end, an offer and not a pitch: they bring the problem, you build it together on their machine, they keep it. Never a link, never the show\'s name as a slogan.'
  : '- NO invitation. Just answer. Mentioning the show here would read as an advert.'}

If you cannot say anything specific and true, return an empty string. That is a correct answer and
happens often — a filler reply costs more than no reply.

Return JSON: {"reply":"...","invited":${inviteFits ? 'true|false' : 'false'}}`;
}

/*
 * Everything a draft must survive before it is allowed near the dashboard.
 * Returned as reasons rather than a boolean, because a draft rejected for the
 * same reason every run is a prompt that needs changing, not a bad day.
 */
function problems(text) {
  const d = config().draft;
  const out = [];
  const t = String(text || '').trim();
  if (!t) return ['empty'];
  if (t.length > d.maxChars) out.push(`too long (${t.length})`);
  if (/https?:\/\/|www\./i.test(t)) out.push('contains a link');
  if (/#\w/.test(t)) out.push('contains a hashtag');
  if (/\b(free|guaranteed|safe)\b/i.test(t)) out.push('uses a word the brand rules forbid');
  if (/\b(great|love|amazing|so true|well said|spot on|this\.)\b/i.test(t)) out.push('compliments the poster');
  if (/^@/.test(t)) out.push('opens with a handle — X adds that itself');
  // A made-up anecdote under his name is the one mistake that cannot be walked
  // back, and the very first live draft produced one: it claimed he had hosted
  // and sold his own digital assets. The prompt forbids it; this is the backstop
  // under the prompt, the same shape as the blocked-tag list under topic-tags.
  if (/\b(i (built|made|ended up|used to|started|ran|had|spent|charged|quit)|when i (was|did|built)|my (client|clients|shop|studio|agency|business))\b/i.test(t)) {
    out.push('invents his history');
  }
  return out;
}

async function draft(tweet, { why = '', inviteFits = false } = {}) {
  const { reply = '', invited = false } = await gemini(draftPrompt(tweet, why, inviteFits));
  const bad = problems(reply);
  if (bad.length) return { text: null, problems: bad, raw: reply };

  // Seeded off the tweet id, so the same post always renders the same reply:
  // what he approves has to be byte for byte what gets posted.
  const text = config().draft.typos
    ? typos.humanise(reply.trim(), { seed: `reply:${tweet.id}` })
    : reply.trim();
  return { text, invited: !!invited, problems: [] };
}

module.exports = { config, CONFIG_PATH, CURSOR_PATH, queriesFor, search, sweep,
  cursorKey, cursors, saveCursors, sieve, triage, draft, problems, gemini };
