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
 * The ffprobe container names for a still picture. Each single-image demuxer is
 * its own format, so this is a list rather than a guess at the codec: a PNG is
 * `png_pipe`, a JPEG `jpeg_pipe` or `image2`, and a codec name alone would not
 * separate a still PNG from a video that happens to use one.
 */
const IMAGE_CONTAINERS = /(^|,)(image2|png_pipe|jpeg_pipe|mjpeg_pipe|webp_pipe|bmp_pipe|tiff_pipe)($|,)/;

/** What the file actually is — the only description of the media we can trust. */
function probe(file) {
  const raw = sh('ffprobe', ['-v', 'error', '-print_format', 'json',
    '-show_format', '-show_streams', '--', file], 60000);
  const json = JSON.parse(raw);
  const video = (json.streams || []).find((s) => s.codec_type === 'video');
  if (!video) throw new Error(`${path.basename(file)} has no video stream`);
  /*
   * A still picture presents as a video stream with one frame, so every field
   * below reads plausibly and every VIDEO rule then fails it: no audio track,
   * codec png rather than h264, nought seconds against a three-second minimum.
   * That is exactly what happened to the first image ever queued here — all six
   * platforms were dropped and the run failed with "no account can take this
   * post", which reads like a connection problem and is not one.
   *
   * ffprobe names the container, and for a still it is one of the *_pipe demuxers.
   */
  const isImage = IMAGE_CONTAINERS.test(String(json.format.format_name || ''));
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
    isImage,
  };
}

/*
 * The shape of a YouTube video WITHOUT downloading it.
 *
 * probe() needs the file; this needs only the metadata, which is what the
 * question "is this a Short" actually turns on — and it is asked about videos
 * we may have no local copy of at all, including everything uploaded straight
 * to the channel. Returns the same two fields linkDeadFor() reads, so the two
 * probes are interchangeable at the point of decision.
 *
 * Memoised per process: yt-description asks for every video in the sweep and a
 * second network round trip per id buys nothing. Null on any failure — a probe
 * we could not take must never be read as "not a Short", so callers treat null
 * the way linkDeadFor does: no probe, no claim.
 */
const ytProbeCache = new Map();
function youtubeProbe(videoId) {
  if (ytProbeCache.has(videoId)) return ytProbeCache.get(videoId);
  let out = null;
  try {
    const raw = sh('yt-dlp', ['-q', '--no-warnings', '--print', '%(width)s %(height)s %(duration)s',
      '--', `https://www.youtube.com/watch?v=${videoId}`], 60000).trim().split('\n')[0];
    const [width, height, durationSec] = raw.split(/\s+/).map(Number);
    if (width > 0 && height > 0 && Number.isFinite(durationSec)) {
      out = { width, height, durationSec, aspect: Number((width / height).toFixed(4)) };
    }
  } catch { out = null; }
  ytProbeCache.set(videoId, out);
  return out;
}

/*
 * resolve() lived here and is gone (2026-08-24). It fetched a clip and cached
 * it, and NOTHING had called it since the mirror was retired — run-queue.js has
 * its own fetchMedia(), reading the same MWK_MEDIA_CACHE, and that is what the
 * queue actually uses. Two downloaders for one job is how the two drift; the
 * dead one is the one to remove. downloadYouTube() went with it, as its only
 * caller. Verified with a positive control before deleting: the same grep that
 * found no call site finds mediaLib.check() at run-queue.js:209.
 *
 * The lessons they held are not lost — the yt-dlp traps (it appends its own
 * extension to -o, and it serves AV1 unless the video codec is constrained) and
 * the reason a download shells out to curl rather than fetch (no IPv6 route on
 * this box, so undici's 250 ms Happy Eyeballs window expires and it reads as an
 * expired URL) are in CLAUDE.md and restated on fetchMedia() itself.
 */

/**
 * Would this file be accepted where we're about to send it?
 * @returns {string[]} empty when it is fine; every problem found when it is not.
 */
function check(platform, p) {
  const cfg = platforms.get(platform);
  const problems = [];

  /*
   * A still picture is a different set of rules, not a lenient version of the
   * video ones. Duration, audio and H.264 mean nothing here; what matters is
   * whether the platform takes a still at all, and the aspect range for IMAGES,
   * which is not the video range — Instagram's video range tops out at square
   * while its images go to 1.91:1.
   */
  if (p.isImage) {
    if (!cfg.imageOk) problems.push(`${platform} has no way to post a still picture`);
    if (cfg.imageAspectRange) {
      const [lo, hi] = cfg.imageAspectRange;
      // EXCLUSIVE at the top on purpose. An image at exactly 1.91:1 is rejected
      // by Instagram — a float edge, bitten live — so the fix is to pad to about
      // 1.78 rather than to widen the tolerance here.
      if (p.aspect < lo - 1e-9 || p.aspect >= hi) {
        problems.push(`aspect ${p.aspect} is outside ${platform}'s images ${lo}–${hi}`);
      }
    }
    return problems;
  }

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

module.exports = { probe, youtubeProbe, check, downloadDirect, CACHE };
