/*
 * Getting the actual video file for a clip, and knowing what it is.
 *
 * The media URLs Zernio hands back are signed and die — measured at "URL
 * signature expired" on a two-week-old Facebook reel — so "Zernio gave me a
 * URL" is never "I have the video". Every clip we care about is also on
 * YouTube, where yt-dlp fetches it for free and forever, so that is the
 * fallback.
 *
 * Files are cached under ~/.local/state/mwk-social/media/ and keyed by clip: a
 * clip goes to four platforms and must be downloaded once, not four times.
 *
 * IPv4 ONLY, DELIBERATELY. This box has no IPv6 route, and node's fetch gives
 * up on a Meta CDN host at exactly 253 ms with ETIMEDOUT — the AAAA record wins
 * the lookup and undici's 250 ms Happy Eyeballs window expires before it falls
 * back to IPv4. That failure is indistinguishable from an expired signed URL,
 * which is a very expensive thing to misdiagnose. curl gets it right, so the
 * downloads shell out. If you ever need fetch here instead, the fix is
 * net.setDefaultAutoSelectFamilyAttemptTimeout(500) — verified, not guessed.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const platforms = require('./platforms');

const CACHE = process.env.MWK_MEDIA_CACHE ||
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'mwk-social', 'media');

const MIN_BYTES = 64 * 1024;          // anything smaller is an error page, not a video
const DOWNLOAD_TIMEOUT_SEC = 300;

const sh = (cmd, args, timeoutMs = 360000) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26, timeout: timeoutMs });

const safe = (s) => String(s).replace(/[^\w.-]/g, '_');
const cachePath = (clipId) => path.join(CACHE, `${safe(clipId)}.mp4`);

/**
 * Pull the file down from the signed URL Zernio handed us.
 * @returns {boolean} false when the URL has expired; throws on anything else.
 */
function downloadDirect(url, dest) {
  // The URL is Zernio's, not ours: `--` stops one beginning with a dash being
  // read as a curl flag, and the scheme check keeps file:// away from curl.
  if (!/^https:\/\//i.test(url)) throw new Error(`refusing non-https media url: ${String(url).slice(0, 40)}`);
  const tmp = `${dest}.part`;
  let code;
  try {
    code = sh('curl', ['-sSL', '--max-time', String(DOWNLOAD_TIMEOUT_SEC), '-A', 'Mozilla/5.0',
      '-o', tmp, '-w', '%{http_code}', '--', url]).trim();
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`download failed: ${(err.stderr || err.message).toString().trim().slice(0, 120)}`);
  }
  const size = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
  if (code === '403' || code === '404' || size < MIN_BYTES) {
    fs.rmSync(tmp, { force: true });
    return false;                                    // expired — the caller falls back
  }
  if (!/^2/.test(code)) { fs.rmSync(tmp, { force: true }); throw new Error(`download returned HTTP ${code}`); }
  fs.renameSync(tmp, dest);
  return true;
}

/*
 * The fallback. Free, and it never expires.
 *
 * It downloads into a scratch directory and moves whatever lands there, because
 * yt-dlp appends its own extension to -o: asking for "x" and getting "x.mp4"
 * looked exactly like "produced nothing usable".
 */
