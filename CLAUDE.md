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
- **Hashtag caps are enforced per platform in `voice.tagLine()`** — the always-on pair is
  `#MWKShow #PIY` (mate's call, 2026-08-20; `#MWK` dropped), so Instagram's 5 leaves room for three
  topic tags, and a cap tighter than the pair (X's 1) truncates it rather than blowing the budget.
- **`matewishkey.com/show` is the guest SIGN-UP page, not the stream** — the show goes out live on
  youtube.com/@matewishkey and twitch.tv/matewishkey. Don't conflate them in a CTA.
- **First-comment watcher**: `scripts/first-comment.js`, hourly via `mwk-first-comment.timer`
  (install/refresh: `scripts/install-timers.sh`, logs: `journalctl --user -u mwk-first-comment`).
  FB/IG/LI/YT get the comment natively at publish time; **Threads has no such field, so this is what
  covers it**, along with any post whose native comment silently failed. **It reads `posts:list`
  only** — the per-platform `analytics:posts` sweep was the net for app-authored posts and went with
  the mirror. TikTok and X are impossible (no usable comments API). State lives outside the repo at
  `~/.local/state/mwk-social/first-comments.json`. `--dry-run`, `--seed`, `--hours N`, `--all`,
  `--platforms`, `--limit N`, `--no-topics`, `--message`. Pings `$MWK_COMMENT_HC_URL` (and `/fail`)
  when set — the hook exists, no check is provisioned yet.
- **HASHTAGS ARE FOR NORMAL HUMANS, NEVER FOR TECH PEOPLE** (mate's call, 2026-08-21, absolute).
  His words: "#xero is well known, #cloudflare is not at all. #AIHallucination is borderline."
  **The test to apply to every tag: would someone who does NOT work in technology already know this
  word and use it themselves?** If they would have to look it up, it is wrong. Name the everyday
  thing — the job (Invoicing, Bookkeeping), the tool people already use by name (Xero, Canva,
  Dropbox), or the problem they recognise (LatePayments, ComputerProblems) — never the technology
  used to solve it. Backtested over 23 real videos: **79% of the tags we had already published (54
  of 68) are tech jargon the new rule rejects.** The prompt in `topic-tags.js` is the primary
  defence and the `blocked` list in `voice.json` is the hard backstop under it; the backstop only
  had to catch 1 of 45 on the rerun, but it is what stops a bad day from going out.
- **A product name is fine when ordinary people know the product.** #Xero, #Canva, #Dropbox,
  #StreamDeck yes; #Cloudflare, #GitHub, #Docker no. That distinction is the rule, not an exception
  to it.
- **Fewer good tags beat more weak ones, and none is an acceptable answer.** One of the 23 came back
  with no tag at all rather than reach for a technical word. That is the rule working.
- **The comment's hashtags describe the video**: `scripts/lib/topic-tags.js` downloads the clip,
  strips the audio (ffmpeg), transcribes it (Whisper) and names the subjects it covers
  (Gemini, constrained) — in everyday words, under the rule above; `BLOCKED` in `voice.json` is the
  hard stop whatever the model returns. `#MWKShow #PIY` lead every comment, then ≤4 topic tags.
  "Prompt it Yourself" stays in the comment TEXT where it reads as a sentence — it is not a tag.
  **Keys come from `~/.secrets`, which is why every systemd unit runs through
  `scripts/with-secrets.sh`** — systemd's `EnvironmentFile` cannot parse shell syntax, and neither
  `~/.secrets` nor the sops-encrypted project env is readable without a shell.
  No keys → plain CTA, never a failed comment.
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
- **`RULES_VERSION` in `topic-tags.js` is what makes a tag-rule change take effect.** The cache is
  keyed per post and `topicsFor` returned a hit unconditionally, so the 2026-08-21 rework would have
  changed **nothing** for any already-processed video — every one would have kept its old tech tags
  for ever. A cache hit now only counts if `cached.rules === RULES_VERSION`; a bump re-derives from
  the **stored transcript**, which is one model call and no re-transcription. **Bump it when the
  RULE changes, never when the code does.**
- **Anything already drafted from a cached result is stale too.** The 16 YouTube proposals sitting
  on the dashboard carried the old paraphrased blurb, the old `#MWK` trio and the old tech tags —
  approving one would have published exactly what had just been fixed. Discarded and redrafted.
  **After any voice or tag change, check what is already queued for approval.**
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
- **A CAPTION IS COMPOSED PER PLATFORM, and `publish()` groups by the caption a platform gets** —
  not by any fixed split. Three things vary and each is a platform rule, not a choice: the link
  (caption where there is no comments API), the hashtags (`hashtagsInCaption`), and nothing else.
  His words never vary. Today that yields: instagram+threads clean, facebook+youtube+linkedin
  tagged, tiktok and twitter one request each because each carries its own tracked link.
- **`hashtagsInCaption` was declared from the beginning and never read** — so LinkedIn, Facebook and
  YouTube posted with no hashtags at all until 2026-08-21. **Third field on that table to be
  decorative** after `linkPlacement` and `landscapeOk`. When adding a field there, wire it or do not
  add it: the config page renders them, which makes an unread field look implemented.
- **Tags go in the caption OR the comment, never both.** `voice.firstComment(..., { noTags: true })`
  suppresses them for a platform whose caption already carries them. On Instagram both would spend
  the 5-cap twice, since it counts caption and comments together.
- **One video per post, on every platform** (Facebook's docs are explicit; images and videos cannot
  be mixed either). So a vertical and a landscape cut are two posts, never one. `landscapeOk` on the
  platform table routes them: instagram/threads/tiktok are vertical-only, the rest take the wide
  cut. `queue_item.media_wide_key` carries the second one.
- **A LinkedIn repost with no commentary needs `content` OMITTED, not empty.** The docs are explicit
  that commentary is optional and leaving it out gives a one-click repost. `queue_item.reshare` is a
  separate flag from `reshare_text` for exactly this: an empty comment used to mean "do not repost".
- **`zernio media:upload` infers the content type from the FILE EXTENSION** and rejects a file
  without one. The download cache names files from a hash, so the extension has to be put back from
  the media type. Same shape as the yt-dlp trap: the download succeeds and the upload fails.
- **A click is attributed platform-first, referer-second, and only then unattributed.** Codes minted
  before they were per-platform served all five comment platforms at once and can never be
  attributed by code — but the referer still answers it. Referer matching is **anchored**, so
  `notfacebook.com` maps to nothing: naming the wrong channel is worse than admitting we cannot tell.
  It also catches a link clicked somewhere we never posted it.
- **`click.bot`: 0 counted, 1 crawler, 2 unknown.** A platform fetches a url to build its preview
  card and every fetch hits the redirect — the first live post logged 18 "clicks" on one link in
  three minutes. The User-Agent is read to DECIDE and then discarded; only the flag is stored, so
  nothing personal is kept. **Only `bot = 0` is ever shown as a click.**
- **The show-notes loop did not converge**: `build()` regenerates the opening with a model every
  run, so an applied description never matches byte for byte and immediately re-proposed itself.
  `/youtube/pending` returns what was last WRITTEN as well as what is approved, and a video already
  carrying exactly that is skipped. The upsert's `WHERE state = 'proposed'` was hiding the churn at
  the database level while the work still happened every run.
- **TikTok and X take the CTA in the CAPTION, and `post.js` now actually does it.** The platform
  table declared `linkPlacement: 'caption'` from the start but nothing ever acted on it, so posts
  there went out with his words alone — no route to the sign-up page and nothing measurable.
  **They cannot share a request with the comment platforms** (one body, one caption), so publish()
  sends one request for the comment group and **one per caption-link platform** — they need
  different captions anyway, since each carries its own short code and X's tag cap is 1 against
  TikTok's none. His words stay first and untouched; link and tags are appended.
- **Do not claim the watcher will "pick up" TikTok or X.** It cannot — no comments API — and
  post.js used to print exactly that. Only platforms with `commentsApi: true` are ever reached.
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
- **`posts:list` is the whole universe now.** It carries a pipeline post the instant it publishes,
  where `analytics:posts` lags minutes behind. The watcher used to read both because
  `analytics:posts` was the only place app-authored posts appeared — that sweep went with the
  mirror, so a post made outside the pipeline is never commented on. That is deliberate: it is a
  one-off, handled by hand.
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

- **Everything publishes through the queue now (mate's call, 2026-08-20). The mirror is gone.**
  Restream clips are no longer used; content goes out from this pipeline only, so there is no
  second origin to reconcile against. Deleted with it: `scripts/mirror.js`, `scripts/lib/matcher.js`
  (caption dedupe), `scripts/lib/captions.js`, their tests and `test/fixtures/corpus.json`, plus
  `verifiable`/`mediaUrlAvailable`/`MIRROR_TARGETS` from the platform table. **Do not reintroduce a
  "is a copy already over there?" check** — it existed only because Restream put copies somewhere we
  could not see. A post made outside the pipeline is now a one-off, handled by hand.
- **`~/.local/state/mwk-social/mirror-ledger.json` still exists but has no writer.** Kept as history;
  nothing reads it. The `mirror-ledger` D1 snapshot was deleted so the dashboard cannot render a
  frozen table. **15 target-slots across 7 Facebook reels were left `pending`** when the mirror was
  retired — abandoned by the decision, not by a failure.
- **Media: `scripts/lib/media.js`.** `probe(file)` → duration/aspect/codec/audio; `check(platform,
  probe)` → an ARRAY of problem strings, empty when fine. Note the argument order and the return
  shape; I got both wrong first time. `run-queue.js` probes an uploaded clip once and drops any
  platform that would reject it, rather than letting the platform fail an already-claimed item.
  **The Instagram 1.91:1 rejection is an IMAGE rule, not a video one** — the video aspect range is
  inclusive at both ends, and applying the image edge there rejects a legitimate square reel.
- **Two yt-dlp traps, still true wherever it is used:** it **appends its own extension to `-o`**
  (ask for `x`, get `x.mp4`, read it as "downloaded nothing"), and it **serves AV1 by default** —
  force `[vcodec^=avc1]` because IG and TikTok want H.264.
- **Node's `fetch` cannot reach a Meta CDN from this box — and it looks exactly like an expired
  URL.** `ETIMEDOUT` at ~253 ms every time: no IPv6 route here, the AAAA record wins the lookup, and
  undici's Happy Eyeballs window is 250 ms so it never tries IPv4. Media downloads shell out to curl
  for this reason; if you must use fetch, `net.setDefaultAutoSelectFamilyAttemptTimeout(500)` fixes
  it (measured 4/4).
- **A publish call that times out has NOT necessarily failed.** The request aborts at the client and
  Zernio keeps processing, so a timeout is *unknown* — reconcile by searching `posts:list` for the
  caption just composed. The publish timeout is 240s and the queue claims an item **before** the
  request for this reason.
- **TikTok settings go in `tiktokSettings` at the TOP LEVEL of the request body, not
  `platformSpecificData`** (docs.zernio.com/platforms/tiktok). Getting it wrong is silent —
  `platformSpecificData` stores and echoes any key, so it would look accepted while the post went
  out with no consent flags. Six flags, all `required` with `default: false`: `allow_comment`,
  `allow_duet`, `allow_stitch`, `content_preview_confirmed`, `express_consent_given`, plus
  `privacy_level`. TikTok's live `maxVideoDurationSec` is **3600**, not the 600 the static table
  assumed — read `accounts:tiktok-creator-info`.
- **TikTok returns a publish token, not a video ID** (`v_pub_url~v2-1.…`); the real numeric ID
  arrives later with the analytics sync. It also returns **no post URL at all**.
- **X's $0.20 URL fee, confirmed a third time**: `xSpendCents` went 23 → 43 across one post
  carrying a link.

- **The YouTube description tail is written from `matewishkey.com/brand`**, which is the authority
  on how the show describes itself — not a paraphrase of it. Its rules are load-bearing and are
  recorded beside the text in `config/voice.json`: first person, the viewer as the subject, plain
  language, the host never an expert or teacher, never the words "free"/"guaranteed"/"safe", and
  never a claim that anyone became a developer. The `PENDING` gate that paused auto-fill is
  satisfied, so empty descriptions now get filled.
- **The dashboard is `web/`, deployed with `web/deploy.sh` (locally, never on push).** One Worker
  `mwk-social-log`, **three** custom domains — `social.matewishkey.com` (Cloudflare Access, email
  OTP, allowing mate@ and suzy@matewishkey.com), `ingest.matewishkey.com` (bearer token) and
  `mwkshow.com` (public short links, **no Access application, ever**). D1 database `mwk-social`,
  R2 bucket `mwk-social-media` for queued uploads. **`workers_dev = false` is the load-bearing
  line**: Access binds to a *hostname*, not to a script, so leaving it on would serve the whole
  dashboard ungated on `*.workers.dev` beside the gated one. The Worker verifies the
  `Cf-Access-Jwt-Assertion` itself — signature, `aud` **and** expiry; a signature alone would
  accept a token minted for a different app in the same Access org.
- **`internal.matewishkey.com` is gone** (2026-08-20), hostname and Access app both. The D1 and
  its whole event history were kept — only the names moved.
- **Access gates a HOSTNAME and runs in front of the Worker, so a public path beside the gated
  dashboard is impossible.** Measured: `/l/<code>` on `social.matewishkey.com` 302s to the Access
  login page before any Worker code runs. That is *why* short links have their own domain — it is
  not a stylistic choice, and a path-based shortener on the dashboard host cannot be made to work.
- **Short links: `mwkshow.com/<code>`, one code per (platform, post).** Registered 2026-08-20
  (~$10.46/yr, Cloudflare). Not a 3-letter domain on purpose — short names in new gTLDs are
  usually registry-premium. A click stores the code, the time and the referring host: **no IP, no
  user agent, no cookie**, which keeps a redirect out of consent territory. A miss redirects to
  `LINK_FALLBACK` rather than 404ing, because a link printed in a public comment must never
  dead-end. **Why it exists at all:** `clicks` comes back from Facebook (15/20 posts) and once
  from LinkedIn; Instagram, YouTube, TikTok, Threads and X return 0 on every post, structurally —
  so the first-comment mechanic had no scoreboard.
- **Changing the CTA host is a breaking change, and `config/voice.json` says so in its own notes.**
  The duplicate guard finds the CTA *in the comment text*, so a guard taught only the new host
  would fail to recognise every comment written before the change and re-comment on all of them.
  `markers[]` lists every substring that counts and `voice.carriesCta()` matches any; tests pin
  both the old and the new. Minting is **idempotent** (a re-run must render the identical comment)
  and **never fatal** (no dashboard → plain URL → the comment still goes out).
- **Snapshots over SQL projections, where the box already knows the answer.** `platforms`, `voice`
  and `pace` are computed on the box and shipped whole — the platform table and the pace are
  computed by the code that uses them, so rebuilding either in D1 would only add a way for the two
  to disagree. What IS a table: the queue, links, clicks, daily metrics and follower points, because
  those are written at the far end or must outlive Zernio's ~12-month window.
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
  repost from the personal account** — plainly, no commentary, which is the default since
  2026-08-21; a thought on top is optional and always his. Never native-post to personal. Goal: build company-page engagement/followers to unlock LinkedIn Live there.
- **Instagram**: business account required; media mandatory; caption folds at ~125 chars;
  no delete/edit via API. Image aspect must be 0.75–1.91:1 and an image at *exactly* 1.91:1
  gets rejected (float edge, bitten live) — pad wide screenshots to ~1.78:1 with the
  screenshot's own bg color instead of cropping. Tall grabs (phone/email screenshots) fall off the
  other end — pad up to 4:5 (0.8) the same way, don't crop.
- **TikTok**: `accounts:tiktok-creator-info <accountId> --mediaType <video|photo>` returns the
  live privacy options and posting limits — read it instead of guessing the cap. A manually posted TikTok was once
  verified arriving via the external-post sync — historic only: nothing reads that sweep now.
- **TikTok**: API posts have their own strict daily cap (separate from the app); consent flags
  required per post; no comments/DMs/FYP analytics via API; 9:16 video 3s–10min or carousels.
- **YouTube**: vertical <3min auto-classifies as a Short; Shorts get NO custom thumbnails
  (regular videos do); impressions/CTR exist only in Studio's UI, not in any API.
