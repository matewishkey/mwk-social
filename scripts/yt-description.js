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
 *   scripts/yt-description.js --restore <videoId>     # put the backed-up one back
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { api } = require('./lib/api');
const { topicsFor } = require('./lib/topic-tags');
const voice = require('./lib/voice');

const ACCOUNT = process.env.MWK_YT_ACCOUNT || '6a7f2a4677555aae01be88d4';
const BACKUP = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
  'mwk-social', 'yt-descriptions');

// The constant half of every description, and the identity tags, both from
// config/voice.json so there is one place to change what we say.

const yt = (args) => execFileSync('yt-dlp', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const currentDescription = (id) => yt(['-q', '--no-warnings', '--print', '%(description)s', '--', `https://www.youtube.com/watch?v=${id}`]);
const currentTitle = (id) => yt(['-q', '--no-warnings', '--print', '%(title)s', '--', `https://www.youtube.com/watch?v=${id}`]);

function backup(id, description, title) {
  fs.mkdirSync(BACKUP, { recursive: true });
  const f = path.join(BACKUP, `${id}.txt`);
  if (!fs.existsSync(f)) fs.writeFileSync(f, description);
  fs.writeFileSync(path.join(BACKUP, `${id}.title`), title);
}

async function summarise(transcript, title) {
  const prompt = `Write the opening of a YouTube description for this video: 2-3 plain sentences saying what actually happens in it.

Voice rules, these matter more than anything:
- Write like telling a friend what the video is. No marketing, no hooks, no hype, no "dive in", no exclamation marks.
- Never open with "In this video", "In this short", "Join me" or any other throat-clearing. Start with the thing itself.
- Say plainly what happened and what was worked on or discussed.
- The host teaches rather than doing it for the guest — never claim the host built it for them.
- Do not invent names, companies or facts that are not in the transcript.
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

async function build(id) {
  const title = currentTitle(id);
  const topics = await topicsFor(`youtube:${id}`, { youtubeId: id });
  if (!topics) throw new Error('no transcript available (YouTube has not captioned it yet)');
  const opening = await summarise(topics.transcript, title);
  const tags = voice.tagLine('youtube', topics.tags);
  return { title, description: `${opening}\n\n${voice.showBlurb()}\n\n${tags}` };
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const emptyOnly = argv.includes('--empty-only');
  const restore = argv.includes('--restore');
  let ids = argv.filter((a) => !a.startsWith('--'));

  if (restore) {
    for (const id of ids) {
      const f = path.join(BACKUP, `${id}.txt`);
      const description = fs.readFileSync(f, 'utf8');
      await api('POST', '/posts/_/update-metadata', { body: { platform: 'youtube', videoId: id, accountId: ACCOUNT, description } });
      console.log(`restored ${id} from ${f}`);
    }
    return;
  }

  if (!ids.length) {
    const res = await api('GET', '/analytics/posts', { query: { platform: 'youtube', limit: 50 } });
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
      await api('POST', '/posts/_/update-metadata', { body: { platform: 'youtube', videoId: id, accountId: ACCOUNT, description } });
      console.log(`--- applied (previous description backed up)`);
    } catch (err) {
      console.error(`FAIL  ${id} — ${err.message}`);
    }
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
