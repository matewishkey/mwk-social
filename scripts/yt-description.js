#!/usr/bin/env node
/*
 * Write YouTube descriptions: what the video was about, what the show is, and
 * where to sign up — assembled from the video's own transcript.
 *
 * The existing description is saved to ~/.local/state/mwk-social/yt-descriptions/
 * before anything is written, so every change is reversible.
 *
 * Usage:
 *   scripts/yt-description.js <videoId>...            # print, change nothing
 *   scripts/yt-description.js --apply <videoId>...
 *   scripts/yt-description.js --empty-only --apply    # only videos with no description
 *   scripts/yt-description.js --repropose <id…>      # force a fresh opening, filed for approval
 *   scripts/yt-description.js --restore <videoId>     # put the backed-up one back
 *   scripts/yt-description.js --sync                  # the dashboard loop, below
 *
 * --sync is what the timer runs. Two paths, deliberately different:
 *
 *   a video with NO description gets one written straight away — there is
 *   nothing to overwrite, and the original is backed up either way;
 *
 *   a video that ALREADY has one only gets a PROPOSAL, filed to the dashboard,
 *   which does nothing until it is approved there. Overwriting words someone
 *   chose is not a thing to do quietly, however reversible it is.
 *
 * Both paths refuse to write while config/voice.json still marks the show blurb
 * PENDING: it goes at the bottom of every description, and shipping a paraphrase
 * of the show to the channel is exactly the mistake this is here to avoid.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
net.setDefaultAutoSelectFamilyAttemptTimeout(1000);

const { api, cli } = require('./lib/api');
const { topicsFor } = require('./lib/topic-tags');
const voice = require('./lib/voice');
const shortlink = require('./lib/shortlink');
const platforms = require('./lib/platforms');
const { youtubeProbe } = require('./lib/media');

/*
 * The YouTube account id, resolved from the connection list rather than baked in
 * here. Two reasons, and the second is why it changed on 2026-08-23: a literal
 * goes stale the day the account is reconnected, and THIS REPO IS PUBLIC — an
 * account id is exactly what CLAUDE.md says must not be committed to it. Same
 * rule the X account id already followed. MWK_YT_ACCOUNT still overrides.
 */
let accountId = null;
async function account() {
  if (accountId) return accountId;
  if (process.env.MWK_YT_ACCOUNT) { accountId = process.env.MWK_YT_ACCOUNT; return accountId; }
  const { accounts = [] } = await api('GET', '/accounts');
  const yt = accounts.find((a) => a.platform === 'youtube' && a.isActive !== false);
  if (!yt) throw new Error('no YouTube account is connected — check `zernio accounts:list`');
  accountId = yt._id || yt.id;
  return accountId;
}
const BACKUP = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
  'mwk-social', 'yt-descriptions');

// The constant half of every description, and the identity tags, both from
// config/voice.json so there is one place to change what we say.

