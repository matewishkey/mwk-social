#!/usr/bin/env node
/*
 * Put something in the queue from the box.
 *
 * "Post it" means QUEUE it (mate's call, 2026-08-21) — he reviews on the
 * dashboard and the pace releases it. The dashboard's own form is his way in;
 * this is ours, and it exists because there is no ingest endpoint for adding.
 * The Worker only ever CLAIMS from the queue, so writing a row means talking to
 * D1 directly through wrangler, the same tool web/deploy.sh already needs.
 *
 * Hand-writing that SQL is what this replaces. Three things went wrong the one
 * time it was done by hand: the id was a ULID-shaped string rather than a ULID,
 * an apostrophe in his words needed doubling, and every column had to be
 * remembered — the same list that had already been got wrong once inside the
 * Worker (see the insert in web/src/pages/queue.js).
 *
 * Usage:
 *   scripts/queue-add.js --body-file words.txt --media clip.mp4 \
 *     --platforms facebook,linkedin --topics ComputerProblems,CopyPaste
 *   scripts/queue-add.js --body "..." --dry-run      # print the SQL, write nothing
 *
 *   --body TEXT | --body-file PATH   his words. One or the other, never both.
 *   --media PATH[,PATH...]|URL       a local file goes to R2; a URL is stored as-is.
 *                                    Several comma-separated paths make a GALLERY:
 *                                    stills only, one post, capped per platform
 *                                    (LinkedIn 20, FB/IG/Threads 10, X 4)
 *   --media-key KEY                  reuse a clip ALREADY in R2 (the media_key of an
 *                                    earlier item) instead of uploading it again —
 *                                    the same clip to a platform it has not run on
 *   --media-wide PATH|URL            the landscape cut, for the platforms that take one
 *   --priority N                     default 0; higher jumps the line, NEGATIVE waits
 *                                    behind everything at 0 — a backfill must never
 *                                    hold up a post he just wrote
 *   --platforms a,b,c                default: empty, meaning "wherever it fits"
 *   --topics a,b,c                   topic tags, no # needed. GIVE THEM: omitting
 *                                    them means NO topic tags, on every platform
 *                                    that carries a native first comment. The
 *                                    watcher derives them from the transcript,
 *                                    and it only ever reaches a post that has no
 *                                    comment yet — a pipeline post already has
 *                                    one, so it is skipped. Threads is the lone
 *                                    exception (no native comment there), which
 *                                    is what makes the gap look like it is not
 *                                    one. Bit us on 2026-09-13: a reshare went
 *                                    out to five platforms with the brand tags
 *                                    and nothing describing the clip, and none
 *                                    of those platforms can be edited after.
 *   --comment TEXT                   a custom first comment instead of the rotation
 *   --link URL                       WHERE THIS POST POINTS. Default: the show.
 *                                    Give it when the post is ABOUT something
 *                                    with a page of its own — a project, an
 *                                    episode, a tool — and that page becomes
 *                                    the pin's destination, X's caption link
 *                                    and the link in the first comment. It
 *                                    goes out as the FULL url and is never
 *                                    shortened: mwkshow.com is the show's
 *                                    address (mate, 2026-09-22)
 *   --at YYYY-MM-DD                  hold it until that day. Stored as a full
                                   timestamp: a random instant inside the
                                   posting window (07:00-11:00 Brisbane),
                                   rolled ONCE here so held posts stop all
                                   landing at 10:05. The pace still applies on
                                   the day; without this it goes at the next
                                   slot the window and the pace allow
  --no-first-comment               post it with no CTA comment at all
 *   --no-reshare                     do not repost it from the personal LinkedIn
 *
 * Needs CLOUDFLARE_API_TOKEN, so run it through scripts/with-secrets.sh.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ulid } = require('./lib/events');
const platforms = require('./lib/platforms');
const { PLATFORMS } = platforms;
const captions = require('./lib/captions');
// `mediaLib`, because main() already has a local `media` holding the R2 key —
// the same name twice in one file is how the wrong one gets read.
const mediaLib = require('./lib/media');
const pace = require('./lib/pace');

// YouTube's title cap. The title is the first line of the caption, so the cap
// is on his words, not on anything we compose. Zernio's YouTube page, 2026-09-20.
const YOUTUBE_TITLE_MAX = 100;
const { wordProblems } = require('./lib/words');
// For links.show and the short-link host: the one place either is written down.
const voice = require('./lib/voice');

const WEB = path.join(__dirname, '..', 'web');
const BUCKET = 'mwk-social-media';
const DB = 'mwk-social';

const TYPE = { '.mp4': 'video/mp4', '.mov': 'video/mp4', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.png': 'image/png' };

/** A SQL string literal. NULL when there is nothing, doubled quotes when there is. */
function lit(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Is this a URL we should store as-is, or a file we have to upload? */
const isUrl = (s) => /^https?:\/\//i.test(s);

/**
 * Upload one file to R2 under a dated, readable key. The extension is
 * load-bearing twice over: wrangler infers nothing from content, and further
 * down the line `zernio media:upload` reads the content type off the extension
 * and rejects a file without one.
 */
function toR2(file, dryRun) {
  const ext = path.extname(file).toLowerCase();
  const type = TYPE[ext];
  if (!type) throw new Error(`no content type for ${ext || 'a file with no extension'} — ${file}`);
  const day = new Date().toISOString().slice(0, 10);
  const slug = path.basename(file, ext).replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  /*
   * The ULID is what stops two files quietly becoming one. The key was
   * `queue/<day>-<slug><ext>` with nothing unique in it, and an R2 put is an
   * overwrite: queue two files both called clip.mp4 on the same day and the
   * second silently replaces the first, while the first queue item still points
   * at that key — so it publishes the SECOND video, under the FIRST one's
   * words, with no error anywhere. The Worker's own uploader has always keyed
   * on a ULID for this reason; this path had not caught up.
   *
   * The day and the slug stay because the bucket is browsed by humans.
   */
  const key = `queue/${day}-${slug || 'clip'}-${ulid()}${ext}`;
  if (!dryRun) {
    execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`,
      `--file=${file}`, `--content-type=${type}`, '--remote'],
    { cwd: WEB, stdio: 'inherit' });
  }
  return [key, type];
}

function parse(argv) {
  const opt = { platforms: [], topics: [], mediaList: [], firstComment: 1, reshare: 1, dryRun: false };
  const take = (i) => {
    if (i + 1 >= argv.length) throw new Error(`${argv[i]} wants a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '-h': case '--help': opt.help = true; break;
      case '--body': opt.body = take(i); i++; break;
      case '--body-file': opt.bodyFile = take(i); i++; break;
      // Comma-separated: the first is the post's media, the rest are a GALLERY
      // riding with it. Stills only — run-queue collapses a mixed set to the
      // first item rather than half-publishing one.
      case '--media': opt.mediaList = splitList(take(i)); i++; break;
      case '--media-key': opt.mediaKey = take(i); i++; break;
      case '--media-wide': opt.mediaWide = take(i); i++; break;
      case '--priority': {
        const n = Number(take(i)); i++;
        if (!Number.isInteger(n)) throw new Error(`--priority wants a whole number, got ${argv[i]}`);
        opt.priority = n; break;
      }
      case '--platforms': opt.platforms = take(i).split(',').map((s) => s.trim()).filter(Boolean); i++; break;
      case '--topics': opt.topics = take(i).split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean); i++; break;
      case '--comment': opt.comment = take(i); i++; break;
      case '--link': opt.link = take(i); i++; break;
      case '--at': opt.at = take(i); i++; break;
      case '--no-first-comment': opt.firstComment = 0; break;
      case '--no-reshare': opt.reshare = 0; break;
      case '--dry-run': opt.dryRun = true; break;
      default: throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  if (opt.help) return opt;
  if (opt.body && opt.bodyFile) throw new Error('--body or --body-file, not both');
  if (opt.bodyFile) opt.body = fs.readFileSync(opt.bodyFile, 'utf8');
  opt.body = (opt.body || '').trim();
  if (!opt.body) throw new Error('nothing to post — pass --body or --body-file');
  // The gate on his words (lib/words.js). This path is how Restream's caption
  // got in on 2026-09-13; the dashboard form has the same gate.
  const held = wordProblems(opt.body);
  if (held.length) throw new Error(`not queued — ${held.join('; ')}. His words, in his voice, or it does not go.`);

  /*
   * A LINK SLOT WANTS A URL, and the one time it was handed prose the pin
   * died at Pinterest with `Invalid URL or request data` (2026-09-22). Caught
   * here, where it is one edit, rather than nine hours later at publish.
   * A mwkshow.com code is refused for the same reason the minter refuses to
   * make one: that host means the show, so a project pointed at it would say
   * the wrong thing however well it resolved.
   */
  if (opt.link !== undefined) {
    let u;
    try { u = new URL(opt.link); } catch { throw new Error(`--link wants a url, got ${JSON.stringify(opt.link)}`); }
    if (!/^https?:$/.test(u.protocol)) throw new Error(`--link wants an http(s) url, got ${opt.link}`);
    if (u.hostname.toLowerCase().endsWith(voice.shortLink().host)) {
      throw new Error(`--link wants the page's own full url, not a ${voice.shortLink().host} code — that host is the show's`);
    }
  }

  /*
   * A bare YYYY-MM-DD unlocks at midnight UTC, which is 10:00 Brisbane, and the
   * publish timer fires at :05 — so EVERY held item went out at 10:05. It
   * happened eleven days running before anyone counted (2026-09-21). The day
   * is still what he types; what gets stored is that midnight plus a random
   * 0-60 minutes, so the unlock edge moves.
   *
   * Rolled HERE, once, and written to the row. The gap jitter in lib/pace.js
   * has to be hashed instead, because the pace is recomputed every tick and a
   * fresh roll each time collapses to the minimum — this value is computed a
   * single time and stored, so real randomness is correct and simpler.
   *
   * It stays a morning: 0-60 minutes past 10:00 Brisbane is what he asked for
   * when he said "brisbane time in the morning".
   *
   * A typo would hold a post for ever with nothing to show for it, so the shape
   * is checked rather than trusted.
   */
  if (opt.at !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opt.at)) throw new Error(`--at wants YYYY-MM-DD, got ${opt.at}`);
    if (Number.isNaN(Date.parse(opt.at))) throw new Error(`--at is not a real date: ${opt.at}`);
    opt.at = unlockAt(opt.at);
  }

  // A platform typo would silently post nowhere, since an unknown name simply
  // never matches. Fail here instead, where it is one word to fix.
  const known = Object.keys(PLATFORMS);
  const wrong = opt.platforms.filter((p) => !known.includes(p));
  if (wrong.length) throw new Error(`not a platform: ${wrong.join(', ')} — have ${known.join(', ')}`);

  // The first line of his words IS the YouTube title (Zernio's YouTube page:
  // "a public video whose title is the first line of content"), and YouTube
  // cuts a title at 100. A long opening sentence would go out chopped with
  // nothing saying so — refuse it here, where it is one line break to fix.
  // Only when YouTube can be a target: an empty list means "wherever it fits".
  const youtubeMayCarry = !opt.platforms.length || opt.platforms.includes('youtube');
  const firstLine = captions.titleLine(opt.body);
  if (youtubeMayCarry && firstLine.length > YOUTUBE_TITLE_MAX) {
    throw new Error(`the first line becomes the YouTube title and is ${firstLine.length} characters; `
      + `YouTube cuts it at ${YOUTUBE_TITLE_MAX}. Break it, or leave youtube out of --platforms`);
  }

  /*
   * WHICH PLATFORMS HIS WORDS ARE TOO LONG FOR, decided HERE rather than at
   * publish time (2026-09-21). A 318 character caption went out to seven
   * platforms and X was dropped nine hours later, correctly, with a line in
   * the journal that nobody read — it had been announced as going to eight.
   *
   * Two different answers on purpose, and the difference is whether he asked
   * for that platform BY NAME:
   *   - named   → throw. He said twitter, twitter cannot take it, and
   *               silently posting to everything else is not what he asked
   *               for. Shortening it is one edit.
   *   - implied → record it. An empty list already means "wherever it fits",
   *               so dropping one is legitimate; what was missing was anybody
   *               being told. It rides out on the `queued` line instead.
   *
   * His words are never truncated to make them fit — post.js gives up our
   * tags and then our link and stops, which is the rule this reads from.
   */
  opt.wontFit = captions.wontFit(opt.body, opt.platforms);
  const named = opt.wontFit.filter((w) => w.named);
  if (named.length) {
    throw new Error(`not queued — ${named.map((w) => `${w.platform} takes ${w.max} characters `
      + `and his words are ${captions.captionLength(w.platform, opt.body)}`).join('; ')}. `
      + `Shorten it, or leave ${named.map((w) => w.platform).join(', ')} out of --platforms.`);
  }
  return opt;
}

