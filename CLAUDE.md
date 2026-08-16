# mwk-social — Zernio social-media integration

Agent notes for working in this repo. (This repo is public — keep this file free of account
IDs, billing details, and internal URLs; that state lives outside the repo.)

## Setup

- CLI: `./node_modules/.bin/zernio` (`@zernio/cli`, local dev dependency; node pinned via `mise.toml`).
- Auth: the CLI reads `~/.zernio/config.json`, created by `zernio auth:login` (device flow).
- `zernio auth:check` verifies auth; `zernio accounts:health` verifies connections;
  `zernio accounts:list` is the source of truth for connected account IDs.
- zsh gotcha (bit twice): inline `node -e '...'` inside `$(...)` loses its closing paren —
  put the JS in a script file instead.

## Proven mechanics (all exercised live)

- Multi-account publish in one `posts:create --accounts id1,id2,...`; `media:upload <file>` first.
- **First comment** (the links-out-of-body strategy): `inbox:reply <postId> --accountId <acc>
  --message "..."` with NO `--commentId` posts a top-level comment. Works on FB, LI, IG.
- Image swap on a published post = `posts:unpublish --platform <p>` + recreate (`posts:edit`
  is text-only). **Instagram cannot delete or edit via API at all** — manual only.
- YouTube metadata in bulk: `posts:update-metadata <id> --platform youtube --videoId <vid>
  --accountId <acc> --description/--title/--tags/--thumbnailUrl/--playlistId`
  (`--videoId` on non-Zernio videos documented but NOT yet tested).
- Native/past posts: `analytics:posts --source external` (analytics layer, ~2-week lookback,
  no YouTube coverage — YT gets channel-level analytics commands instead).

## Platform gotchas (verified against docs.zernio.com)

- **Facebook posts to Pages only** — personal timelines are impossible via any API (Meta rule).
  Tokens ~60 days; watch `accounts:health`.
- **LinkedIn**: 3,000-char limit; duplicate content → 422; external links suppress reach
  (−40–50%) — hence the first-comment mechanic. Reshare/quote-repost an existing post via REST
  `platformSpecificData.reshareUrl` (not exposed as a `posts:create` flag).
- **Instagram**: business account required; media mandatory; caption folds at ~125 chars;
  no delete/edit via API.
- **TikTok**: API posts have their own strict daily cap (separate from the app); consent flags
  required per post; no comments/DMs/FYP analytics via API; 9:16 video 3s–10min or carousels.
- **YouTube**: vertical <3min auto-classifies as a Short; Shorts get NO custom thumbnails
  (regular videos do); impressions/CTR exist only in Studio's UI, not in any API.
