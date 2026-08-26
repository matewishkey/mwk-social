# mwk-social — Zernio social-media integration

Agent notes for working in this repo. (This repo is public — keep this file free of account
IDs, billing details, and internal URLs; that state lives outside the repo.)

**What belongs here:** the things that cost a debugging session, and the ones that looked right
and were not. **What does not:** procedure a skill already carries, history git already holds, and
values a config file already states. When a rule turns out to be one a skill enforces, move it into
the skill and leave a pointer. Two copies of a rule is how one of them drifts.

## Setup

- CLI: `./node_modules/.bin/zernio` (`@zernio/cli`, local dev dependency; node pinned via `mise.toml`).
- Auth: the CLI reads `~/.zernio/config.json`, created by `zernio auth:login` (device flow);
  `ZERNIO_API_KEY` (+ optional `ZERNIO_API_URL`) overrides it — the way to run this headless/in CI.
- `zernio auth:check` verifies auth; `zernio accounts:health` verifies connections;
  `zernio accounts:list` is the source of truth for connected account IDs.
- zsh gotcha (bit twice): inline `node -e '...'` inside `$(...)` loses its closing paren —
  put the JS in a script file instead. **zsh only** — `scripts/*.sh` run under bash and use the
  inline form deliberately; don't "fix" them.

## Skills — read these before the sections below

Procedures live in `.claude/skills/`, not in this file. A skill loads when the work calls for it;
this file loads every session whether it is relevant or not.

- **`mwk-status`** — where the pipeline stands: unpushed work, the five timers, the queue and the
  pace, account health, what is waiting on mate. The sweep every restart starts with.
- **`mwk-post`** — his words or a clip to a queued post: the voice, the hashtag rule, the media
  checks, `scripts/queue-add.js`, and what will actually happen once it is in.
- **`mwk-image`** — a STILL rather than a clip: the two platforms that cannot take one, the file
  whose extension lies, padding instead of cropping, several stills as one post, and why the
  brand band is not ours to draw.

## How this works at all

- Multi-account publish in one `posts:create --accounts id1,id2,... --text ... --media <url>`
  (`--text`, not `--content`); `media:upload <file>` first, it returns the URL to pass.
  Per-platform results come back on the parent post's `platforms[]` — `posts:list --limit 1` and
  read `post.platforms[]`, nothing else exposes them.
- **Native first comment on publish**: `platforms[].platformSpecificData.firstComment` — Zernio
  posts it seconds after the post goes live. FB (feed + Reels, not Stories), IG, LinkedIn, YouTube
  (posted *and* pinned, 10k chars). **No TikTok.** Skipped on drafts. **The CLI has no flag for
  it**, same as `reshareUrl`, so `scripts/post.js` talks to `POST /v1/posts` directly.
- **Every `inbox:*` command wants the PLATFORM's native post ID** (`platforms[].platformPostId`).
  The Zernio `_id` 404s. `inbox:reply <postId> --accountId <acc> --message "..."` with NO
  `--commentId` posts a top-level comment.
- **Never pass a post ID to the CLI as a positional** — a YouTube video ID may start with `-`
  (`-Lf97N091NI`), which yargs reads as a flag: the command prints its help and the script sees a
  failure. There is no `--` escape that works. `scripts/lib/api.js` calls the REST route directly;
  verified against hyphenated YouTube IDs, LinkedIn `urn:li:share:…` and Facebook composite IDs.
  **This trap recurs anywhere a hyphenated id meets an arg parser** — it bit `studio design --name`
  on 2026-08-26 too.
- **`platformSpecificData` stores any key you send it**, invented ones included — so an echo in the
  create response proves storage, never support. Check the platform guide, don't infer.
- Pre-flight: `validate:post-length --text`, `validate:media --url`. **Neither checks image aspect
  ratio, and `validate:post` passes an Instagram post with no media at all** — so the two gotchas
  that have actually bitten are still on you. Check aspect with `identify` before upload.
- **`accounts:health` reporting `warning` is routine, not a fault** — Zernio refreshes tokens
  lazily, so an account passes through `warning` and returns to `healthy` on its own. **Alerting
  keys on `needsReconnect: true` or `status: error`**, never on `warning`.

## What we say, and where it lives

- **Everything we say out loud lives in `config/voice.json`** — CTA variants, identity and brand
  tags, per-platform hashtag caps, the blocklist, the YouTube show blurb, the feed URL.
  `scripts/lib/voice.js` is the only reader. It must contain `marker` (`matewishkey.com/show`) and
  every variant must contain `{show}`: the dedupe guard keys off that string, so a variant that
  dropped the url would have the watcher duplicate every natively-posted comment. `voice.js`
  refuses to load a config that breaks either rule.
- **Changing the CTA host is a breaking change.** The duplicate guard finds the CTA *in the comment
  text*, so a guard taught only the new host would re-comment on everything written before the
  change. `markers[]` lists every substring that counts; tests pin both old and new. Minting is
  **idempotent** and **never fatal** (no dashboard → plain URL → the comment still goes out).
- **`matewishkey.com/brand` IS the voice, it MOVES, and it renders `VOICE.md` at that repo's root —
  read it, never restate it.** Its rules are recorded beside the text in `config/voice.json`. Three
  that have bitten: the three-line headline is **one unit and is not split**; the exclamation mark
  on *yourself!* is load-bearing (a typo-cleanup flattened it within the hour); **no em dashes
  anywhere the site speaks**.
  - **The one disagreement is SETTLED in the blurb's favour**: the page says *"I, never we"*, the
    blurb says "we build it". Mate, 2026-08-24: *"For sure keeping we here is great."* That "we" is
    him and the guest. **Do not raise it again** — it reads like a fresh finding every time
    somebody re-reads the brand page.