/*
 * Split --media on commas. A comma inside a FILENAME would break this, which is
 * why the split is here and not inlined: if that ever bites, one function moves
 * to an explicit repeat-the-flag form and every caller keeps working.
 */
function splitList(v) {
  return String(v).split(',').map((x) => x.trim()).filter(Boolean);
}

/**
 * A held day becomes a real instant inside the posting window.
 *
 * The window comes from `pace.DEFAULTS` rather than a number here, because
 * two places holding the same hours is how they end up disagreeing: a hold
 * that unlocked before the window would simply sit there refused by the pace,
 * and a hold that unlocked after it would lose a morning.
 *
 * The offset is DERIVED, not hardcoded +10. Midnight UTC is asked what hour
 * it is in the audience's timezone and the difference is applied, so the
 * arithmetic survives the timezone being changed.
 *
 * The roll is made ONCE, here, and stored on the row. The gap jitter in
 * lib/pace.js has to be hashed instead, because the pace is recomputed every
 * tick and a fresh roll each time collapses to the minimum — this value is
 * computed a single time, so real randomness is correct and simpler.
 */
function unlockAt(day, roll = Math.random()) {
  const w = pace.DEFAULTS.window;
  const from = w ? w.from : 10;
  const spanMinutes = w ? (w.to - w.from) * 60 : 60;
  const utcMidnight = Date.parse(`${day}T00:00:00.000Z`);
  const hourThere = pace.zoned(new Date(utcMidnight), pace.DEFAULTS.tz).hour;
  const start = utcMidnight - (hourThere - from) * 3600000;
  const minutes = Math.floor(roll * spanMinutes);   // end-exclusive, like the window
  return new Date(start + minutes * 60000).toISOString();
}
/* Kept for the tests and the header: how wide the roll is. */
const AT_JITTER_MINUTES = pace.DEFAULTS.window
  ? (pace.DEFAULTS.window.to - pace.DEFAULTS.window.from) * 60 : 60;

