#!/usr/bin/env node
/*
 * X replies: find, draft, send what he approved, and later see how it did.
 *
 * One script with three phases, in the order that respects his time — anything
 * he has already approved goes out FIRST, because making him wait a cycle for a
 * decision he already made is rude. Same shape as yt-description.js.
 *
 *   1. send      what he approved on the dashboard, as a real reply on X
 *   2. find      new posts worth answering, drafted and filed for approval
 *   3. outcomes  how the sent ones did, days later
 *
 * Nothing here posts anything he has not released. That is the whole design:
 * a reply goes out under his name, to a real person, in his voice.
 *
 * Usage:
 *   scripts/replies.js --sync                run all three phases
 *   scripts/replies.js --find --dry-run      look, draft, print, file nothing
 *   scripts/replies.js --send                only send what is approved
 *   scripts/replies.js --outcomes            only the outcome sweep
 *   scripts/replies.js --limit N             cap the drafts filed this run
 *
 * Every run needs ~/.secrets and the project env, so it goes through
 * scripts/with-secrets.sh — systemd's EnvironmentFile can read neither.
 */
'use strict';

const replies = require('./lib/replies');
const events = require('./lib/events');
const { api } = require('./lib/api');

/*
 * The X account id, read from the connection list rather than kept in config.
 * accounts:list is the source of truth for account ids (it says so in
 * CLAUDE.md), and a second copy in an env file is one more thing that can go
 * stale the day an account is reconnected. Costs one Zernio call, not an X one.
 */
let accountId = null;
async function account() {
  if (accountId) return accountId;
  if (process.env.MWK_X_ACCOUNT_ID) { accountId = process.env.MWK_X_ACCOUNT_ID; return accountId; }
  const { accounts = [] } = await api('GET', '/accounts');
  const x = accounts.find((a) => a.platform === 'twitter');
  if (!x) throw new Error('no X account is connected — check `zernio accounts:list`');
  accountId = x._id || x.id;
  return accountId;
}

