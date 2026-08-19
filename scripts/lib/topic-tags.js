/*
 * Work out what a video was actually about, and turn that into hashtags.
 *
 *   download the video -> strip the audio -> transcribe it -> name the subjects
 *
 * Subject matter only. If the video is about trading it says #Trading; if it is
 * about spreadsheets it says #Spreadsheets. No audience tags, no marketing, no
 * hype — the tags are there so a human can see at a glance what was discussed.
 *
 * Everything is cached per post: transcription costs money and the video URL
 * expires, so a post is only ever processed once.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE = process.env.MWK_TOPIC_CACHE ||
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'mwk-social', 'topics');

const MAX_TAGS = 4;          // + the identity tag = Instagram's cap of 5
const MAX_AUDIO_SECONDS = 900;

// Never let these through, whatever the model says: the mainstream AI/creator
// tags are the exact crowd we're trying to step around, and the hype tags say
// nothing about the content.
const BLOCKED = new Set([
  'ai', 'artificialintelligence', 'chatgpt', 'openai', 'genai', 'aitools', 'machinelearning',
  'tech', 'technology', 'coding', 'programming',
  'fyp', 'foryou', 'foryoupage', 'viral', 'trending', 'explore', 'explorepage',
  'instagood', 'reels', 'reel', 'reelsinstagram', 'shorts', 'tiktok', 'instagram',
  'motivation', 'inspiration', 'success', 'mindset', 'hustle', 'grind', 'entrepreneur',
  'contentcreator', 'creator', 'follow', 'like', 'share', 'subscribe',
]);

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });

function cachePath(key) {
  return path.join(CACHE, key.replace(/[^\w.-]/g, '_') + '.json');
}

function readCache(key) {
  try { return JSON.parse(fs.readFileSync(cachePath(key), 'utf8')); } catch { return null; }
}

function writeCache(key, value) {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(cachePath(key), JSON.stringify(value, null, 2) + '\n');
}

// The two API calls go through node's own fetch, never curl: a secret passed as
// a curl argument is visible in `ps` to every user on the box. Only the video
// download — which carries no credential — still shells out.
async function transcribe(videoUrl) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mwk-reel-'));
  const mp4 = path.join(tmp, 'v.mp4');
  const wav = path.join(tmp, 'a.wav');
  try {
    // The URL comes from Zernio's response, so it is not ours to trust: `--`
    // stops one that begins with a dash being read as a curl flag, and the
    // scheme check stops file:// or scp:// being handed to curl at all.
    if (!/^https:\/\//i.test(videoUrl)) throw new Error(`refusing non-https media url: ${videoUrl.slice(0, 40)}`);
    sh('curl', ['-sL', '--max-time', '180', '-A', 'Mozilla/5.0', '-o', mp4, '--', videoUrl]);
    if (!fs.existsSync(mp4) || fs.statSync(mp4).size < 1024) throw new Error('video download was empty (signed URL probably expired)');
    sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', mp4, '-vn', '-ac', '1', '-ar', '16000',
      '-t', String(MAX_AUDIO_SECONDS), '-y', wav]);
    const form = new FormData();
    form.append('file', await fs.openAsBlob(wav), 'audio.wav');
    form.append('model', 'whisper-1');
    form.append('response_format', 'json');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(300000),
    });
    const json = await res.json();
    if (json.error) throw new Error(`whisper: ${json.error.message}`);
    return (json.text || '').trim();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function callModel(transcript) {
  // Key goes in the documented header, not the query string — a URL with a
  // credential in it leaks into argv, logs and proxies alike.
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: nameSubjectsPrompt(transcript) }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(120000),
  });
  const json = await res.json();
  if (json.error) throw new Error(`gemini: ${json.error.message}`);
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  return JSON.parse(text);
}

function nameSubjectsPrompt(transcript) {
  return `Below is the transcript of a short video. Name what it is ABOUT, as hashtags.

Rules:
- Subject matter only. If it is about trading say Trading; about SEO say SEO; about spreadsheets say Spreadsheets; about debugging say Debugging.
- ${MAX_TAGS} tags maximum, fewer if the video only covers one or two things.
- No audience tags (nothing about mums, beginners, small business owners).
- No marketing, hype or engagement-bait words. Nothing flashy.
- No generic AI or tech tags — those say nothing about this particular video.
- The point is that a person reading the tags can tell what was discussed.
- CamelCase, no spaces, no punctuation, no leading #.

Return JSON only: {"tags":["Trading","RiskManagement"],"summary":"one plain sentence on what the video covers"}

TRANSCRIPT:
${transcript.slice(0, 12000)}`;
}

function clean(tags) {
  const out = [];
  for (const raw of tags || []) {
    const tag = String(raw).replace(/^#/, '').replace(/[^A-Za-z0-9]/g, '');
    if (!tag || tag.length < 2 || tag.length > 30) continue;
    if (BLOCKED.has(tag.toLowerCase())) continue;
    if (out.some((t) => t.toLowerCase() === tag.toLowerCase())) continue;
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/**
 * @returns {{tags: string[], summary: string, transcript: string}|null}
 *   null when the post has no video, the keys are missing, or anything fails —
 *   the caller then posts the plain CTA rather than nothing at all.
 */
async function topicsFor(key, videoUrl) {
  const cached = readCache(key);
  if (cached) return cached;
  if (!videoUrl) return null;
  if (!process.env.OPENAI_API_KEY || !process.env.GEMINI_API_KEY) return null;

  const transcript = await transcribe(videoUrl);
  if (!transcript) throw new Error('transcript came back empty');
  const named = await callModel(transcript);
  const result = {
    tags: clean(named.tags),
    summary: String(named.summary || '').slice(0, 300),
    transcript,
    at: new Date().toISOString(),
  };
  writeCache(key, result);
  return result;
}

module.exports = { topicsFor, clean, BLOCKED, MAX_TAGS };