/** The INSERT, as text. Separated out so a test can read it without a network. */
function sqlFor(opt, id, media, mediaWide, now, extraKeys) {
  const [mediaKey, mediaType] = media;
  // NULL rather than '[]' when there is no gallery: the Worker tests the column
  // for truthiness, and an empty array is truthy once it is a string.
  const extra = (extraKeys && extraKeys.length) ? JSON.stringify(extraKeys) : null;
  return `INSERT INTO queue_item (id, created_at, created_by, status, body, platforms,
  media_key, media_url, media_type, media_extra, first_comment, priority,
  reshare, reshare_text, comment_text, topics, media_wide_key, media_wide_url,
  not_before, link)
VALUES (${lit(id)}, ${lit(now)}, 'box@mwk-social', 'queued', ${lit(opt.body)},
  ${lit(JSON.stringify(opt.platforms))},
  ${lit(mediaKey)}, ${lit(opt.mediaUrl)}, ${lit(mediaType)}, ${lit(extra)}, ${opt.firstComment}, ${Number.isInteger(opt.priority) ? opt.priority : 0},
  ${opt.reshare}, NULL, ${lit(opt.comment)},
  ${lit(JSON.stringify(opt.topics))}, ${lit(mediaWide[0])}, ${lit(opt.mediaWideUrl)},
  ${lit(opt.at)}, ${lit(opt.link)});
`;
}