const yt = (args) => execFileSync('yt-dlp', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const currentDescription = (id) => yt(['-q', '--no-warnings', '--print', '%(description)s', '--', `https://www.youtube.com/watch?v=${id}`]);
const currentTitle = (id) => yt(['-q', '--no-warnings', '--print', '%(title)s', '--', `https://www.youtube.com/watch?v=${id}`]);

/*
 * How long to wait for YouTube's auto-captions before writing a description
 * without them. Same name and same default as the first-comment watcher, which
 * had this and this file did not.
 *
 * The gap that made it necessary: build() needs a transcript for the opening
 * paragraph, so a video YouTube never captions threw on every single run — for
 * ever, once a day, with nobody told. Three videos were in that state on
 * 2026-08-25, two of them for four and six days: a 19-second Short and a
 * 35-minute stream, both carrying his own words and NO route to the sign-up
 * page, because the one thing standing between them and a show blurb was a
 * summary they did not need.
 *
 * Waiting first is still right — a long stream takes hours to caption, and a
 * description written from a transcript is better than one without. What was
 * missing is what happens when the wait does not end.
 */
const CAPTION_GRACE_HOURS = Number(process.env.MWK_CAPTION_GRACE_HOURS || 24);

/** How old this video is, in hours, or null if YouTube will not say. */
function ageHours(id) {
  try {
    const raw = yt(['-q', '--no-warnings', '--print', '%(timestamp)s',
      '--', `https://www.youtube.com/watch?v=${id}`]).split('\n')[0].trim();
    const ts = Number(raw);
    // yt-dlp prints the literal string "NA" when a field is absent, and
    // Number('NA') is NaN — which would compare false against the grace and
    // silently take the impatient branch on every video that lacks a timestamp.
    if (!Number.isFinite(ts) || ts <= 0) return null;
    return (Date.now() - ts * 1000) / 3600_000;
  } catch { return null; }
}

function backup(id, description, title) {
  fs.mkdirSync(BACKUP, { recursive: true });
  const f = path.join(BACKUP, `${id}.txt`);
  if (!fs.existsSync(f)) fs.writeFileSync(f, description);
  fs.writeFileSync(path.join(BACKUP, `${id}.title`), title);
}

async function summarise(transcript, title) {
  const prompt = `Write the opening of a YouTube description for this video: 2-3 plain sentences saying what actually happens in it.

Voice rules, these matter more than anything:
- FIRST PERSON, always. "I set up", "we looked at". NEVER "the host", "Host Mate", "Mate does" or any other third-person narration — this is me writing about my own show, not a press release about somebody else.
- Name the guest and say what THEY wanted: "Peter wanted a script that collects the odds". Never "a beginner", "his friend" or "the guest" as a label. No name in the transcript? Then say what they were working on and leave the person out.
- Write like telling a friend what the video is. No marketing, no hooks, no hype, no "dive in", no exclamation marks.
- Never open with "In this video", "In this short", "This walkthrough covers", "Join me" or any other throat-clearing. Start with the thing itself.
- Say plainly what happened. Concrete beats general: the actual tool, the actual bug, the actual thing that got fixed.
- I guide, I do not build it for them — never claim I built the guest's thing for them.
- Do not invent names, companies or facts that are not in the transcript.
- THE TRANSCRIPT WINS OVER THE TITLE. A stream title is often left over from another session, so if the title names someone the transcript never mentions, write what the transcript actually contains and do not use that name at all.
- No hashtags, no links, no sign-off. Those get added separately.

TITLE: ${title}

TRANSCRIPT:
${transcript.slice(0, 14000)}

Return JSON only: {"opening":"..."}`;

  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
    signal: AbortSignal.timeout(120000),
  });
  const json = await res.json();
  if (json.error) throw new Error(`gemini: ${json.error.message}`);
  return JSON.parse(json.candidates[0].content.parts[0].text).opening.trim();
}

/*
 * Is this video a Short, and therefore a place where a link cannot be followed?
 *
 * YouTube renders every url in a Short's description as plain text, deliberately,
 * to cut spam — its own help page says so, and the clickable route out of a
 * Short is the CHANNEL's links. This file minted a tracked code for every video
 * regardless, so on 2026-08-24 twelve of the twenty-four videos on the channel
 * carried a code nobody could ever click. `platforms.linkDeadFor()` is the rule
 * and it already governed the publish path; this is the one place it never
 * reached. No probe means no claim, exactly as it does everywhere else.
 */
const isShort = (id) => platforms.linkDeadFor('youtube', youtubeProbe(id));

/*
 * The tail of one video's description — the show blurb with its link slot
 * filled in for THIS video.
 *
 * On a normal video that is a per-video tracked code, which is the only way to
 * learn which episode is pulling: YouTube reports impressions and CTR in
 * Studio's UI and exposes neither through any API. On a Short it is the channel
 * phrasing instead and nothing is minted — a code spent where no click can
 * happen reads in the numbers as indifference rather than as unreachable, which
 * is the more expensive of the two mistakes.
 *
 * Idempotent by construction: the mint key is (target, platform, clipId,
 * campaign, medium), so a re-run returns the SAME code and the description stays
 * byte-identical. That matters more than it looks — the show-notes loop compares
 * against what was last written, and a link that changed every run would
 * re-propose every video for ever.
 */