- **SHORT IS THE HOUSE STYLE** (mate, 2026-08-24: *"Keep the text simple short and concise, so we
  will not do AI issues"*). The description went 819 characters to 347. His reasoning: length is
  what reads as machine-written, so a long correct paragraph loses to a short one.
- **An episode is named after WHAT THE PERSON GOT, never after a hook** — *"Three thousand of the
  right people to call"*, *"A website for her practice"*, then a plain sentence of fact. The
  episodes page is the reference. A question headline invites; an instruction orders. Hooks
  ("Did the AI really fix it?") are the failure mode, and mate has called it out as marketing.
- **"NO TERMINAL NEEDED" WAS FALSE AND WAS LIVE ON 23 VIDEOS.** The brand page describes the
  AUDIENCE as someone who *"has never opened a terminal"* — that is who turns up, not a promise
  about what the session needs. A test fails if the word returns to anything we say out loud.
  **Reassurance is where a false claim hides**: check it against what happens on the show, not
  against how kind it sounds.
- **The first comment rotates**, deterministically from the post key — a re-run renders the
  identical comment while consecutive posts differ. `avoidIndex` is the belt-and-braces on top, and
  **both paths use it now** (`post.js` and `first-comment.js` share `comment-state.js`); a dry run
  must not move the rotation on. Roughly `episodeMixRatio` of comments quote a real guest wish from
  the RSS feed. **Freshness must never block a comment** — an unreachable feed falls back to a
  plain variant.
- **AN EPISODE IS A GUEST SHOW; A LIVE STREAM IS NOT ONE, AND THE `/episodes/` FILTER IS WHAT KEEPS
  THAT TRUE IN CODE.** `latestEpisodes()` drops any feed item whose link does not match
  `/\/episodes\//` (`voice.js`), which is the whole reason the `firstComment.episode` variants can
  say *"that's what someone brought to the show"* without checking anything else. Widen that filter
  and a solo stream starts being quoted as a guest's wish. Mate, 2026-08-21: *"there are no episodes
  about this, it was live on youtube, uncut version is visible."*

## Hashtags

**The rule and how to apply it live in the `mwk-post` skill.** The one-line version, because it is
absolute: **would someone who does NOT work in technology already know this word and use it
themselves?** If they would look it up, it is wrong (mate, 2026-08-21). Backtested: 79% of tags we
had already published were jargon the rule rejects.

- **A product name is fine when ordinary people know the product.** #Xero, #Canva, #Dropbox yes;
  #Cloudflare, #GitHub, #Docker no. That distinction is the rule, not an exception to it.
- **Fewer good tags beat more weak ones, and none is an acceptable answer.**
- The prompt in `topic-tags.js` is the primary defence; `blocked` in `voice.json` is the hard
  backstop. The backstop caught 1 of 45 on the rerun — it is what stops a bad day going out.
- **Tags chosen for WHO they reach are allowed on a manual post** (mate, 2026-08-20), reversing the
  subject-matter-only rule. Evidence worth not re-deriving: `#NoCode` reaches the supply side, not
  the buyer; `#LearnAI` reaches the already-using-AI crowd; `#SmallBusiness` runs ~1,800 posts/hour
  against `#SmallBusinessOwner`'s ~362. Instagram's own head says hashtags feed SEARCH, not reach —
  so the words in the caption matter more than the tag list.
- **Tags go in the caption OR the comment, never both** (`noTags`). On Instagram both would spend
  the 5-cap twice — a defensive choice, not a rule Instagram states.
- **Instagram's 5-cap is Instagram's; "caption AND comments together" is not** (corrected
  2026-08-24 — that claim traces to marketing blogs). We keep the behaviour and drop the certainty.
  IG's own search guidance says keywords must be in the CAPTION to be searchable, so tags in a
  first comment may buy nothing there at all.

## Transcripts and topic tags

- **`RULES_VERSION` in `topic-tags.js` is what makes a tag-rule change take effect.** The cache is
  per post and returned a hit unconditionally, so a rule rework would have changed **nothing** for
  any already-processed video. A hit now only counts if `cached.rules === RULES_VERSION`; a bump
  re-derives from the **stored transcript** — one model call, no re-transcription. **Bump it when
  the RULE changes, never when the code does.**
- **Anything already drafted from a cached result is stale too.** 16 dashboard proposals carried
  the old tags after the fix; approving one would have published exactly what had just been
  corrected. **After any voice or tag change, check what is already queued for approval.**
- **Cache the transcript, and process promptly**: Zernio's media URLs are signed and expire, so a
  reel not fetched soon after the sync can never be transcribed. Cached per post in
  `~/.local/state/mwk-social/topics/` — transcription costs money.
- **YouTube needs a different transcript source**: `analytics:posts` returns a video mediaItem with
  an **empty url**, so there is nothing to download. `yt-dlp --write-auto-subs` covers the whole
  video rather than the first 15 minutes of audio. `--download-sections` segfaults this box's
  ffmpeg build. Auto-captions take hours on a long stream, so an uncaptioned video is deferred
  (`MWK_CAPTION_GRACE_HOURS`, default 24).
- **Two yt-dlp traps, wherever it is used:** it **appends its own extension to `-o`** (ask for `x`,
  get `x.mp4`, read it as "downloaded nothing"), and it **serves AV1 by default** — force
  `[vcodec^=avc1]`.
- **Keys come from `~/.secrets`, which is why every systemd unit runs through
  `scripts/with-secrets.sh`** — systemd's `EnvironmentFile` cannot parse shell syntax, and neither
  `~/.secrets` nor the sops-encrypted project env is readable without a shell. No keys → plain CTA,
  never a failed comment.

## Links, and where a url actually works

- **A URL IS NOT CLICKABLE EVERYWHERE, and for three weeks this pipeline acted as though it was**
  (2026-08-22, on mate's instinct). Instagram makes NOTHING clickable — not a caption, not a
  comment, not a Reel. TikTok the same. **YouTube deliberately renders urls in SHORTS descriptions
  and comments as plain text**; long-form is fine. Measured damage: five TikTok and five Instagram
  codes took **0 and 1** human clicks, which reads as "nobody cared" rather than "nobody could".
- **`linkClickable` is the fact; `linkPlacement` is the decision, and `platforms.linkProblems()`
  refuses to let them disagree.** A test asserts it returns empty.
- **`linkPlacement: 'profile'` means: say where the link is, mint nothing.** Instagram and TikTok.
  `{show}` renders as `voice.profileCta(platform)`, and any variant carrying a url is dropped from
  the pool — that url is exactly as dead. **Every phrasing MUST be in `markers[]`** or the guard
  cannot recognise its own comment and re-comments for ever. `profileCtaBy.youtube` says "channel
  page" because under a Short the clickable thing is the CHANNEL, not a bio.
- **`commentWatched()` is not `linkPlacement === 'comment'`** — it is `commentsApi === true &&
  !['caption','reply'].includes(linkPlacement)`. Instagram is `'profile'` and IS watched, because
  its CTA is still a comment. X has a comments API and is NOT watched, because its CTA ships inside
  the post. post.js printed "the watcher adds it" about a platform it cannot reach **twice**, so it
  is derived from one function now and a test pins `first-comment.js`'s `ALL_PLATFORMS` to exactly
  that set.
- **Every link carries a campaign, and it is part of the MINT KEY** (`campaign`, `medium`,
  `created_by`, `note`). Same destination from a bio and from a reply = two codes, or "which one
  earned this" has no answer. `medium` is the *placement*, `platform` is the source.
- **`clip_id` was declared and never written — 0 of 55 links carried one.** Every mint now carries
  the queue item id, so **click → `link.clip_id` → `queue_item.media_key`** is one join. A test
  reads `post.js` and fails if any `linkFor()` call omits its medium.
- **A code is bound by PURPOSE, not by destination.** `target` is part of the mint key, so a code
  identified only by where it points stops being findable the moment it is repointed, and the next
  mint quietly makes a second one. Bind anything whose destination can move
  (`manual:pretalk-public`).
  - **The repoint is proven, not theoretical**: both booking calendars were replaced and repointed
    in one `UPDATE`, and the website was never touched.
- **A PROFILE LINK NAMES ITS ACCOUNT, OR IT IS USELESS.** With three LinkedIn accounts and Facebook
  posting only to Pages, `linkedin bio` answers nothing. Every bio code carries
  `post_key = 'account:<zernio id>'` (resolve from `accounts:list`, never type one, never commit
  one) or `manual:<slug>` where the pipeline has no account. **`postKey` is part of the mint key**,
  so minting without it creates a *second* code for the same profile.
- **A SHORT GETS A CODE SOMEBODY CAN TYPE — `mwkshow.com/s5`.** Nobody can click a url under a
  Short, so the only route is reading it off screen and typing it, and `mwkshow.com/8x2kq` is not a
  thing anyone types. `mint({ codePrefix: 's' })` allocates base 10 (base32 mixes confusable
  characters). **A low number on one of these is neither indifference nor unreachability — it is
  how many people cared enough to type it.**
  - **`codePrefix` NARROWS the attribute dedupe rather than sitting under it.** Every Short already
    owned an episode code, so a plain attribute match handed all thirteen straight back. The old
    code is untouched — never reused, still resolving, same `clip_id`.
  - **A clip can legitimately own two codes, so the lookup is `ORDER BY created_at`.** `.first()`
    over an unordered pair flips the rendered description every sync and re-proposes for ever.
- **A PERSONAL SHARE IS A NAME ON THE END OF ANY LINK — `mwkshow.com/mmm/natalie`.** One code
  serves everybody; the name is a word HE types, stored on the CLICK as `tag`. **A code he has to
  copy from somewhere is a code he will not use from a phone**, which is why `mint()` takes a
  chosen code now — and a chosen code SKIPS the attribute dedupe (he asked for `mmm`, so he gets
  `mmm` or an error, never somebody else's).
  - **`decodeURIComponent` BEFORE normalising**, then fold accents to ASCII, or `Ödön` stores as
    `c3-96d-c3-b6n`. Found by curling the live redirect with a real name; an ASCII test passes.
  - **It says the link labelled natalie was opened, NOT that Natalie opened it.** Links get
    forwarded. Do not let a summary quietly upgrade it.
- **`click.bot`: 0 counted, 1 crawler, 2 unknown.** A platform fetches a url to build its preview
  card — the first live post logged 18 "clicks" in three minutes. The User-Agent is read to DECIDE
  and then discarded. **Only `bot = 0` is ever shown.**
- **A click is attributed platform-first, referer-second, then unattributed.** Referer matching is
  **anchored**, so `notfacebook.com` maps to nothing: naming the wrong channel is worse than
  admitting we cannot tell.
- **The redirect hands NOTHING to the destination — no `utm_`, no cookie, no banner** (mate,
  2026-08-22: keep it slim). The code already carries platform, placement and campaign, so a utm
  would count the same click twice in somebody else's system. A test fails if one is added back.
- **A BIO LINK CAN BE VERIFIED ON EXACTLY TWO PROFILES, and the check found a real miss**
  (2026-08-26). YouTube's channel page carries the website field in
  `channelExternalLinkViewModel` and LinkedIn's company page renders it behind `trk=about_website`
  — both readable from this box with plain curl. X reads out of the fxtwitter user object. The
  other seven profiles render no website field to a logged-out fetch at all, so a miss there is
  unknowable, never "not done".
  - **The positive control is the FIELD, not the code**: if the selector finds no field, the read
    proved nothing. `linkedin.com/company/<slug>/about/` renders no field while
    `linkedin.com/company/<slug>/` does — the more specific URL is the one that answers nothing.
  - He updates these by hand, so **when he says a bio is done, read it** rather than believing it.
    Two of the ten were still on the plain url after he said they were updated.
- **`/links` on the dashboard can mint by hand.** Anything he pastes himself — a bio, a newsletter,
  a talk — was a raw url and invisible before that. The `campaign = bio` codes are the whole
  conversion path on Instagram and TikTok.
  - **Measured 2026-08-26: 3 of 10 bio codes have a click** (his personal Facebook 3, Instagram 2,
    X 1). A click proves the link is live; **a zero proves nothing** — not pasted and pasted-but-
    unclicked look identical.

## YouTube descriptions

- **The tail is written from `matewishkey.com/brand`** — not a paraphrase of it. First person, the
  viewer as the subject, plain language, the host never an expert or teacher, never
  "free"/"guaranteed"/"safe", never a claim that anyone became a developer.
- **The show notes narrated his own show in the THIRD PERSON, and the prompt was why** (2026-08-25).
  One of its rules read *"The host teaches rather than doing it for the guest"* — that handed the
  model the phrase, and nothing asked for first person. It now demands first person, bans the
  phrase, requires the guest to be **named** rather than labelled, and says **the transcript wins
  over the title**.
  - That last rule exists because a left-over stream title put a guest in a video he is not in:
    `_6zckinR5VI` is titled "Istvan David: Exploring Light" and its notes credited Istvan with
    mate's own projects. 1,368 words of transcript, no mention of him.
- **`--repropose <id…>` is how a voice change reaches what is already written.** `sync()` cannot:
  a recognisably-ours description takes the swap path, which is right for a stale tail and useless
  for a wrong opening. It files proposals and never writes.
- **UNCHANGED IS NOT THE SAME AS CURRENT.** The loop skipped on "matches what we last wrote" before
  `build()` was reached, so no change to the constant tail could land on a video that already had
  one — a change would have reached **2 videos out of 23**. **The tail itself is the honest test**:
  if the text carries it, we wrote it, whichever route it took. Same disease `RULES_VERSION` cures,
  in a second place — when adding anything to the constant part of a generated artefact, ask how it
  reaches the ones already written.
- **A stale tail is SWAPPED, never rebuilt.** `build()` regenerates the opening with a model, so a
  rebuild hands him rewritten summaries to re-approve — words he already said yes to. Two tests pin
  that the plain and tracked blurbs differ on exactly ONE line, or the "one-line change" the
  dashboard shows him is a lie.
- **`voice.findBlurb()` recognises our tail whatever went into its link slot**, by matching the
  constant halves either side of `{show}`. Two silent failures it now handles:
  - **A blurb ending with `{show}`** leaves no constant text after the slot, and `indexOf('')`
    answers with the slot's own start — the swap would strand the old url. The slot runs to the end
    of ITS LINE.
  - **LONGEST WINS.** Today's blurb and the one it retired share every word before the slot, so the
    newer matches a strict prefix of the older; first-match-wins left the orphaned line underneath
    — the exact line the change existed to delete, surviving the change.
- **EDITING THE BLURB'S PROSE RETIRES IT — push the old text to `showBlurbPast` or every video gets
  rebuilt.** The wording *around* the slot is part of the key. Nothing is ever deleted from that
  list; a video written a year ago still carries the blurb of its day.
- **A VIDEO YOUTUBE NEVER CAPTIONS FAILED EVERY RUN, FOR EVER, AND NOBODY WAS TOLD.** `build()`
  needs a transcript, so three videos failed silently — one for 131 hours. Past the grace the tail
  is proposed on its own (`kind: 'append'`, his words kept whole, no topic tags). **Only the
  missing-transcript message is recovered** — a model error or failed mint still throws, or every
  real fault becomes a quietly degraded description.
  - **Age comes from `%(timestamp)s`, and yt-dlp prints the literal string `NA`.** `Number('NA')`
    is NaN and NaN compares false against the grace, so an unguarded read takes the impatient
    branch on every video lacking a timestamp. `null` means wait.
- **A `kind` THE BOX FILES AND THE DOOR DOES NOT KNOW IS SILENTLY NULL.** `propose()` dropped
  `append` to NULL and the dashboard fell back to guessing from the diff, which calls an append a
  rewrite. `PROPOSAL_KINDS` now, and a test reads the kinds out of `yt-description.js` and fails if
  `api.js` would drop one.
- **NO SECOND ADDRESS, AND NEVER ANOTHER PLATFORM** (mate, 2026-08-25: *"why we are promoting
  twitch on the youtube 'live' at all"*). Half the line aimed at the platform the reader is already
  on, the other half at a competitor — and on a Short it printed two urls beneath a CTA that had
  been DENIED a url. A test walks every tail shape and fails on a second url or the word twitch.
- **THE YOUTUBE DESCRIPTION IS THE BIGGEST CLICK SOURCE WE HAVE — 37 of 90 human clicks**
  (measured 2026-08-25). Nothing else is close. A video sitting without the blurb is the best
  channel we have, switched off for that episode.
- **The show-notes loop did not converge** until `/youtube/pending` returned what was last WRITTEN
  as well as what is approved: `build()` regenerates the opening every run, so an applied
  description never matches byte for byte and re-proposed itself.

## Thumbnails

- **A custom thumbnail CAN be pushed to an already-published video, and Zernio's docs say it
  cannot** (verified live 2026-08-25). `POST /posts/_/update-metadata` with `thumbnailUrl` works.
  The API's `updatedFields` echo proves nothing on its own — it was checked at YouTube's end, where
  the served `maxresdefault.jpg` changed bytes.
  - **Round-tripping a video's OWN current thumbnail is the safe positive control**: the byte
    change proves the write, the picture never moves.
  - **Shorts cannot take one** — 14 of 28 videos. YouTube and Zernio agree; not write-tested,
    because the only harmless test would be a visible change if it landed.
- **YouTube's own spec** (not a blog): 3840×2160 recommended now, min width 640, 16:9, JPG or PNG,
  2 MB mobile / 50 MB desktop — but **Zernio's own 2 MB cap is what binds us**. The account must be
  verified, and ours is. **YouTube publishes no safe-zone guidance at all**; the "1100×620" and
  "bottom-right 15%" figures circulating are blog claims. What IS observable: the duration badge
  sits over the bottom-right, so branding does not go there.
- **A/B testing thumbnails has no API and would not conclude here.** Test & Compare is Studio-only,
  excludes Shorts, and a variant wants 1,000–5,000 impressions to settle — our best long-form video
  has 95 views lifetime. Do not re-research until a video clears four figures.
- **Image work moved to the CMS** (mate, 2026-08-26). Do not rebuild card generation here.

## The platform table — wire it or do not add it

**Five fields have shipped declared-and-never-read**: `linkPlacement`, `landscapeOk`,
`hashtagsInCaption`, `shortsAreDead`, `captionMax` — all wired now. (`verifiable` and
`mediaUrlAvailable` were on this list too and no longer exist at all; they went with the mirror.)
The config page renders every field, which makes an unread one look implemented. This is the single
most repeated failure in this repo.

- **`hashtagsInCaption`** was decorative from the beginning, so LinkedIn, Facebook and YouTube
  posted with no hashtags at all until 2026-08-21.
- **`shortsAreDead`** — a link can be dead for one CLIP and live for another.
  `platforms.linkDeadFor(name, probe)` decides it; `run-queue.js` computes the list per post.
- **`captionMax`** became load-bearing the day X's link joined his words. `captionForPlatform()`
  gives up **the tags first, then the link, and his words never** — if his words alone do not fit,
  the platform is dropped with a reason rather than truncated. **X counts every url as 23
  characters** however long it is. Composition is caught per account: a throw there is before the
  requests, so one over-long post would otherwise take every platform with it.
- **`imageOk`** says who can take a still at all — FB, IG, LinkedIn, Threads, X; **not YouTube**
  (nothing to post it *as*) and **not TikTok** (photo posts exist in its API since 4 Aug 2026 and
  we have never built one, so it is "not built", not "impossible" — **and mate declined building
  them, 2026-08-26 closing #27**, so "not built" is the decision, not a gap). `imageAspectRange` is not
  `aspectRange` — IG video tops out at square while its images run to 1.91:1. Procedure: `mwk-image`.
- **`landscapeOk`** routes the two cuts. **One video per post, on every platform** — a vertical and
  a landscape cut are two posts, never one. `queue_item.media_wide_key` carries the second.
- **A GALLERY IS SEVERAL STILLS IN ONE POST, AND IT IS THE OPPOSITE OF THE TWO CUTS** (2026-08-27).
  `media_wide_key` is *the other video*; `queue_item.media_extra` (JSON array of R2 keys) rides
  **with** `media_key` in a single post. `queue-add.js --media` takes a comma-separated list, the
  first being the post's media. **Stills only** — one video per post is the hard limit above, so
  `platforms.galleryFor()` collapses a set with any non-image in it back to one item rather than
  half-publishing a mixed post. Verified live on the first use: 3 `mediaItems` on facebook+linkedin,
  instagram+threads and twitter alike.
  - **`imageMax` is the cap and `galleryFor()` is its ONLY reader** — the field and its reader
    landed in the same commit deliberately. LinkedIn 20, Facebook 10, Instagram 10, Threads 10,
    **X 4** (Zernio's own platform pages, 2026-08-27). `galleryProblems()` asserts the table agrees
    with itself, the way `linkProblems()` does.
  - **GROUP ON THE WHOLE SET, NEVER THE FIRST FILE.** Keying the publish groups on `set[0]` is the
    natural way to write it and is wrong: X and LinkedIn share a first image and have caps of 4 and
    20, so X would be handed twenty. A test fails if the key stops covering every file.
  - **CHECK EVERY IMAGE, NOT JUST THE CUT.** `check()` ran on the cut alone, which was right while a
    post carried one file and became a hole the moment a second could ride along — an image outside
    a platform's aspect range would reach Zernio unchecked with the item already claimed. A platform
    is dropped whole and told which file; **never quietly sent a shortened gallery**, because a
    silent 5-of-6 reads as success.
  - **Instagram forces ONE aspect across a carousel**, so a set of mixed shapes gets cropped by
    Instagram itself. Pad them all to a common ratio before queueing — the padding rule in
    `mwk-image` applies to the SET, not just to each file passing on its own.
- **A CAPTION IS COMPOSED PER PLATFORM, and `publish()` groups by the caption a platform gets** —
  not by any fixed split. His words never vary; the link and the hashtags do.
- **`linkPlacement: 'caption'` IS live, on X, and this line said the opposite for two days.** It
  was true while TikTok's CTA sat in the caption and TikTok moved to the profile; then X's link
  joined his words on 2026-08-24 (`platforms.js`, the `twitter` entry) and nobody came back here.
  `linkInCaption()` runs on every X post — `post.js` composes the caption link and groups the
  accounts by it. **Read the table, never this file, for which slot a platform uses**: the note is
  a copy and the copy is what drifted.

## Publishing and the queue

- **The queue is OURS, not Zernio's** (reviewed 2026-08-21). Zernio's `/v1/queue/*` is a recurring
  timetable per profile; ours is a rate limit across accounts spanning two profiles. The full
  reasoning, and why the publisher cannot move into the Worker (ffprobe, ffmpeg and Whisper are
  binaries), is in `docs/playbook.md` — read it before proposing either again.
- **"Post it" means QUEUE it. Only publish when he says publish** (mate, 2026-08-21). The procedure
  is the `mwk-post` skill's opening section — read it there, this is the decision only.
- **There is no time-of-day posting window** (mate, 2026-08-21) — the audience spans timezones, so
  holding for a "good hour" only delays. `lib/pace.js` caps the day and spaces posts ninety minutes
  apart; the day boundary is the audience's timezone, or the cap resets twelve hours early.
- **An item that has put ANYTHING live is never queued again** (learned expensively). A throw in
  one publish group used to unwind the run and requeue the item: X's media upload failed at 99%
  after five platforms had published, and the next tick reposted everything, three times over.
  Each group is caught where it happens and `verdict()` returns `posted` with the failures named.
  **A retry after a partial publish is a human's decision, not the code's.**
- **A publish call that times out has NOT necessarily failed.** The request aborts at the client and
  Zernio keeps processing, so a timeout is *unknown* — reconcile by searching `posts:list` for the
  caption just composed. The publish timeout is 240s and the queue claims an item **before** the
  request for this reason.
- **`--no-first-comment` used to hold for about an hour** — post.js sent none, then the watcher
  found a published post with no CTA and posted one. `comment-state.js` is shared by both:
  `run-queue.js` writes a suppression entry keyed `<platform>:<native post id>`. **It never
  overwrites an existing entry**, or a post really commented on would be rewritten to look as
  though it never was.
- **Media: `scripts/lib/media.js`.** `probe(file)` → duration/aspect/codec/audio; `check(platform,
  probe)` → an ARRAY of problem strings, empty when fine. Note the argument order and return shape.
  `run-queue.js` probes once and drops any platform that would reject it, rather than letting the
  platform fail an already-claimed item.
- **`zernio media:upload` infers the content type from the FILE EXTENSION** and rejects a file
  without one. The download cache names files from a hash, so the extension has to be put back.
- **X refuses a non-AAC audio track, and only at 99% of the upload.** Opus in an MP4 is legal and
  every other platform published the same file. It gets in through yt-dlp: constrain the video codec
  and leave `+ba` free and you get YouTube's best audio, which is Opus. `check('twitter', …)`
  refuses it up front, before the bytes are paid for.
- **TikTok settings go in `tiktokSettings` at the TOP LEVEL**, not `platformSpecificData` — getting
  it wrong is silent, because `platformSpecificData` echoes any key. Six flags, all required,
  all defaulting false. TikTok's live `maxVideoDurationSec` is **3600**, not the 600 the static
  table assumed — read `accounts:tiktok-creator-info`.
- **TikTok returns a publish token, not a video ID**; the numeric ID arrives with the analytics
  sync, and it returns **no post URL at all**.
- **TikTok has NO delete API.** TikTok and Instagram are both manual-only for deletion; everything
  else deletes through `posts:unpublish <id> --platform <p>`. Image swap on a published post =
  unpublish + recreate (`posts:edit` is text-only).
- **Everything publishes through the queue; the mirror is gone** (mate, 2026-08-20). **Do not
  reintroduce a "is a copy already over there?" check** — it existed only because Restream put
  copies somewhere we could not see. A post made outside the pipeline is a one-off, handled by hand.
- **`posts:list` is the whole universe now** — it carries a pipeline post the instant it publishes,
  where `analytics:posts` lags minutes behind.

## LinkedIn reshares

- **A LinkedIn account other than the company page is NEVER posted to natively** — `run-queue.js`
  filters them out. They only ever repost what the company page published. **This is the process
  and mate is happy with it** (2026-08-26), the company page's low reach notwithstanding.
- **"Adding an account is a connection job, never a code change" WAS WRONG.**
  `linkedinAccounts().personal` was `find` where it needed `filter`, so a third account connected
  on 2026-08-22 was invisible to the whole pipeline. No error, one fewer repost than anybody
  expected. `personal` is a LIST and a test fails if it goes back to `find`.
- **The reposts carried no CTA and no code at all** until 2026-08-24 — the company page (2
  followers) got the tracked comment and the personals (7,192 between them) got a bare repost.
  `reshareComment()` composes one **per account** and `quoteReshare` puts it in
  `platformSpecificData.firstComment`. Failing to compose one never costs the repost.
- **The two personal reshares are STAGGERED, four hours apart** (mate, 2026-08-22). Two accounts
  reposting in the same minute reads as one person running two accounts. Zernio holds the
  `scheduledFor`, so nothing stays running on this box. `MWK_RESHARE_LAG_MINUTES` overrides 240.
- **Each reshare is caught for itself, and the lookup is caught too.** One account's 422 must not
  cost the others, and none of it may turn an already-published post into a failed one.
- **A repost with no commentary needs `content` OMITTED, not empty.** `queue_item.reshare` is a
  separate flag from `reshare_text` for exactly this.

## The dashboard

- **`web/`, deployed with `web/deploy.sh` locally, never on push.** One Worker `mwk-social-log`,
  **three** custom domains — `social.matewishkey.com` (Cloudflare Access, email OTP),
  `ingest.matewishkey.com` (bearer token) and `mwkshow.com` (public short links, **no Access
  application, ever**). D1 `mwk-social`, R2 `mwk-social-media`.
- **`workers_dev = false` is load-bearing**: Access binds to a *hostname*, not a script, so leaving
  it on would serve the whole dashboard ungated on `*.workers.dev`. The Worker verifies the
  `Cf-Access-Jwt-Assertion` itself — signature, `aud` **and** expiry; a signature alone accepts a
  token minted for a different app in the same Access org.
- **Access gates a HOSTNAME and runs in front of the Worker, so a public path beside the gated
  dashboard is impossible.** Measured: `/l/<code>` on the dashboard host 302s to the Access login
  before any Worker code runs. That is *why* short links have their own domain.
- **Short links: `mwkshow.com/<code>`.** A click stores the code, the time and the referring host:
  **no IP, no user agent, no cookie**, which keeps a redirect out of consent territory. A miss
  redirects to `LINK_FALLBACK` rather than 404ing — a link printed in a public comment must never
  dead-end. **Why it exists:** `clicks` comes back from Facebook and once from LinkedIn; the other
  five return 0 structurally, so the first-comment mechanic had no scoreboard.
- **Snapshots over SQL projections, where the box already knows the answer.** `platforms`, `voice`
  and `pace` are computed on the box and shipped whole — rebuilding them in D1 would only add a way
  for the two to disagree. What IS a table: the queue, links, clicks, daily metrics and follower
  points, because those are written at the far end or must outlive Zernio's ~12-month window.
- **`ship-events.js` every 2 min; the cursor advances only on a 2xx**, and replays are free
  (`INSERT OR IGNORE` on a stable ULID). It sends an **empty batch when idle** — without that
  heartbeat "nothing happened" and "the box is off" are the same picture.
- **The heartbeat's period must stay UNDER the dashboard's stale threshold** — 10 minutes against
  15. They were both 15, so the beat always landed just after the page had given up. Two constants
  in two runtimes that only make sense as a pair.
- **`MWK_LOG_TOKEN` / `MWK_LOG_URL` live in `td-sops/apps/mwk-social.enc.env`.**

## Numbers that would otherwise lie

**The reasoning lives in the header of `web/src/pages/stats.js` — read it there, do not restate it.**
The invariants:

- **"Seen" is three different measurements.** Ours report reach (facebook, instagram, linkedin),
  views (youtube, tiktok) or impressions (twitter). A percentage built on them cannot be ranked
  across channels, so every row names its own denominator inline.
- **On Instagram and Threads, `views` and `impressions` are literally the same number** — measured,
  990 against 990 and 53 against 53.
- **A VIEW IS NOT A VIEW: YouTube changed the unit on 24 August 2026** — counted the moment
  playback begins, where long-form previously needed watch time. A views trend crossing that date
  is refused with a reason rather than drawn (`viewsUnitBlocked`), the same way a channel younger
  than the window gets its start date.
- **The site-wide engagement rate was overstating us by half and is gone.** It counted actions from
  seven channels over a denominator covering three: 5.5% against a same-set 3.8%. Replaced by
  **actions per post**, which divides two numbers meaning the same thing everywhere — and it
  immediately said what the old one hid.
- **Comparable across channels: posts, actions, actions per post, tracked clicks.** Not comparable:
  seen, and any rate built on it. Kept because they are what we have, never ranked.
- **The settle curve is being RECORDED and read by nothing, on purpose, from 2026-08-26.**
  `daily_metric` is upserted, and the upsert overwrote the numbers and `updated_at` together, so
  "is the last complete day settled?" had no answer and the trend excluded today on instinct. A
  `BEFORE UPDATE` trigger now keeps the superseded value in `daily_metric_revision`, with both
  timestamps — the gap between them is the lag. **This is the one deliberate exception to "wire it
  or do not add it": it is evidence being gathered, not a field somebody forgot.** Around
  2026-09-09 there is enough to set the exclusion from data, or to drop a trend that cannot stand up.
- **Trend guards, each with a positive control**: today is in neither window; a channel younger than
  the older window gets its start date (`platformSince` is queried over the WHOLE table, not the
  rendered thirty days); **connecting an account is not growth** — the follower total counts only
  accounts present at BOTH ends, and the ones left out are named.

## Traps that cost a session

- **Node's `fetch` cannot reach a Meta CDN from this box — and it looks exactly like an expired
  URL.** `ETIMEDOUT` at ~253 ms: no IPv6 route here, the AAAA record wins, and undici's Happy
  Eyeballs window is 250 ms so it never tries IPv4. Media downloads shell out to curl. If you must
  use fetch, `net.setDefaultAutoSelectFamilyAttemptTimeout(500)`.
- **The same trap bites the dashboard hostnames** — use `curl -4` when testing by hand.
- **A comment read for a video the account doesn't own returns `success` with an EMPTY LIST**, not
  an error. So "no comments" never proves "not yet commented".
- **YouTube blocks comments on private videos** — 403, and `firstComment` silently never lands.
  Unlisted is fine. The watcher treats a 403 as permanent.
- **Report every time to him in BRISBANE time** (mate, 2026-08-21). The box stays on `Etc/UTC` and
  that is correct — so `systemctl`, `journalctl` and every log stamp are UTC, and quoting one
  verbatim is ten hours wrong to him. `TZ=Australia/Brisbane date '+%H:%M %Z'`. The dashboard
  already renders Brisbane. AEST is UTC+10 year round.

## Not used, and why

- **Webhooks** would replace the hourly poll, but need a public HTTPS endpoint and detection still
  waits on the same ~90 min sync — the only gain is fewer API calls.
- **Comment-to-DM on Instagram** is verified working (`zernio automations:*`; `GET
  /v1/comment-automations` answered on this account) and is the only clickable route out of
  Instagram — but it is **per post**, so `automations:create` needs `--platformPostId`,
  `--accountId`, `--profileId`, `--name` and `--dmMessage` after every IG publish, not one setup.
  **Declined by mate on 2026-08-26**; his reasoning is in memory, and the mechanics above are the
  only part that belongs here. Do not re-propose without a change on Instagram's side.
- **Sending a STILL where a clip would go is declined** (mate, 2026-08-26, closing #27: *"no
  posting photos is fine, so do not do it"*). Two separate proposals died with it: swapping the
  LinkedIn clip for the branded still, and building TikTok photo posts. The finding underneath the
  first is still true and is not a reason to re-propose — LinkedIn video came last on impressions in
  both large 2026 studies and it is the only format we send there. **`imageOk` and the aspect checks
  stay wired** for a still HE hands us; what is declined is the pipeline choosing one.
- **Stories**: postable via API but they get no stickers/links/music (Meta limit) — post manually.
  An Instagram story shared onward to Facebook has no API analytics on the Facebook side.
- **Native/past posts**: `analytics:posts --source external` picks up app-made posts on a ~90 min
  sync. Nothing reads that sweep now — a post made outside the pipeline is handled by hand.

## X: follows only

- **The reply pipeline is GONE, and this note stops it being rebuilt** (mate, 2026-08-23: *"Stop
  the reply idea on X, just follow ppl... keep it simple"*). Two reasons, both still true:
  **X blocked programmatic replies on 23 Feb 2026** on every plan below Enterprise (self-replies
  are exempt, which is the only reason our own thread CTA ever published); and **the supply was
  never there** — 168 tweets read across three live runs, **0 on target**.
- **MORE FOLLOWS IS NOT THE LEVER — settled, do not re-research** (mate: *"lock in, right now we
  are good with x"*). 118 follows produced at most 8 followers. **The 500-following / 0.6-ratio
  cliff everyone warns about is DEAD** — `tweepcred` returns 0 hits in the January 2026
  `xai-org/x-algorithm` release (positive control on the same search: `phoenix` 102, `follower` 96).
- **`config/follow.json` is what survived** — 72 handles from 937 authors, ~5% yield. Nothing reads
  it; it is the record so the next sweep does not re-derive the same names. People, never brands.
- **X: THE LINK IS IN THE TWEET** (mate, 2026-08-24). It rode in a thread reply before that. The
  deciding reason: `home-mixer/filters/oon_retweet_reply_filter.rs` partitions out an
  out-of-network reply, so the CTA was only ever *surfaced* to existing followers. **Say that
  precisely** — the reply stayed readable to anyone who opened the root tweet; what it could not do
  is reach a non-follower as a feed item.
  - **The penalty the thread dodged is not in the ranker.** Grepped `has_url|url_penalty|
    link_penalty|contains_link|external_link`: only USER dwell-time features and an ads threshold.
    `open_link_score` is a predicted-engagement term and **its weight is NOT in the repo, so do not
    quote one.** Positive control: `favorite` hits 68 files.
  - **X's "link penalty" is REPORTING, and this note has been wrong in BOTH directions.** What is
    actually known: two hand-made posts with a link got 1 impression each, on an account with 8
    followers. That is evidence of 8 followers. **Do not rebuild a mechanic on this claim again.**
  - **Reversing it is one word in the platform table.** `threadWithLink()` and its tests are
    deliberately still there, because the evidence for the change is an ABSENCE in a code release,
    which is weaker than a presence. `threadItems` **REPLACES the top-level `content`** for that
    platform, so the media has to ride in `threadItems[0]`.
- **X's 403s were an ACCOUNT TOGGLE, not the plan.** `PUT /v1/accounts/{id}` takes `xCapabilities:
  { analytics, inbox }`, **both default `false`**, and both 403 in a way that reads exactly like a
  plan limit. Both are on and stay on. They unlock `GET /v1/twitter/search` (300 req/15 min) and
  the X comment endpoints.
- **Costs, measured off `usage:stats` rather than inferred**: a URL tweet is **20c FLAT — the fee
  replaces the base charge**; a plain tweet 1.5c; a follow 1.5c; a tweet READ 0.5c. Arithmetic
  checked twice to the cent. (Zernio's `usage:x-pricing` lists `content_create_with_url` with an
  empty `triggeredBy`; that metadata is wrong.)
- **X rate-limits follows hard**: 37 went through back to back, then a wall of 429s. Long backoff.

## Cross-repo

This repo is PUBLIC, so only the public connections are named here:

- **`matewishkey/mwk-og-image-generator`** (public) — the AI image studio the show builds and posts
  about. Its `gpt2` alias is `openai/gpt-image-2`, OpenAI's newest image model; Replicate is the
  pipe, not the model. **Image work for the show moved to the CMS on 2026-08-26.**

Connected **private** repos are named in the internal state note, not in this file. Read that note
before filing a cross-repo issue, and file with `gh issue create -R <owner>/<repo>`. Never edit
another repo directly.

## Platform gotchas (verified against docs.zernio.com)

- **Facebook posts to Pages only** — personal timelines are impossible via any API. Tokens ~60 days.
- **LinkedIn: ARTICLES AND NEWSLETTERS ARE IMPOSSIBLE**, and it is LinkedIn's limit, not Zernio's —
  long-form has never been exposed by their API. It goes in LinkedIn's web editor by hand, or on
  `matewishkey.com` with the pipeline linking to it.
- **LinkedIn**: 3,000-char limit; duplicate content → 422; external links suppress reach
  (−40–50%), hence the first-comment mechanic. Company page video runs to 30 minutes against a
  personal profile's 10. **Documents/carousels and polls are documented but have never been tested
  here** — treat both as unproven until one publishes.
- **Instagram**: business account required; media mandatory; caption folds at ~125 chars; no
  delete/edit via API. Image aspect 0.75–1.91:1, and one at *exactly* 1.91:1 gets rejected (float
  edge, bitten live) — pad wide screenshots to ~1.78:1 with the screenshot's own bg colour instead
  of cropping. Tall grabs pad up to 4:5.
- **TikTok**: `accounts:tiktok-creator-info <accountId> --mediaType <video|photo>` returns the live
  privacy options and posting limits — read it instead of guessing. API posts have their own daily
  cap; consent flags required per post; no comments/DMs/FYP analytics via API.
- **YouTube**: vertical <3min auto-classifies as a Short; Shorts get NO custom thumbnails;
  impressions/CTR exist only in Studio's UI, not in any API.
