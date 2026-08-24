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
const voice = require('./voice');

const CACHE = process.env.MWK_TOPIC_CACHE ||
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'mwk-social', 'topics');

const MAX_AUDIO_SECONDS = 900;

// Tag rules live in config/voice.json — one file for everything we say out loud.
// The blocklist is the backstop that stops the mainstream AI/creator/hype tags
// getting through whatever the model suggests.
const MAX_TAGS = voice.maxTopicTags();
const BLOCKED = voice.blockedTags();

/*
 * Bump this whenever the tag RULE changes, not when the code does. A cached
 * result carries the version it was named under, so a bump re-derives every
 * video from its stored transcript — one model call each, no re-transcription.
 *
 *   1  subject-matter tags, whatever vocabulary the model reached for
 *   2  2026-08-21: everyday words only, never developer or infrastructure
 *      vocabulary. #Xero yes, #Cloudflare no.
 */
const RULES_VERSION = 2;

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

// YouTube publishes auto-captions, so a video there needs no download and no
// transcription spend at all — and unlike the audio path it covers the whole
// video, which matters when a live show runs for four hours.
function transcribeYouTube(videoId) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mwk-subs-'));
  try {
    sh('yt-dlp', ['-q', '--no-warnings', '--skip-download', '--write-auto-subs',
      '--sub-langs', 'en.*', '--sub-format', 'vtt', '-o', path.join(tmp, 's'),
      '--', `https://www.youtube.com/watch?v=${videoId}`]);
    const vtt = fs.readdirSync(tmp).find((f) => f.endsWith('.vtt'));
    if (!vtt) return null;
    return cleanVtt(fs.readFileSync(path.join(tmp, vtt), 'utf8'));
  } catch {
    return null;               // no captions, private, or yt-dlp unhappy — fall back
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Auto-caption VTT is a rolling window: each cue repeats the previous line and
// carries per-word timing tags. Strip both, keep first sight of each line.
function cleanVtt(vtt) {
  const seen = new Set();
  const lines = [];
  for (let line of vtt.split('\n')) {
    if (!line.trim() || line.startsWith('WEBVTT') || line.includes('-->')) continue;
    if (/^(Kind|Language):/.test(line)) continue;
    line = line.replace(/<[^>]*>/g, '').trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim();
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
  return `Below is the transcript of a video. Name what it is about, as hashtags — in the words an
ORDINARY PERSON would use. Not a developer, not an IT person. Someone who runs a shop, does their
own books, or has an idea and no idea how to build it.

THE ONE TEST, apply it to every tag before you return it:
  "Would someone who does NOT work in technology already know this word, and use it themselves?"
If they would have to look it up, it is the wrong tag. No exceptions.

Name the everyday thing:
- the JOB someone is trying to get done — Invoicing, Bookkeeping, Scheduling, Budgeting
- the TOOL ordinary people already use by name — Xero, Excel, Shopify, WordPress, Canva, Gmail
- the PROBLEM they would recognise in themselves — LatePayments, DoubleBooking, Paperwork

Never name the technology used to solve it. Say what a normal person would say instead:
  Cloudflare, DNS, hosting        -> Website, DomainName
  WebDevelopment, frontend        -> Website
  Observability, monitoring       -> Downtime, Uptime
  ErrorReporting, debugging       -> Troubleshooting is still too technical: name what broke
  GenerativeEngineOptimization    -> GettingFound, Google
  WorkflowAutomation              -> the actual chore being automated, e.g. Invoicing
  APIs, webhooks, integrations    -> the two things being joined, if people know them by name

Also banned:
- Anything about AI, prompting, models, coding or software as a category. Those describe the
  method, not the subject, and every video here would carry them.
- Audience tags — nothing about mums, beginners, small business owners, entrepreneurs.
- Marketing words, hype, engagement bait, anything flashy.

Fewer good tags beat more weak ones. ${MAX_TAGS} maximum, and returning one or two is fine.
Return NOTHING rather than reach for a technical word.

CamelCase, no spaces, no punctuation, no leading #.

Return JSON only:
{"tags":["Xero","Invoicing"],"summary":"one plain sentence on what the video covers"}

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
async function topicsFor(key, source) {
  const { videoUrl, youtubeId } = source || {};
  const cached = readCache(key);
  // A cache hit is only a hit if it was produced under the CURRENT tag rule.
  // Without this the 2026-08-21 rework would have changed nothing for any video
  // already processed: every one of them would have kept its old tech tags for
  // ever, and the cache is the whole point of not re-transcribing.
  if (cached && cached.rules === RULES_VERSION) return cached;

  // The transcript does not go stale — only the naming does. Re-deriving from a
  // cached transcript costs one model call instead of a download and a Whisper run.
  let transcript = (cached && cached.transcript) || null;
  if (!transcript) {
    if (!videoUrl && !youtubeId) return null;
    // Captions first — free and complete. Whisper only when there are none.
    transcript = youtubeId ? transcribeYouTube(youtubeId) : null;
    if (!transcript) {
      if (!videoUrl || !process.env.OPENAI_API_KEY) return null;
      transcript = await transcribe(videoUrl);
    }
  }
  /*
   * PERSIST THE TRANSCRIPT BEFORE THE MODEL IS ASKED ANYTHING.
   *
   * It was only written as part of `result`, after callModel() returned — so a
   * Gemini timeout threw and a Whisper run that cost real money was discarded.
   * Worse than the money: the media urls Zernio hands out are signed and
   * expire, so by the next hourly run there may be nothing left to download and
   * the clip can never be transcribed at all. The file's own header says a post
   * must only ever be processed once; this is what makes that true.
   *
   * No `rules`, deliberately. A cache entry without one can never satisfy the
   * RULES_VERSION gate above, so this is a transcript saved for reuse and never
   * a set of tags served as current.
   */
  if (transcript && (!cached || cached.transcript !== transcript)) {
    writeCache(key, { transcript, at: new Date().toISOString() });
  }

  /*
   * No key: hand back the transcript entry, never a stale NAMING.
   *
   * This test used to sit above the RULES_VERSION gate, which meant a missing
   * GEMINI_API_KEY returned a pre-2026-08-21 result carrying the old tech tags
   * — the exact hole RULES_VERSION was added to close, reopened on the no-key
   * path. No key now means no tags, which is the documented behaviour anyway:
   * a plain CTA, never a failed comment.
   */
  if (!process.env.GEMINI_API_KEY) {
    return cached && cached.rules === RULES_VERSION ? cached : null;
  }
  // After the no-key return, not before it: "no keys means a plain CTA, never a
  // failed comment" is the rule, and throwing here with no key would break it.
  if (!transcript) throw new Error('transcript came back empty');
  const named = await callModel(transcript);
  const result = {
    tags: clean(named.tags),
    summary: String(named.summary || '').slice(0, 300),
    transcript,
    rules: RULES_VERSION,
    at: new Date().toISOString(),
  };
  writeCache(key, result);
  return result;
}

module.exports = { topicsFor, clean, cleanVtt, BLOCKED, MAX_TAGS, callModel, RULES_VERSION };