async function tailFor(id, title = null) {
  /*
   * A Short gets a SHORT code — mwkshow.com/s3 — not the channel phrasing it
   * used to get (mate's call, 2026-08-25: "for shorts we can create some unique
   * super short links which is easy to type").
   *
   * The old behaviour was right about the mechanism and wrong about the cost.
   * YouTube does render a url in a Short's description as plain text, so it
   * cannot be CLICKED — but naming the channel instead left the video with no
   * address at all, while the blurb printed two other urls underneath it. He
   * found that on the dashboard and it was indefensible.
   *
   * So: still no click, but a person can read `mwkshow.com/s3` off their screen
   * and type it, which is the whole reason the short domain was bought. A low
   * number on one of these is not indifference and not unreachability — it is
   * how many people cared enough to type, which is a real thing to measure.
   */
  const link = await shortlink.mint({
    platform: 'youtube', medium: 'description', campaign: 'episode',
    clipId: id, label: title,
    codePrefix: isShort(id) ? 's' : null,
  });
  /*
   * A failed mint is FATAL here, and that is a deliberate departure from the
   * first-comment rule (mint, but never let it block the comment). A comment
   * gets one shot and is better untracked than missing. A description can be
   * written any day, so falling back to the plain url would buy nothing and
   * cost two rewrites of every video — one to the untracked url and one back.
   */
  if (!link) throw new Error('could not mint the episode link (dashboard unreachable) — retrying next run');
  return voice.showBlurb(link);
}

async function build(id) {
  const title = currentTitle(id);
  const topics = await topicsFor(`youtube:${id}`, { youtubeId: id });
  if (!topics) throw new Error('no transcript available (YouTube has not captioned it yet)');

  const tail = await tailFor(id, title);
  const opening = await summarise(topics.transcript, title);
  const tags = voice.tagLine('youtube', topics.tags);
  return { title, description: `${opening}\n\n${tail}\n\n${tags}` };
}

/** Has the show blurb been chosen, or is it still my paraphrase? */
const blurbChosen = () => !/PENDING/.test((voice.config().youtubeDescription || {})._showBlurb || '');

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

const setDescription = async (id, description) =>
  api('POST', '/posts/_/update-metadata',
    { body: { platform: 'youtube', videoId: id, accountId: await account(), description } });

