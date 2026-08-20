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
- **Everything we say out loud lives in `config/voice.json`** — the CTA variants, identity and
  brand tags, per-platform hashtag caps, the blocklist, the YouTube show blurb, the feed URL.
  `scripts/lib/voice.js` is the only reader; no script carries its own copy any more.
  It must contain `marker` (`matewishkey.com/show`) and every variant must contain `{show}`:
  the dedupe guard keys off that string, so a variant that dropped the URL would have the watcher
  duplicate every natively-posted comment. `voice.js` refuses to load a config that breaks either
  rule, and refuses to return a composed comment that has lost the marker.
- **The first comment rotates.** A variant is picked deterministically from the post's key, so a
  re-run renders the identical comment while consecutive posts differ; the last index used per
  platform is kept in the state file so the same one never lands twice running. Roughly
  `episodeMixRatio` of comments quote a real guest wish pulled from the show's RSS feed and link
  that episode. If the feed is unreachable every comment falls back to a plain variant —
  freshness must never block a comment.
- **Hashtag caps are enforced per platform in `voice.tagLine()`** — the always-on trio is
  `#PIY #MWKShow #MWK`, so Instagram's 5 leaves room for exactly two topic tags, and a cap tighter
  than the trio (X's 1) truncates it rather than blowing the budget.
- **`matewishkey.com/show` is the guest SIGN-UP page, not the stream** — the show goes out live on
  youtube.com/@matewishkey and twitch.tv/matewishkey. Don't conflate them in a CTA.
- **Catch-all first-comment watcher**: `scripts/first-comment.js`, run hourly by the
  `mwk-first-comment.timer` systemd --user unit (install/refresh:
  `scripts/install-timers.sh`, logs: `journalctl --user -u mwk-first-comment`).
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
  `#PIY`, `#MWKShow` and `#MWK` lead every comment, then ≤4 topic tags. "Prompt it Yourself" stays in
  the comment TEXT where it reads as a sentence — it is not a tag. **Keys come from `~/.secrets`,
  which is why the systemd unit runs through `zsh -c 'source ~/.secrets && …'`** — systemd's
  `EnvironmentFile` cannot parse shell syntax. No keys → plain CTA, never a failed comment.
- **Tags chosen for WHO they reach are allowed on a manual post** (mate's call, 2026-08-20),
  reversing the earlier subject-matter-only rule. The target is people currently paying providers
  who could build it themselves. Evidence gathered that day, worth not re-deriving: `#NoCode`
  co-occurs with `#webdesign`/`#webflow`/`#uiux` — it reaches the people who build FOR others, the
  supply side, not the buyer. `#LearnAI` co-occurs with `#chatgpt`/`#machinelearning`, the
  already-using-AI crowd. `#SmallBusiness` runs ~1,800 posts/hour against `#SmallBusinessOwner`'s
  ~362 for the same audience. And Instagram's own head says hashtags do not drive reach at all —
  they feed SEARCH — so the words in the caption matter more than the tag list.
  `topic-tags.js` still derives subject-matter tags for the automated watcher; this applies to
  what a human picks for a hand-published post.
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
- **X: the link goes in the post, not a comment.** Its comment endpoints 403 on this plan (read
  *and* reply, verified 2026-08-19), so the first-comment mechanic is impossible there. Two ways
  to get a link out — `platformSpecificData.threadItems` publishes a root tweet plus replies in
  one call, or just put the link in the post. **The post is cheaper**: X bills
  `content_create_with_url` at **$0.20** against $0.015 for a post without one, and the fee lands
  on whichever tweet holds the URL — so a thread pays the $0.20 *plus* $0.015 for the extra
  tweet. Measured, not inferred: 2 × $0.015 + 1 × $0.20 = the 23c on `usage:stats.spend.xSpendCents`.
  (Zernio's `usage:x-pricing` lists `content_create_with_url` with an empty `triggeredBy`; that
  metadata is wrong — the operation does fire.)
- **X link suppression is a non-Premium problem** — Premium accounts post links normally, so with
  the subscription live there is no reason to keep links out of the post.
- **Threads works like Instagram**: connected through the same Meta auth, comments readable and
  repliable, 500-char cap, video to 5 minutes. It is in the watcher's platform list.
- **A caption that already carries the CTA link is left alone** — the watcher skips it rather than
  posting a comment repeating the same URL.
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

- **The mirror** (`scripts/mirror.js`, read-only so far: `--plan`, `--seed`) reposts Facebook
  reels to what Restream misses. **Its universe is Facebook posts with `mediaType: 'video'`** —
  7 of the 18 Facebook posts; the rest are image/text and are not reels. Ledger lives outside the
  repo at `~/.local/state/mwk-social/mirror-ledger.json`; seeded 2026-08-20 as 9 already-live and
  19 queued. `test/fixtures/corpus.json` is the live corpus at that date and the regression gate.
- **Dedupe is caption-only, because nothing else exists across platforms.** `videoDurationSeconds`
  sits at `analytics.videoDurationSeconds` (on the post *and* on `platforms[]`) and **only
  Instagram populates it**, on some posts; TikTok and X return `url:null`/`platform_withheld`.
  Two rules the 2026-08-19 TikTok duplicate taught: compare captions on the **shorter** one's
  length (the manual post's caption normalises to 45 chars against our 64 — a fixed 64-char key
  never matches it), and any "published before the source" penalty needs a **tolerance window**,
  because that manual TikTok predates its own Facebook source by a minute.
- **The matcher fails closed**: `duplicate`, `review` and `unknown` all mean *do not publish*; only
  `none` publishes. Threads is `verifiable: 'none'` — invisible to `analytics:posts` — so absence
  there proves only that *we* have not mirrored it; it publishes flagged `weak`, backed by the
  ledger, because Threads posts can be deleted.

- **Media: `scripts/lib/media.js`, `mirror.js --media`.** Resolves a clip once and caches it in
  `~/.local/state/mwk-social/media/`. Facebook URL first, **YouTube via `yt-dlp` when it 403s** —
  which is also the better copy (1080x1920 against Facebook's 720x1280). All 7 reels resolve;
  2 of them only through YouTube. `ffprobe` is required and now installed in `~/.local/bin`
  (dotfiles-cz#36 asks for it, and yt-dlp, in the baseline). Two yt-dlp traps: it **appends its own extension
  to `-o`** (ask for `x`, get `x.mp4`, read it as "downloaded nothing"), and it **serves AV1 by
  default** — force `[vcodec^=avc1]` because IG and TikTok want H.264.
- **Node's `fetch` cannot reach a Meta CDN from this box — and it looks exactly like an expired
  URL.** `ETIMEDOUT` at ~253 ms every time: no IPv6 route here, the AAAA record wins the lookup,
  and undici's Happy Eyeballs window is 250 ms so it never tries IPv4. curl falls back and gets a
  206. Media downloads shell out to curl for this reason; if you must use fetch,
  `net.setDefaultAutoSelectFamilyAttemptTimeout(500)` fixes it (measured 4/4).
- **The Instagram 1.91:1 rejection is an IMAGE rule, not a video one.** `media.check()` treats the
  video aspect range as inclusive at both ends — applying the image edge there rejects a
  legitimate square reel.

- **`mirror.js --apply` publishes; all four targets verified live 2026-08-20.** Threads
  `DcP1ZQWD_Ly`, X `2090285587903160541`, TikTok `v_pub_url~v2-1.7675951303247562753`, Instagram
  `DcP2BWJFR7y` (native first comment confirmed on it: CTA + exactly 5 tags, caption carries none).
  Default is one post per run. **Instagram refuses to run on a clip until the other three targets
  are done** — the schedule already orders it last, but `--platforms instagram` skips that, so the
  rule lives in the publish path.
- **TikTok settings go in `tiktokSettings` at the TOP LEVEL of the request body, not
  `platformSpecificData`** (docs.zernio.com/platforms/tiktok). This is the one real special case,
  and getting it wrong is silent — `platformSpecificData` stores and echoes any key, so it would
  look accepted while the post went out with no consent flags. Six flags, all `required` with
  `default: false`: `allow_comment`, `allow_duet`, `allow_stitch`, `content_preview_confirmed`,
  `express_consent_given`, plus `privacy_level`. TikTok's live `maxVideoDurationSec` is **3600**,
  not the 600 the static table assumed — read `accounts:tiktok-creator-info`.
- **A publish call that times out has NOT necessarily failed.** Bitten on the first live mirror:
  the request aborted at 60s and the post was live on Threads anyway. Zernio keeps processing after
  the caller gives up, so a timeout is *unknown* — reconcile by searching `posts:list` for the
  caption you just composed. The publish timeout is now 240s and the ledger is written **before**
  the request.
- **TikTok returns a publish token, not a video ID** (`v_pub_url~v2-1.…`); the real numeric ID
  arrives later with the analytics sync. It also returns **no post URL at all**.
- **X's $0.20 URL fee, confirmed a third time**: `xSpendCents` went 23 → 43 across one mirrored
  post carrying a link.

- **Three systemd --user timers, installed by `scripts/install-timers.sh`** (which replaced the
  first-comment-only installer): `mwk-first-comment` at `*:00`, `mwk-mirror` at `*:10`, and
  `mwk-ship-events` every 2 min. The
  mirror runs `--apply --scheduled`, so **the pace lives in the script, not the cron cadence** —
  the timer is a dumb hourly heartbeat and `whyNotNow()` says no most of the time. A hand run
  obeys the same rules. `:10` keeps the mirror ten minutes behind the comment run so a freshly
  mirrored clip has settled before the watcher looks for it.
- **The posting window is the AUDIENCE's timezone, not the box's.** This machine is `Etc/UTC`; the
  window is `Australia/Brisbane` (`MWK_TZ` overrides). Unqualified, "09:00–21:00" would have put
  every post out between 19:00 and 07:00 Brisbane — the entire window overnight. Day boundaries for
  the daily cap are zoned too, or the cap resets twelve hours early.
- **Seeding must preserve provenance.** `--seed` repairs an unsettled ledger entry from the live
  platform, and if that entry has an `at` then **we** posted it — relabelling it "already live
  before the mirror ran" drops it from the day's pace count and the drip overshoots.

- **The dashboard is `web/`, deployed with `web/deploy.sh` (locally, never on push).** One Worker
  `mwk-social-log`, two custom domains — `internal.matewishkey.com` (Cloudflare Access, email OTP,
  allowing mate@ and suzy@matewishkey.com) and `ingest.matewishkey.com` (bearer token). D1 database
  `mwk-social`. **`workers_dev = false` is the load-bearing line**: Access binds to a *hostname*,
  not to a script, so leaving it on would serve the whole dashboard ungated on
  `*.workers.dev` beside the gated one. The Worker verifies the `Cf-Access-Jwt-Assertion` itself —
  signature, `aud` **and** expiry; a signature alone would accept a token minted for a different
  app in the same Access org.
- **No SQL projections.** The dashboard renders `mirror-ledger.json` shipped whole as a snapshot.
  The ledger is already the authoritative projection, computed by the thing that knows the truth,
  so rebuilding it in D1 would only add a way for the two to disagree.
- **`scripts/ship-events.js` every 2 min; the cursor advances only on a 2xx**, and replays are free
  (`INSERT OR IGNORE` on a stable ULID). It sends an **empty batch when idle** — without that
  heartbeat "nothing happened" and "the box is off" are the same picture.
- **`MWK_LOG_TOKEN` / `MWK_LOG_URL` live in `td-sops/apps/mwk-social.enc.env`**, and
  `scripts/with-secrets.sh` is what puts both those and `~/.secrets` into a unit's environment —
  systemd's `EnvironmentFile` can read neither.
- **The IPv6 trap bites the dashboard hostnames too**: they resolve AAAA-first and this box has no
  IPv6 route, so plain `curl` fails to connect in ~14 ms and `fetch` times out. Use `curl -4` when
  testing by hand; `ship-events.js` sets `net.setDefaultAutoSelectFamilyAttemptTimeout(1000)`.

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