/**
 * WHICH PLATFORMS WILL PUBLISH THE TITLE LINE ALONE, said at the keyboard.
 *
 * The publisher works this out per platform from the clip (mate, 2026-09-22:
 * the caption is drawn over the subtitles on a short). That is the right
 * place to DECIDE it and the wrong place to first hear about it — the same
 * lesson as the caption-fit line beside it, where a platform was dropped nine
 * hours after the last human looked. So it is computed here too and printed
 * on the line he already reads.
 *
 * A URL, a --media-key, or a file ffprobe cannot read gives null: no claim
 * either way, rather than a guess.
 *
 * @returns {string|null} one line, or null when nothing here is a short.
 */
function overlayLine(file, wanted) {
  if (!file || isUrl(file)) return null;
  let probe = null;
  try { probe = mediaLib.probe(file); } catch { return null; }
  if (!platforms.isShort(probe)) return null;
  const names = Object.keys(PLATFORMS)
    .filter((p) => !wanted.length || wanted.includes(p))
    .filter((p) => platforms.captionOverlaysShortFor(p, probe));
  if (!names.length) return null;
  return `a short — ${names.join(', ')} get the title line and the tags, not the story; `
    + 'the first comment is unchanged';
}

/** The usage block at the top of this file, so there is one copy of it. */
function usage() {
  const src = fs.readFileSync(__filename, 'utf8');
  const header = src.slice(src.indexOf('/*'), src.indexOf('*/'));
  return header.replace(/^\/\*\n?/, '').replace(/^ ?\* ?/gm, '').trimEnd();
}