async function sync({ dryRun = false, limit = 50 } = {}) {
  const call = dashboard();

  // Anything approved since last time goes out first — he has already decided,
  // and making him wait a cycle for a decision he made is just rude.
  const { items: approved, applied = [] } = await call('/youtube/pending', {});
  // Videos already carrying exactly what we wrote. Re-proposing those is churn,
  // not a change: build() regenerates the opening every run and it never matches.
  const alreadyWritten = new Map(applied.map((a) => [a.video_id, (a.proposed || '').trim()]));
  const written = [];
  for (const item of approved) {
    if (!blurbChosen()) { console.log(`hold  ${item.video_id} — approved, but the show blurb is still PENDING`); continue; }
    if (dryRun) { console.log(`DRY   ${item.video_id} — would write the approved description`); continue; }
    try {
      backup(item.video_id, currentDescription(item.video_id), item.title || '');
      await setDescription(item.video_id, item.proposed);
      alreadyWritten.set(item.video_id, (item.proposed || '').trim());
      written.push(item.video_id);
      console.log(`wrote ${item.video_id} — approved (previous backed up)`);
    } catch (err) {
      console.error(`FAIL  ${item.video_id} — ${err.message}`);
    }
  }
  if (written.length) await call('/youtube/applied', { videoIds: written });

  // Through the CLI, not lib/api: that path is not a REST route at all, and
  // Zernio answers an unknown path with its marketing SPA — so a wrong one
  // fails as "not JSON" rather than as a 404, which is how this went unseen.
  const res = cli(['analytics:posts', '--platform', 'youtube', '--limit', String(limit)]);
  const ids = (res.posts || []).flatMap((p) => (p.platforms || []).map((pf) => pf.platformPostId)).filter(Boolean);

  const proposals = [];
  let filled = 0;
  for (const id of ids) {
    try {
      const existing = currentDescription(id);

      if (existing.trim()) {
        /*
         * A description that is already there. Three cases, cheapest first —
         * and the ORDER is the fix, not the cases.
         *
         * This block used to open with `alreadyWritten.get(id) === existing`,
         * which skipped before build() was ever reached. That made the guard
         * mean "unchanged since we wrote it" when the question is "is it still
         * what we would write now" — so no change to the constant tail could
         * ever land on a video that already had one. The per-episode link added
         * on 2026-08-23 would have reached two videos out of twenty-three.
         * The same disease RULES_VERSION cures in topic-tags.js, in a second
         * place, and it was found by mate asking whether anything was missing.
         *
         * It also keyed off the wrong set: `applied` only holds videos that
         * went through the approval flow, and most of these were auto-filled
         * when their description was empty, so they were never in it at all.
         * The tail itself is the honest test — if the text carries it, we wrote
         * it, whichever route it took.
         */
        const tail = await tailFor(id);
        const ours = voice.findBlurb(existing);
        if (ours === tail) continue;                             // current, nothing to do

        if (ours) {
          /*
           * Ours, and only the boilerplate tail is out of date. Swap JUST that.
           * A full rebuild would regenerate the opening with a model and hand
           * him twenty-one rewritten summaries to re-approve — words he already
           * said yes to, changed for no reason he asked for. It is also free:
           * no transcript, no model call.
           *
           * findBlurb, not two literal comparisons. The old pair tested for the
           * current tail and the plain-url one and nothing else, so a
           * description holding any THIRD shape read as "not ours" and took the
           * rebuild path — which is what the twelve Shorts would have done the
           * moment their dead tracked code had to come out.
           */
          proposals.push({ videoId: id, title: currentTitle(id), currentText: existing,
            proposed: existing.replace(ours, tail), kind: 'swap' });
          continue;
        }

        // Not recognisably ours, or changed underneath us. Draft, file, touch nothing.
        if (alreadyWritten.get(id) === existing.trim()) continue;

        let built;
        try {
          built = await build(id);
        } catch (err) {
          /*
           * Only ONE failure is recoverable here, and it is named rather than
           * caught wholesale: a missing transcript. A model error, a failed
           * mint or a broken yt-dlp must still surface — swallowing those would
           * turn every real fault into a silently degraded description.
           */
          if (!/no transcript available/.test(err.message)) throw err;

          const hours = ageHours(id);
          if (hours == null || hours < CAPTION_GRACE_HOURS) {
            console.log(`defer ${id} — no captions yet${hours == null ? '' : ` (${Math.round(hours)}h old)`}, retrying`);
            continue;
          }
          /*
           * Past the grace, so stop waiting for a summary that is not coming and
           * give the video the one thing it is actually missing: a way to reach
           * the show. His own words are kept whole and the tail goes underneath
           * — no topic tags, because those come from the transcript too, and
           * "fewer good tags beat more weak ones" applies hardest when the
           * alternative is inventing them.
           *
           * A PROPOSAL, not a write. Adding to words someone chose is not a
           * thing to do quietly, however small the addition.
           */
          proposals.push({ videoId: id, title: currentTitle(id), currentText: existing,
            proposed: `${existing.trim()}\n\n${tail}`, kind: 'append' });
          console.log(`append ${id} — no captions after ${Math.round(hours)}h; proposing the show blurb alone`);
          continue;
        }

        if (built.description.trim() === existing.trim()) continue;
        proposals.push({ videoId: id, title: built.title, currentText: existing,
          proposed: built.description, kind: 'rebuild' });
        continue;
      }

      if (!blurbChosen()) { console.log(`hold  ${id} — empty, but the show blurb is still PENDING`); continue; }

      let empty;
      try {
        empty = await build(id);
      } catch (err) {
        // The same wait, for a video with nothing there at all. An empty
        // description is worse than a boilerplate one, so once the grace is up
        // the tail goes in on its own — and this path stays an auto-write
        // because there are still no words of his to touch.
        if (!/no transcript available/.test(err.message)) throw err;
        const hours = ageHours(id);
        if (hours == null || hours < CAPTION_GRACE_HOURS) {
          console.log(`defer ${id} — empty and not captioned yet${hours == null ? '' : ` (${Math.round(hours)}h old)`}`);
          continue;
        }
        empty = { title: currentTitle(id), description: await tailFor(id) };
        console.log(`note  ${id} — no captions after ${Math.round(hours)}h; filling with the show blurb alone`);
      }
      const { title, description } = empty;
      if (dryRun) { console.log(`DRY   ${id} — empty, would fill it in`); continue; }
      backup(id, existing, title);
      await setDescription(id, description);
      filled++;
      console.log(`wrote ${id} — was empty`);
    } catch (err) {
      console.error(`FAIL  ${id} — ${err.message}`);
    }
  }

  if (proposals.length && !dryRun) await call('/youtube/propose', { items: proposals });
  console.log(`${filled} filled, ${proposals.length} proposed, ${written.length} approved and written`);
}

