# mwk-social — Zernio social-media integration

Agent notes for working in this repo. (This repo is public — keep this file free of account
IDs, billing details, and internal URLs; that state lives outside the repo.)

## Setup

- CLI: `./node_modules/.bin/zernio` (`@zernio/cli`, local dev dependency; node pinned via `mise.toml`).
- Auth: the CLI reads `~/.zernio/config.json`, created by `zernio auth:login` (device flow);
  `ZERNIO_API_KEY` (+ optional `ZERNIO_API_URL`) overrides it — the way to run this headless/in CI.
- `zernio auth:check` verifies auth; `zernio accounts:health` verifies connections;
  `zernio accounts:list` is the source of truth for connected account IDs.
- zsh gotcha (bit twice): inline `node -e '...'` inside `$(...)` loses its closing paren —
  put the JS in a script file instead. **zsh only** — `scripts/*.sh` run under bash and use the
  inline form deliberately; don't "fix" them.

## Proven mechanics (all exercised live)

- Multi-account publish in one `posts:create --accounts id1,id2,... --text ... --media <url>`
  (`--text`, not `--content`); `media:upload <file>` first, it returns the URL to pass.
  Per-platform results (status + live post URL, or the failure) come back on the parent post's
  `platforms[]` array — `posts:list --limit 1` and read `post.platforms[]`, nothing else exposes them.
- Pre-flight before publishing: `validate:post-length --text` (per-platform char limits) and
  `validate:media --url` (format, byte size, reachability). **Neither checks image aspect ratio,
  and `validate:post --platforms --content` passes an Instagram post with no media at all** — so
  the two gotchas that have actually bitten (IG aspect, IG media-mandatory) are still on you:
  check aspect with `identify` before upload.
- **First comment** (the links-out-of-body strategy): `inbox:reply <postId> --accountId <acc>
  --message "..."` with NO `--commentId` posts a top-level comment. Works on FB, LI, IG.
  **Every `inbox:*` command wants the PLATFORM's native post ID** (`platforms[].platformPostId`)
  — the Zernio `_id` that `analytics:posts` returns 404s ("Use a valid Zernio post ID or the
  platform's native post ID"). Bitten on an app-posted reel; verified live 2026-08-19.
- **Native first comment on publish**: `platforms[].platformSpecificData.firstComment` — Zernio
  posts it itself, seconds after the post goes live. FB (feed + Reels, not Stories), IG (feed +
  carousels per the docs; Reels not stated), LinkedIn, YouTube (posted *and* pinned, 10k chars).
  **No TikTok.** Skipped on drafts. **The CLI has no flag for it**, same as `reshareUrl` — so
  `scripts/post.js` talks to `POST /v1/posts` directly; `posts:create` cannot do this.
  Verified live 2026-08-19 on YouTube.
- **The standard first comment lives in `first-comment.txt`** — one file, read by both paths.
  It must contain `matewishkey.com/show`: the dedupe guard keys off that string, so a template
  edited to drop the URL would have the watcher duplicate every natively-posted comment. Both
  `first-comment.js` and `post.js` refuse to run without it.
- **`matewishkey.com/show` is the guest SIGN-UP page, not the stream** — the show goes out live on
  youtube.com/@matewishkey and twitch.tv/matewishkey. Don't conflate them in a CTA.
- **Catch-all first-comment watcher**: `scripts/first-comment.js`, run hourly by the
  `mwk-first-comment.timer` systemd --user unit (install/refresh:
  `scripts/install-first-comment-timer.sh`, logs: `journalctl --user -u mwk-first-comment`).
  Covers what the publish-time field cannot: posts made in the apps, live-event videos, anything
  created straight on the platform. IG/FB/LI/YT, any post type; **TikTok is impossible** (no
  comments API at all). Skips a post that already carries the CTA link, whoever put it there, so
  it composes with the native field instead of double-posting. State lives outside the repo at
  `~/.local/state/mwk-social/first-comments.json`. `--dry-run`, `--seed` (mark in-window posts
  done without commenting — used when widening scope, to avoid a burst of backfill), `--hours N`,
  `--all`, `--platforms`, `--limit N`, `--no-topics` (skip transcription, plain CTA), `--message`.
  Pings `$MWK_COMMENT_HC_URL` (and `/fail`) when that env var is set — the hook exists, no check
  is provisioned yet. To backfill later, drop the `"note": "seeded…"` entries
  from the state file and re-run.
- **The comment's hashtags describe the video**: `scripts/lib/topic-tags.js` downloads the clip,
  strips the audio (ffmpeg), transcribes it (Whisper) and names the subjects it covers
  (Gemini, constrained). Subject matter only — no audience tags, no marketing; `BLOCKED` in that
  file hard-stops the mainstream AI/creator/hype tags whatever the model returns.
  `#PromptItYourself` leads every comment, then ≤4 topic tags. **Keys come from `~/.secrets`,
  which is why the systemd unit runs through `zsh -c 'source ~/.secrets && …'`** — systemd's
  `EnvironmentFile` cannot parse shell syntax. No keys → plain CTA, never a failed comment.
- **YouTube needs a different transcript source**: `analytics:posts` returns a video mediaItem
  with an **empty url** for YouTube, so there is nothing to download. `yt-dlp --write-auto-subs`
  fetches the auto-captions instead — free, seconds, and it covers the whole video rather than
  the first 15 minutes of audio. `--download-sections` segfaults this box's ffmpeg build; don't
  reach for it. Auto-captions take hours to appear on a long stream, so a video with no
  transcript yet is deferred and retried (`MWK_CAPTION_GRACE_HOURS`, default 24) rather than
  spending its one un-editable comment on an untagged one.
- **Never pass a post ID to the CLI as a positional** — a YouTube video ID may start with `-`
  (`-Lf97N091NI`), which yargs reads as a flag: the command prints its help and the script sees a
  failure. There is no `--` escape that works. `scripts/lib/api.js` calls
  `GET/POST /v1/inbox/comments/{postId}` directly instead; verified against hyphenated YouTube
  IDs, LinkedIn `urn:li:share:…` and Facebook composite IDs.
- **Cache the transcript, and process promptly**: the media URLs Zernio returns are signed and
  expire, so a reel that isn't fetched soon after the sync sees it can never be transcribed.
  Results are cached per post in `~/.local/state/mwk-social/topics/` — transcription costs money
  and a post must only ever be processed once.
- **Instagram's 5-hashtag cap counts caption AND comments together** (enforced since
  2025-12-18; over the cap = no Explore, no hashtag pages, no Reels recommendations). Tags in the
  first comment buy no extra slots. So a reel posted from the app with tags already in its caption
  must not also get tags in its comment — and captions cannot be edited after publishing on IG.