function dashboard() {
  const base = process.env.MWK_LOG_URL;
  const token = process.env.MWK_LOG_TOKEN;
  if (!base || !token) throw new Error('MWK_LOG_URL and MWK_LOG_TOKEN must be set (td-sops apps/mwk-social.enc.env)');
  const origin = new URL(base).origin;
  return async (path_, body) => {
    const res = await fetch(`${origin}${path_}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${path_} → ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  };
}

/* ------------------------------------------------------------------- send -- */

/*
 * Post one approved reply. `platformSpecificData.replyToTweetId` publishes it
 * into that tweet's thread — it is not a comment API call, it is an ordinary
 * post that happens to be a reply, which is why it works on a plan whose
 * comment endpoints we only just switched on.
 */
async function sendOne(item) {
  const body = {
    content: item.text,
    publishNow: true,
    platforms: [{
      platform: 'twitter',
      accountId: await account(),
      platformSpecificData: { replyToTweetId: String(item.tweet_id) },
    }],
  };
  const { post } = await api('POST', '/posts', { body, timeout: 120000 });

  // Give Zernio a moment to hand back the platform result; a reply is text-only
  // so this settles in seconds rather than the minutes a video upload takes.
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const { post: p } = await api('GET', `/posts/${post._id}`);
    const t = (p.platforms || []).find((x) => x.platform === 'twitter');
    if (!t) continue;
    if (t.status === 'published') {
      return { sentId: t.platformPostId || null, sentUrl: t.platformPostUrl || null };
    }
    if (t.status === 'failed') throw new Error(t.errorMessage || 'X refused it');
  }
  // Not a failure: Zernio keeps going after we give up, so this is UNKNOWN.
  // Recording it as sent with no url beats recording a failure that went out.
  return { sentId: null, sentUrl: null };
}

async function send(call, { dryRun }) {
  const { items = [] } = await call('/replies/pending', {});
  if (!items.length) { console.log('nothing approved'); return 0; }

  const sent = [];
  for (const item of items) {
    if (dryRun) { console.log(`would send under @${item.author}: ${item.text}`); continue; }
    try {
      const r = await sendOne(item);
      sent.push({ tweetId: item.tweet_id, ...r });
      console.log(`sent  @${item.author} — ${r.sentUrl || '(no url yet)'}`);
      events.emit('reply.sent', { message: `replied to @${item.author}`, platform: 'twitter',
        url: r.sentUrl || null, postKey: `reply:${item.tweet_id}` });
    } catch (err) {
      sent.push({ tweetId: item.tweet_id, error: err.message.slice(0, 200) });
      console.error(`FAIL  @${item.author} — ${err.message}`);
      events.emit('reply.failed', { message: err.message, level: 'error', platform: 'twitter',
        postKey: `reply:${item.tweet_id}`, dedupeKey: `reply.failed|${item.tweet_id}` });
    }
  }
  if (sent.length) await call('/replies/sent', { sent });
  return sent.filter((s) => !s.error).length;
}

/* ------------------------------------------------------------------- find -- */

async function find(call, { dryRun, limit }) {
  const cfg = replies.config();
  const { recentAuthors = [], known = [], sentToday = 0 } = await call('/replies/pending', {});

  const room = Math.max(0, cfg.pick.perDay - sentToday);
  if (!room) { console.log(`${sentToday} already sent today — at the cap`); return 0; }

  const { tweets, commit } = await replies.sweep(await account(), replies.queriesFor(cfg.watch));
  const { kept, dropped } = replies.sieve(tweets, {
    known: new Set(known.map(String)),
    recentAuthors: new Set(recentAuthors),
  });
  console.log(`${tweets.length} posts, ${kept.length} past the sieve` +
    (Object.keys(dropped).length ? ` (${Object.entries(dropped).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''));
  if (!kept.length) return 0;

  const worth = await replies.triage(kept.slice(0, 60));
  console.log(`${worth.length} worth answering`);

  const cap = Math.min(limit ?? cfg.pick.perRun, room, worth.length);
  const items = [];
  for (const w of worth.slice(0, cap)) {
    const d = await replies.draft(w.tweet, { why: w.why, inviteFits: w.inviteFits });
    if (!d.text) { console.log(`  skip @${w.tweet.author.username} — ${d.problems.join(', ')}`); continue; }
    items.push({
      tweetId: w.tweet.id, author: w.tweet.author.username, authorName: w.tweet.author.displayName,
      tweetText: w.tweet.text, tweetAt: w.tweet.created, replyCount: w.tweet.replyCount,
      draft: d.text, invite: d.invited, why: w.why,
    });
    console.log(`  @${w.tweet.author.username}${d.invited ? ' (invite)' : ''}: ${d.text}`);
  }

  if (dryRun) { console.log(`would file ${items.length}`); return items.length; }
  // Only now: a cursor advanced before the drafts are filed would drop every
  // post this run looked at, permanently, if the filing failed.
  commit();
  if (!items.length) return 0;
  await call('/replies/propose', { items });
  events.emit('reply.proposed', { message: `${items.length} reply draft(s) waiting`, platform: 'twitter' });
  return items.length;
}

/* --------------------------------------------------------------- outcomes -- */

/*
 * Did anybody answer? This is the entire point of running the thing for a
 * month. A reply the author replies BACK to is worth roughly 150x a like on X,
 * and it is the only evidence that any of this reached a person rather than a
 * timeline.
 */
async function outcomes(call, { dryRun }) {
  const { sentAwaiting = [] } = await call('/replies/pending', {});
  if (!sentAwaiting.length) { console.log('no sent replies due an outcome check'); return 0; }
  const out = [];
  for (const s of sentAwaiting) {
    try {
      const { tweets: r } = await replies.search(await account(), `conversation_id:${s.tweet_id}`);
      const ours = r.find((t) => String(t.id) === String(s.sent_id));
      const authorReplied = r.some((t) => t.author.username.toLowerCase() === s.author.toLowerCase()
        && String(t.inReplyToTweetId) === String(s.sent_id));
      out.push({ tweetId: s.tweet_id, likes: ours ? ours.likeCount : 0,
        replies: ours ? ours.replyCount : 0, authorReplied });
      console.log(`@${s.author}: ${ours ? ours.likeCount : 0} likes` + (authorReplied ? ' — THEY REPLIED' : ''));
    } catch (err) { console.error(`outcome failed for ${s.tweet_id}: ${err.message.slice(0, 90)}`); }
  }
  if (out.length && !dryRun) await call('/replies/sent', { outcomes: out });
  return out.length;
}

/* ------------------------------------------------------------------- main -- */

function parseArgs(argv) {
  const o = { dryRun: false, limit: null, phases: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--sync') o.phases = ['send', 'find', 'outcomes'];
    else if (['--send', '--find', '--outcomes'].includes(a)) o.phases.push(a.slice(2));
    else if (a === '--help' || a === '-h') {
      console.log(require('fs').readFileSync(__filename, 'utf8')
        .split('\n').slice(1, 26).map((l) => l.replace(/^ ?\*\/?/, '')).join('\n'));
      process.exit(0);
    } else { console.error(`unknown option: ${a}`); process.exit(2); }
  }
  if (!o.phases.length) o.phases = ['send', 'find', 'outcomes'];
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const call = dashboard();

  let failures = 0;
  for (const phase of opts.phases) {
    try {
      if (phase === 'send') await send(call, opts);
      if (phase === 'find') await find(call, opts);
      if (phase === 'outcomes') await outcomes(call, opts);
    } catch (err) {
      failures++;
      console.error(`${phase}: ${err.message}`);
      events.emit('reply.error', { message: `${phase}: ${err.message}`, level: 'error',
        platform: 'twitter', dedupeKey: `reply.error|${phase}|${err.message.slice(0, 60)}` });
    }
  }
  process.exit(failures ? 1 : 0);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { sendOne, parseArgs };
