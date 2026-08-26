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
 *   --media-wide PATH|URL            the landscape cut, for the platforms that take one
 *   --platforms a,b,c                default: empty, meaning "wherever it fits"
 *   --topics a,b,c                   topic tags, no # needed. Omit to let the
 *                                    watcher derive them from the transcript
 *   --comment TEXT                   a custom first comment instead of the rotation
 *   --no-first-comment               post it with no CTA comment at all
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
const { PLATFORMS } = require('./lib/platforms');

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
      case '--media-wide': opt.mediaWide = take(i); i++; break;
      case '--platforms': opt.platforms = take(i).split(',').map((s) => s.trim()).filter(Boolean); i++; break;
      case '--topics': opt.topics = take(i).split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean); i++; break;
      case '--comment': opt.comment = take(i); i++; break;
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

  // A platform typo would silently post nowhere, since an unknown name simply
  // never matches. Fail here instead, where it is one word to fix.
  const known = Object.keys(PLATFORMS);
  const wrong = opt.platforms.filter((p) => !known.includes(p));
  if (wrong.length) throw new Error(`not a platform: ${wrong.join(', ')} — have ${known.join(', ')}`);
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

/** The INSERT, as text. Separated out so a test can read it without a network. */
function sqlFor(opt, id, media, mediaWide, now, extraKeys) {
  const [mediaKey, mediaType] = media;
  // NULL rather than '[]' when there is no gallery: the Worker tests the column
  // for truthiness, and an empty array is truthy once it is a string.
  const extra = (extraKeys && extraKeys.length) ? JSON.stringify(extraKeys) : null;
  return `INSERT INTO queue_item (id, created_at, created_by, status, body, platforms,
  media_key, media_url, media_type, media_extra, first_comment, priority,
  reshare, reshare_text, comment_text, topics, media_wide_key, media_wide_url)
VALUES (${lit(id)}, ${lit(now)}, 'box@mwk-social', 'queued', ${lit(opt.body)},
  ${lit(JSON.stringify(opt.platforms))},
  ${lit(mediaKey)}, ${lit(opt.mediaUrl)}, ${lit(mediaType)}, ${lit(extra)}, ${opt.firstComment}, 0,
  ${opt.reshare}, NULL, ${lit(opt.comment)},
  ${lit(JSON.stringify(opt.topics))}, ${lit(mediaWide[0])}, ${lit(opt.mediaWideUrl)});
`;
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
  if (first && isUrl(first)) {
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

  if (opt.dryRun) {
    console.log(sql);
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
  console.log('https://social.matewishkey.com/queue');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { lit, sqlFor, parse };