- **`accounts:health` reporting `warning` is routine, not a fault** — Zernio refreshes tokens
  lazily, so an account passes through `warning` with the issue "Token expired or expiring soon
  (auto-refresh pending)" and returns to `healthy` on its own (watched it happen 2026-08-19).
  **Alerting must key on `needsReconnect: true` or `status: error`**, never on `warning`.
- **Two sources, and you need both**: `posts:list` carries a pipeline post the instant it
  publishes, while `analytics:posts` lags several minutes behind it — but `analytics:posts` is
  the only place natively-authored posts ever appear. `first-comment.js` reads both.
- **A comment read for a video the account doesn't own returns `success` with an empty list**,
  not an error — confirmed 2026-08-19 against a Short on the unconnected @matewishkey channel.
  So "no comments" never proves "not yet commented"; only go by posts the API actually lists.
- **YouTube blocks comments on private videos** — `inbox:post-comments` 403s
  ("Failed to fetch comments") and `firstComment` silently never lands. Unlisted is fine.
  The watcher treats a 403 as permanent and stops retrying that post.
- **`platformSpecificData` stores any key you send it**, invented ones included — so an echo in
  the create response proves storage, never support. Check the platform guide, don't infer.
- Image swap on a published post = `posts:unpublish --platform <p>` + recreate (`posts:edit`
  is text-only). **Instagram cannot delete or edit via API at all** — manual only.
- YouTube metadata in bulk: `posts:update-metadata <id> --platform youtube --videoId <vid>
  --accountId <acc> --description/--title/--tags/--thumbnailUrl/--playlistId`
  (`--videoId` on non-Zernio videos documented but NOT yet tested).
- Webhooks exist and would replace the hourly poll (`post.external.created` fires when a
  natively-authored post is first detected, `post.platform.published` per platform target) — not
  used: they need a public HTTPS endpoint, and detection still waits on the same ~90 min sync,
  so the only thing gained would be fewer API calls.
- Native/past posts: `analytics:posts --source external` — background sync every ~90 min per
  account picks up posts made manually in the apps (IG/FB/TikTok/YT covered; ~12 months of
  history kept per account; sync reads via the account token, so keep `accounts:health` green).
- Stories: an Instagram story shared onward to Facebook is FB-only there and has **no API
  analytics** on the Facebook side — IG insights are the only numbers you get.
- Stories: postable via API (`contentType: story`) but API stories get no stickers/links/music
  (Meta limit) — post stories manually; insights stay readable live + cached after 24h expiry
  (`instagram:get-story-insights`). TikTok likewise better manual (sound library, no API cap).

## Platform gotchas (verified against docs.zernio.com)

- **Facebook posts to Pages only** — personal timelines are impossible via any API (Meta rule).
  Tokens ~60 days; watch `accounts:health`.
- **LinkedIn**: 3,000-char limit; duplicate content → 422; external links suppress reach
  (−40–50%) — hence the first-comment mechanic. Reshare/quote-repost an existing post via REST
  `platformSpecificData.reshareUrl` + `content` (not exposed as a `posts:create` flag;
  exercised live 2026-08-17). **Posting playbook: post natively to the COMPANY page, then
  quote-reshare from the personal account with a thought on top** — never native-post to
  personal. Goal: build company-page engagement/followers to unlock LinkedIn Live there.
- **Instagram**: business account required; media mandatory; caption folds at ~125 chars;
  no delete/edit via API. Image aspect must be 0.75–1.91:1 and an image at *exactly* 1.91:1
  gets rejected (float edge, bitten live) — pad wide screenshots to ~1.78:1 with the
  screenshot's own bg color instead of cropping. Tall grabs (phone/email screenshots) fall off the
  other end — pad up to 4:5 (0.8) the same way, don't crop.
- **TikTok**: `accounts:tiktok-creator-info <accountId> --mediaType <video|photo>` returns the
  live privacy options and posting limits — read it instead of guessing the cap. A manually
  posted TikTok has been verified arriving via the external-post sync.
- **TikTok**: API posts have their own strict daily cap (separate from the app); consent flags
  required per post; no comments/DMs/FYP analytics via API; 9:16 video 3s–10min or carousels.
- **YouTube**: vertical <3min auto-classifies as a Short; Shorts get NO custom thumbnails
  (regular videos do); impressions/CTR exist only in Studio's UI, not in any API.