function downloadYouTube(videoId, dest) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mwk-yt-'));
  try {
    sh('yt-dlp', ['-q', '--no-warnings', '--no-playlist', '--force-ipv4',
      // H.264 first: YouTube serves AV1 for these clips by default and both
      // Instagram and TikTok want avc1 for a reel. Falling back through the
      // plain mp4 selectors keeps a video we can still post if avc1 is absent.
      '-f', 'bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1]/bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
      '--merge-output-format', 'mp4', '-o', path.join(tmp, 'v.%(ext)s'),
      '--', `https://www.youtube.com/watch?v=${videoId}`]);
    const got = fs.readdirSync(tmp).map((f) => path.join(tmp, f))
      .filter((f) => fs.statSync(f).size >= MIN_BYTES)
      .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
    if (!got) throw new Error('produced nothing usable');
    fs.copyFileSync(got, dest);                  // copy, not rename: /tmp is its own filesystem
  } catch (err) {
    throw new Error(`yt-dlp ${videoId}: ${(err.stderr || err.message).toString().trim().slice(0, 160)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** What the file actually is — the only description of the video we can trust. */
function probe(file) {
  const raw = sh('ffprobe', ['-v', 'error', '-print_format', 'json',
    '-show_format', '-show_streams', '--', file], 60000);
  const json = JSON.parse(raw);
  const video = (json.streams || []).find((s) => s.codec_type === 'video');
  if (!video) throw new Error(`${path.basename(file)} has no video stream`);
  const audio = (json.streams || []).find((s) => s.codec_type === 'audio');
  const width = Number(video.width);
  const height = Number(video.height);
  const durationSec = Number(json.format.duration || video.duration || 0);
  return {
    durationSec: Number(durationSec.toFixed(2)),
    width,
    height,
    aspect: Number((width / height).toFixed(4)),
    bytes: Number(json.format.size || fs.statSync(file).size),
    codec: video.codec_name,
    hasAudio: !!audio,
    audioCodec: audio ? audio.codec_name : null,
  };
}

/**
 * Fetch the clip once and keep it.
 *
 * @param {string} clipId    cache key, e.g. "facebook:1218…"
 * @param {object} src       {url, youtubeId}
 * @returns {{path, via: 'cache'|'facebook'|'youtube', probe: object}}
 */
function resolve(clipId, { url = null, youtubeId = null } = {}) {
  const dest = cachePath(clipId);
  if (fs.existsSync(dest) && fs.statSync(dest).size >= MIN_BYTES) {
    return { path: dest, via: 'cache', probe: probe(dest) };
  }
  fs.mkdirSync(CACHE, { recursive: true });

  if (url && downloadDirect(url, dest)) {
    return { path: dest, via: 'facebook', probe: probe(dest) };
  }
  if (!youtubeId) {
    throw new Error(url
      ? 'the signed url has expired and there is no YouTube copy to fall back to'
      : 'no media url and no YouTube copy');
  }
  downloadYouTube(youtubeId, dest);
  return { path: dest, via: 'youtube', probe: probe(dest) };
}

/**
 * Would this file be accepted where we're about to send it?
 * @returns {string[]} empty when it is fine; every problem found when it is not.
 */
function check(platform, p) {
  const cfg = platforms.get(platform);
  const problems = [];
  if (cfg.videoMinSec && p.durationSec < cfg.videoMinSec) {
    problems.push(`${p.durationSec}s is under ${platform}'s ${cfg.videoMinSec}s minimum`);
  }
  if (cfg.videoMaxSec && p.durationSec > cfg.videoMaxSec) {
    problems.push(`${p.durationSec}s is over ${platform}'s ${cfg.videoMaxSec}s maximum`);
  }
  if (cfg.aspectRange) {
    // Inclusive, with a float tolerance. This is the VIDEO range — 9:16 up to
    // square. Instagram's "exactly 1.91:1 is rejected" edge is an IMAGE rule and
    // does not belong here; conflating the two rejects a legitimate square reel.
    const [lo, hi] = cfg.aspectRange;
    if (p.aspect < lo - 1e-9 || p.aspect > hi + 1e-9) {
      problems.push(`aspect ${p.aspect} is outside ${platform}'s ${lo}–${hi}`);
    }
  }
  if (!p.hasAudio) problems.push('no audio track');
  // Not a hard limit in any published spec, but every reel that has gone out
  // cleanly was H.264, and Meta re-encodes or rejects the rest.
  if (p.codec && !/^(h264|avc)/.test(p.codec)) problems.push(`codec ${p.codec}, not h264`);

  // AUDIO codec, and it is X alone that cares (2026-08-21). An Opus track in an
  // MP4 container is legal, and Facebook, LinkedIn, YouTube, TikTok and Threads
  // all published one happily. X uploaded the whole file and then died at 99%
  // with "media processing failed" — so this is the expensive kind of no: the
  // bytes are paid for before it says it. Every clip X has ever accepted was
  // AAC; the one it refused was Opus, which is the whole difference.
  //
  // It gets in through yt-dlp: constraining the VIDEO codec and leaving `+ba`
  // free picks YouTube's best audio, which is Opus. Same shape as the AV1 trap,
  // one stream down. downloadYouTube() asks for m4a; anything uploaded by hand
  // is where this can still arrive.
  if (cfg.audioCodecs && p.audioCodec && !cfg.audioCodecs.includes(p.audioCodec)) {
    problems.push(`audio is ${p.audioCodec}, and ${platform} only takes ${cfg.audioCodecs.join('/')}`);
  }
  return problems;
}

module.exports = { resolve, probe, check, cachePath, downloadDirect, downloadYouTube, CACHE };
