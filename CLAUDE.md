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
- Image swap on a published post = `posts:unpublish --platform <p>` + recreate (`posts:edit`
  is text-only). **Instagram cannot delete or edit via API at all** — manual only.
- YouTube metadata in bulk: `posts:update-metadata <id> --platform youtube --videoId <vid>
  --accountId <acc> --description/--title/--tags/--thumbnailUrl/--playlistId`
  (`--videoId` on non-Zernio videos documented but NOT yet tested).
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