/*
 * Force a fresh opening for videos that already carry one, and FILE it rather
 * than write it.
 *
 * sync() cannot do this, by design: once a description is recognisably ours it
 * takes the swap path, which replaces the stale tail and leaves the words he
 * approved alone. That is right for a tail change and wrong for a VOICE change
 * — the opening is the part that was wrong on 2026-08-25, and no amount of
 * running --sync could ever have reached it. Five of fourteen openings narrated
 * his own show in the third person ("The host walks his sister through…")
 * because the prompt's own rule said "the host", and one attributed his
 * projects to a guest who is not in the video at all.
 *
 * Same disease as RULES_VERSION in topic-tags.js and the `alreadyWritten` skip
 * this file already carries: a change to the RULES cannot reach what the old
 * rules produced. This is the manual lever rather than a stored version,
 * because a voice change is rare, deliberate, and something he should see the
 * whole of before it lands.
 *
 * It proposes. It never writes — these are words he already said yes to, and
 * replacing them is his call, on the dashboard, like everything else.
 */
async function repropose(ids) {
  const call = dashboard();
  const proposals = [];
  for (const id of ids) {
    try {
      const existing = currentDescription(id);
      const built = await build(id);
      if (built.description.trim() === existing.trim()) { console.log(`same  ${id} — nothing changed`); continue; }
      proposals.push({ videoId: id, title: built.title, currentText: existing,
        proposed: built.description, kind: 'rebuild' });
      console.log(`draft ${id} — ${built.title}`);
    } catch (err) {
      console.error(`FAIL  ${id} — ${err.message}`);
    }
  }
  if (proposals.length) await call('/youtube/propose', { items: proposals });
  console.log(`${proposals.length} re-proposed for approval`);
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const emptyOnly = argv.includes('--empty-only');
  const restore = argv.includes('--restore');
  if (argv.includes('--sync')) return sync({ dryRun: argv.includes('--dry-run') });
  let ids = argv.filter((a) => !a.startsWith('--'));
  if (argv.includes('--repropose')) {
    if (!ids.length) throw new Error('--repropose needs at least one video id');
    return repropose(ids);
  }

  if (restore) {
    for (const id of ids) {
      const f = path.join(BACKUP, `${id}.txt`);
      const description = fs.readFileSync(f, 'utf8');
      await api('POST', '/posts/_/update-metadata', { body: { platform: 'youtube', videoId: id, accountId: await account(), description } });
      console.log(`restored ${id} from ${f}`);
    }
    return;
  }

  if (!ids.length) {
    const res = cli(['analytics:posts', '--platform', 'youtube', '--limit', '50']);
    ids = (res.posts || []).flatMap((p) => (p.platforms || []).map((pf) => pf.platformPostId)).filter(Boolean);
  }

  for (const id of ids) {
    try {
      const existing = currentDescription(id);
      if (emptyOnly && existing.trim()) { console.log(`skip  ${id} — already has a description`); continue; }
      const { title, description } = await build(id);
      console.log(`\n=== ${id} — ${title}`);
      console.log(description);
      if (!apply) continue;
      backup(id, existing, title);
      await api('POST', '/posts/_/update-metadata', { body: { platform: 'youtube', videoId: id, accountId: await account(), description } });
      console.log(`--- applied (previous description backed up)`);
    } catch (err) {
      console.error(`FAIL  ${id} — ${err.message}`);
    }
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