function main() {
  const opt = parse(process.argv.slice(2));
  if (opt.help) { console.log(usage()); return; }

  const [first, ...rest] = opt.mediaList || [];
  let media = [null, null];
  if (opt.mediaKey && first) throw new Error('--media or --media-key, not both');
  if (opt.mediaKey) {
    // An object already in the bucket. The type comes off the key's extension,
    // the same way the uploader named it in the first place.
    media = [opt.mediaKey, TYPE[path.extname(opt.mediaKey).toLowerCase()] || null];
    if (!media[1]) throw new Error(`--media-key ${opt.mediaKey}: no content type for that extension`);
  } else if (first && isUrl(first)) {
    opt.mediaUrl = first;
    media = [null, TYPE[path.extname(new URL(first).pathname).toLowerCase()] || null];
  } else if (first) {
    media = toR2(first, opt.dryRun);
  }

  // The gallery. A pasted URL cannot ride here — media_extra holds R2 KEYS, and
  // the Worker turns each one into a fetch-back url. Fail loudly rather than
  // silently dropping images the caller asked for.
  const extraKeys = [];
  for (const m of rest) {
    if (isUrl(m)) throw new Error(`--media takes local files for a gallery; ${m} is a URL`);
    extraKeys.push(toR2(m, opt.dryRun)[0]);
  }

  let mediaWide = [null, null];
  if (opt.mediaWide && isUrl(opt.mediaWide)) opt.mediaWideUrl = opt.mediaWide;
  else if (opt.mediaWide) mediaWide = toR2(opt.mediaWide, opt.dryRun);

  const id = ulid();
  const sql = sqlFor(opt, id, media, mediaWide, new Date().toISOString(), extraKeys);
  // The local file, not the R2 key: ffprobe needs bytes it can read.
  const shortLine = overlayLine(opt.mediaKey ? null : first, opt.platforms);

  if (opt.dryRun) {
    console.log(sql);
    // A dry run is exactly when he wants to hear this, so it is not only on
    // the success path.
    const dryLine = captions.wontFitLine(opt.wontFit);
    if (dryLine) console.log(`-- ${dryLine}`);
    if (shortLine) console.log(`-- ${shortLine}`);
    console.log(`-- points at ${opt.link || `${voice.config().links.show} (the show)`}`);
    console.log('-- --dry-run: nothing written, nothing uploaded');
    return;
  }

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mwk-queue-')), 'add.sql');
  fs.writeFileSync(file, sql);
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', `--file=${file}`, '-y'],
      { cwd: WEB, stdio: 'inherit' });
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
  console.log(`queued ${id} — ${opt.platforms.length ? opt.platforms.join(', ') : 'wherever it fits'}`);
  // On the SAME line he already reads. A warning further up the output is the
  // same failure as a line in the journal: true, and not looked at.
  const line = captions.wontFitLine(opt.wontFit);
  if (line) console.log(`  ${line}`);
  if (shortLine) console.log(`  ${shortLine}`);
  // Where a tap lands, on the line he already reads — the pin that pointed at
  // the show was correct code and the wrong destination, and nothing said so.
  console.log(`  points at ${opt.link || `${voice.config().links.show} (the show)`}`);
  console.log('https://social.matewishkey.com/queue');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { lit, sqlFor, parse, unlockAt, AT_JITTER_MINUTES };
