# mwk-social — Zernio social-media integration

Agent notes for working in this repo. (This repo is public — keep this file free of account
IDs, billing details and secrets; that state lives outside the repo. **The three custom
hostnames are not covered by that**: they are in `web/wrangler.toml`, which is committed here,
so naming them costs nothing and pretending otherwise just makes the doc unusable.)

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
  put the JS in a script file instead.

## Skills — read these before the sections below

Procedures live in `.claude/skills/`, not in this file. A skill loads when the work calls for it;
this file loads every session whether it is relevant or not.

- **`mwk-status`** — where the pipeline stands: unpushed work, the six timers, the queue and the
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
  (posted *and* pinned, 10k chars). **No TikTok and no Threads** — which is why Threads' comment
  is the watcher's alone. Skipped on drafts. **The CLI has no flag for it**, same as `reshareUrl`,
  so `scripts/post.js` talks to `POST /v1/posts` directly.
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
  that have actually bitten are still on you.

## What we say, and where it lives

- **Everything we say out loud lives in `config/voice.json`** — CTA variants, identity and brand
  tags, per-platform hashtag caps, the blocklist, the YouTube show blurb, the feed URL.
  `scripts/lib/voice.js` is the only reader, and it refuses to load a config that breaks either
  load-bearing rule: `marker` must be present, and every variant must contain `{show}`, because
  the dedupe guard keys off that string.
- **Changing the CTA host is a breaking change.** The duplicate guard finds the CTA *in the comment
  text*, so a guard taught only the new host would re-comment on everything written before the
  change. `markers[]` lists every substring that counts; tests pin both old and new. Minting is
  **idempotent** and **never fatal** (no dashboard → plain URL → the comment still goes out).
- **`matewishkey.com/brand` IS the voice, it MOVES, and it renders `VOICE.md` at that repo's root —
  read it, never restate it.** Some of its rules sit beside the text in `config/voice.json`
  (`youtubeDescription._showBlurb`). Three that have bitten and are recorded NOWHERE else: the
  three-line headline is **one unit and is not split**; the exclamation mark on *yourself!* is
  load-bearing (a typo-cleanup flattened it within the hour); **no em dashes anywhere the site
  speaks**.
  - **The one disagreement is SETTLED in the blurb's favour**: the page says *"I, never we"*, the
    blurb says "we build it". Mate, 2026-08-24: *"For sure keeping we here is great."* That "we" is
    him and the guest. **Do not raise it again** — it reads like a fresh finding every time
    somebody re-reads the brand page.
- **NOBODY IS ASKED TO COME; THE SITE IS MENTIONED, AND THEN ONLY THE LINK** (mate, twice on
  2026-09-22). He renamed `/show` to **Apply to be a guest**, and an hour later cut the comment
  to the url and the tags: *"we do not overcomplicate it... if they do not want to come i do not
  care."* **His words and the full reasoning are in `config/voice.json` → `firstComment._register`
  — read them there.** What is not in that note:
  - **The link did not move**, so `markers[]` still recognises every comment written before the
    change: the phrasing was never what it matched on.
  - **The tail change reaches the back catalogue by itself.** The old blurb went to
    `showBlurbPast`, so `findBlurb()` still recognises what is on the channel and the nightly
    sync takes the SWAP path — one line replaced per video, his approved openings untouched.
  - ⚠ **The YouTube tail keeps ONE line, and not for taste.** `findBlurb()` locates our tail by
    the constant words either side of the slot, so a tail that is only `{show}` has no halves
    to match — nothing on the channel would be recognised as ours again and every video would
    take the REBUILD path.
  - **The CAPTION is untouched.** It still ends on *Prompt it yourself!* — his own writing and
    the brand's argument. All of the above is about the comment underneath.
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
  identical comment while consecutive posts differ. `avoidIndex` is the belt-and-braces on top,
  and **both paths use it** (`post.js` and `first-comment.js` share `comment-state.js`); a dry run
  must not move the rotation on. ⚠ **Inert today**: one variant, `episodeMixRatio` 0, so there is
  nothing to rotate between. This is the rule for the day a second one comes back.
- **A ZERNIO 502 ON A COMMENT WAS OUR OWN OVER-LONG BODY, AND IT READ AS THEIRS TWICE**
  (580 characters against Threads' 500; a `400` of the same shape on 2026-08-24). **A platform
  error on a comment is ours until proven otherwise.** `platforms.commentMax` is the cap and
  `voice.firstComment({ maxLength })` composes within it, giving up the tags first, then the
  quote, and the link never — nothing is truncated, because half a url published under a post is
  worse than one loud failure and an hourly retry.
- **The comment cap is NOT the caption cap**: LinkedIn 1,250 against a post's 3,000, YouTube
  10,000 against a description's 5,000; Threads is 500 either way.
- **AN EPISODE IS A GUEST SHOW; A LIVE STREAM IS NOT ONE**, and `latestEpisodes()`'s `/episodes/`
  filter (`voice.js`) is what keeps that true in code — widen it and a solo stream starts being
  quoted as a guest's wish. Mate, 2026-08-21: *"there are no episodes about this, it was live on
  youtube, uncut version is visible."* ⚠ Inert today, same as the rotation above.

## Hashtags

**The rule and how to apply it live in the `mwk-post` skill.** The one-line version, because it is
absolute: **would someone who does NOT work in technology already know this word and use it
themselves?** If they would look it up, it is wrong (mate, 2026-08-21). Backtested: 79% of tags we
had already published were jargon the rule rejects.

- **Tags chosen for WHO they reach are allowed on a manual post** (mate, 2026-08-20), reversing the
  subject-matter-only rule. Evidence worth not re-deriving: `#NoCode` reaches the supply side, not
  the buyer; `#LearnAI` reaches the already-using-AI crowd; `#SmallBusiness` runs ~1,800 posts/hour
  against `#SmallBusinessOwner`'s ~362. Instagram's own head says hashtags feed SEARCH, not reach —
  so the words in the caption matter more than the tag list.
- **Tags go in the caption OR the comment, never both** (`noTags`). On Instagram both would spend
  the 5-cap twice — a defensive choice, not a rule Instagram states.
- **Instagram's 5-cap is Instagram's; "caption AND comments together" is not** (retracted
  2026-08-24). We keep the behaviour and drop the certainty. **The retraction is argued once, in
  `docs/playbook.md` → *What each platform allows* → *The two worth getting right*** — including
  what else went with it, and what a first comment may not buy on Instagram; it drifted once by
  being written out three times. Read it there before re-opening the question.

## Transcripts and topic tags

- **`RULES_VERSION` in `topic-tags.js` is what makes a tag-rule change take effect** — bump it
  when the RULE changes, never when the code does. Its header carries the version log and why a
  cache hit that ignores it would have made a rule rework change nothing.
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

- **A POST POINTS AT WHAT IT IS ABOUT, AND `mwkshow.com` IS THE SHOW'S ADDRESS AND NOTHING
  ELSE'S** (mate, 2026-09-22: *"the mwkshow.com is really just the show otherwise use full link.
  this rule has to be generic"*). `queue_item.link` is the post's own destination (`--link`, and
  a field on the dashboard form); null means the show. The reasoning is in
  `shortlink.js`'s header, at `isShowLink()`. What is not there:
  - **The slots and the comment do not agree, on purpose.** The pin's destination and X's
    caption link go wherever he said. The COMMENT only follows when the destination is one of
    his (`voice.carriesCta`) — `firstComment()` refuses a body carrying no marker, and that
    throw is outside post.js's per-account catch, so a vendor url there killed the whole post.
  - **The watcher cannot look a queue item up**, so the publisher writes the destination into
    `comment-state.js` under `__links`. Threads has no native first comment, so without that
    every Threads comment on a `--link` post said the show.
  - ⚠ **`matewishkey.com/` had to join `markers[]`**, or the watcher would add a SECOND comment
    under every post naming a project page, for ever. Broad on purpose — under the current voice
    the CTA *is* a mention of his site. The cost runs the safe way: a viewer who links his site
    makes us skip that post, which is a comment added by hand rather than one Instagram cannot
    delete.
  - **A live code is never broken.** `mwkshow.com/dial` still resolves; it is simply not used
    again.
  - **A PUBLISHED POST WHOSE DESTINATION IS ONE OF OUR CODES IS STILL OURS TO REPOINT, AND THIS
    FILE SAID THE OPPOSITE** (2026-09-22). It read *"nothing reaches what is already
    published"* off a true fact about Pinterest — a live pin's destination cannot be edited by
    any API. But the pin does not hold a destination, it holds `mwkshow.com/<code>`, and the
    code is a row in our own D1 that `links.js` reads fresh on every hit with no caching. One
    `UPDATE link SET target` moved the 2026-09-22 Dial pin onto the project page; the pin was
    never touched. **So the reach of a voice or destination change is the SHORT CODE, not the
    platform** — ask which codes a change should follow before concluding a post is frozen.
    - **Only where the code's PURPOSE moved with it.** `1atde` is bound `post_key =
      'queue:<item>'`, that pin alone, so repointing it is exactly as narrow as the pin. A code
      several posts share is not repointed, it is superseded. And repointing changes `target`,
      which is IN the mint key, so the next mint for the old destination makes a NEW code —
      correct here, and the reason a code is bound by purpose rather than by where it points.
    - **The comment is a separate decision from the slot, the same way it is at publish time.**
      The Dial post's first-comment codes were left on `/show`: the comment's job is the show
      invite, and only the pin's own destination was the thing pointing a Stream Deck plugin at
      *Apply to be a guest*.

- **A URL IS NOT CLICKABLE EVERYWHERE, and for three weeks this pipeline acted as though it was**
  (2026-08-22). Instagram makes NOTHING clickable — not a caption, not a comment, not a Reel.
  TikTok the same, including the bio on an account under 1,000 followers. **YouTube deliberately
  renders urls in SHORTS descriptions and comments as plain text**; long-form is fine. Measured
  damage: five TikTok and five Instagram codes took **0 and 1** human clicks, which reads as
  "nobody cared" rather than "nobody could".
- **`linkClickable` is the fact; `linkPlacement` is the decision, and `platforms.linkProblems()`
  refuses to let them disagree.** Which slot a platform uses is the TABLE's answer, never this
  file's. Two things about it that are not in the table:
  - **Every CTA phrasing MUST be in `markers[]`** — `'profile'` and `'none'` carry no url, so
    the guard has only the words to recognise its own comment by. `voice.js` throws at load if a
    `profileCtaBy` phrase is missing from the list.
  - **`commentWatched()` is not `linkPlacement === 'comment'`** — Instagram is `'profile'` and IS
    watched, because its CTA is still a comment; X has a comments API and is NOT, because its CTA
    ships inside the post. post.js printed "the watcher adds it" about a platform it cannot reach
    **twice**, so it is derived from one function now and a test pins `ALL_PLATFORMS` to that set.
- **The MINT KEY is (`target`, `platform`, `clip_id`, `post_key`, `campaign`, `medium`)** —
  `created_by` and `note` are recorded, not keyed. Same destination from a bio and from a reply =
  two codes, or "which one earned this" has no answer. `medium` is the *placement*, `platform` is
  the source. A test reads `post.js` and fails if any `linkFor()` call omits its medium.
  - **A code is bound by PURPOSE, not by destination.** `target` is in the key, so a code
    identified only by where it points stops being findable the moment it is repointed and the
    next mint quietly makes a second one. Bind anything movable (`manual:pretalk-public`) — both
    booking calendars were repointed in one `UPDATE` and the website was never touched.
  - **A PROFILE LINK NAMES ITS ACCOUNT, OR IT IS USELESS.** With three LinkedIn accounts and
    Facebook posting only to Pages, `linkedin bio` answers nothing. Every bio code carries
    `post_key = 'account:<zernio id>'` (resolve from `accounts:list`, never type one) or
    `manual:<slug>`. **`postKey` is in the key**, so minting without it makes a second code for
    the same profile.
  - **`clip_id` → `queue_item.media_key` is the click-to-video join.** `resolveClipId()` in
    `web/src/api.js` owns it and its header carries every trap: the two minting paths, the
    backfill-before-deploy ordering, the post keys that are null by nature, and the Facebook
    post id whose `_` is a LIKE wildcard. **A comment asserting an impossibility is still a
    claim** — that is how sixteen Threads codes went unjoined.
    - ⚠ **A FACEBOOK VIDEO HAS TWO IDS AND THE SOURCE PICKS ONE: `posts:list` says the bare
      video id, `analytics:posts` says the `<page>_<post>` composite.** An image post reads
      composite on both, which is the control. So a video found through the **Facebook sweep**
      carries an id that appears nowhere in `queue_item.result`, and the numbers are unrelated
      — nothing computes one from the other. The post url is the bridge (both spell it
      `/reel/<bare>/`), and `resolveClipId()` takes it as a SECOND lookup behind the direct
      one. Fixed 2026-09-22, #44, exercised against production D1 with a no-url control.
      - **#44 said the 7 bare-id posts were the damage; they were never the damage.** They
        join, because the publisher and `posts:list` agree. The one orphaned code, `2ksvn`,
        is the 2026-09-13 Restream mirror — no queue item, null **by nature**. The mechanism
        was real and the casualty list was the neighbouring fact.
      - **The same split puts every Facebook video in the comment ledger TWICE**, once per
        key (measured on three since the sweep landed 2026-09-20). No duplicate comment has
        ever gone out: both entries read *"comment already on the post"*, because the watcher
        reads the post before writing. **Left alone on purpose** — collapsing the keys would
        route `inbox:reply` through the bare video id, which has never been exercised, while
        the composite has.
- **A SHORT GETS A CODE SOMEBODY CAN TYPE — `mwkshow.com/s5`.** Nobody can click a url under a
  Short, so the only route is reading it off screen and typing it, and `mwkshow.com/8x2kq` is not
  a thing anyone types. `mint({ codePrefix: 's' })` allocates base 10 (base32 mixes confusable
  characters). **A low number on one of these is neither indifference nor unreachability — it is
  how many people cared enough to type it.** How `codePrefix` narrows the dedupe, and why the
  lookup is ordered, are at `mint()` in `web/src/api.js`.
- **A PERSONAL SHARE IS A NAME ON THE END OF ANY LINK — `mwkshow.com/mmm/natalie`.** One code
  serves everybody; the name is a word HE types, stored on the CLICK as `tag`. **A code he has to
  copy from somewhere is a code he will not use from a phone**, which is why `mint()` takes a
  chosen code — and a chosen code SKIPS the attribute dedupe.
  - **It says the link labelled natalie was opened, NOT that Natalie opened it.** Links get
    forwarded. Do not let a summary quietly upgrade it.
- **`bot = 0` WAS NOT ENOUGH, AND IT OVERSTATED EVERY CLICK NUMBER BY ABOUT FOUR TIMES**
  (2026-08-27) — 182 "human" clicks, ~49 that stand up. A click counts only if it arrived ALONE:
  no other hit on that code within 60s either side, **and** no hit on ANY OTHER code within 10s,
  because one fetcher walks every code on a page (that second filter took the all-time count from
  120 to 106). The windows, the measured distribution and the reasoning are in
  `web/src/lib/clicks.js`; tests pin both windows and the symmetry.
  - **The referer is NOT a positive control** — Facebook's scraper sends
    `Referer: www.facebook.com`, so a facebook referer proves the hit came from Facebook's
    infrastructure, never that a person was holding the phone.
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
  other seven render no website field to a logged-out fetch, so a miss there is unknowable, never
  "not done".
  - **The positive control is the FIELD, not the code**: if the selector finds no field, the read
    proved nothing. `linkedin.com/company/<slug>/about/` renders no field while
    `linkedin.com/company/<slug>/` does — the more specific URL is the one that answers nothing.
  - He updates these by hand, so **when he says a bio is done, read it**. Two of the ten were
    still on the plain url after he said they were updated.
- **`/links` on the dashboard can mint by hand**, for anything, including a destination the
  pipeline would now leave unshortened. Anything he pastes himself — a bio, a newsletter, a talk —
  was a raw url and invisible before that. **A zero proves nothing**: not pasted and
  pasted-but-unclicked look identical.

## YouTube descriptions

- **AN EPISODE IS WRITTEN FROM THE SITE, NOT FROM THE TAPE** (#40).
  `scripts/lib/show-notes.js` renders it from `content.json` — no model, so it is the same bytes
  every run. **Its header is the contract**: the sections in order, why `learned[]` is not
  printed, the 5,000 cap it throws at rather than truncates, and why the doc is fetched with
  `curl -4`. **In `sync()` the episode branch comes BEFORE the swap path** — every episode
  already carried our tail, so `ours === tail` would have said "nothing to do" for ever; a test
  pins the order.
- **The tail is written from `matewishkey.com/brand`**, not paraphrased from it. Its rules sit
  beside the text in `config/voice.json` → `youtubeDescription._showBlurb`, and
  `test/links.test.js` pins them — including **NO SECOND ADDRESS AND NEVER ANOTHER PLATFORM**
  (mate, 2026-08-25: *"why we are promoting twitch on the youtube 'live' at all"*), which the
  test enforces by walking every tail shape.
- **THE TRANSCRIPT WINS OVER THE TITLE**, and the prompt in `yt-description.js` says so because a
  left-over stream title put a guest in a video he is not in: `_6zckinR5VI` is titled "Istvan
  David: Exploring Light" and its notes credited Istvan with mate's own projects — 1,368 words of
  transcript, no mention of him. The prompt also demands first person and bans "the host", after
  it narrated his own show in the third person for weeks.
- **EVERY PROPOSAL APPROVES ITSELF, AND THE PAGE THAT COLLECTED APPROVALS IS GONE** (mate,
  2026-09-15: *"just approve it"*). `autoState()` in `web/src/api.js` returns `'approved'`
  unconditionally; its header carries the reasoning and what went with it. **His protection is
  now the WHERE clause alone**: a REJECTED row stays excluded from the re-file, so a no stays a
  no. A test reads the SQL rather than the state, because with every kind approving, the state
  would pass either way.
  ⚠ **The 14-day expiry is inert**, not wrong: nothing is ever filed `proposed`, so there is
  nothing to expire. Left in as the safety net if the gate comes back.
- **`--repropose <id…>` is how a voice change reaches what is already written.** `sync()` cannot:
  a recognisably-ours description takes the swap path, which is right for a stale tail and
  useless for a wrong opening. It files proposals and never writes.
- **UNCHANGED IS NOT THE SAME AS CURRENT.** When adding anything to the constant part of a
  generated artefact, ask how it reaches the ones already written — the same disease
  `RULES_VERSION` cures, in a second place. Here the loop skipped before `build()` was reached,
  so a tail change would have landed on **2 videos out of 23**. **The tail itself is the honest
  test**: if the text carries it, we wrote it, whichever route it took.
- **A stale tail is SWAPPED, never rebuilt.** `build()` regenerates the opening with a model, so
  a rebuild hands him rewritten summaries to re-approve — words he already said yes to. Two tests
  pin that the plain and tracked blurbs differ on exactly ONE line, or the "one-line change" the
  dashboard shows him is a lie.
- **EDITING THE BLURB'S PROSE RETIRES IT — push the old text to `showBlurbPast` or every video
  gets rebuilt.** The wording *around* the slot is part of the key, and nothing is ever deleted
  from that list. `voice.findBlurb()` matches the constant halves either side of `{show}`; its
  two silent failures (a blurb that ends on the slot, and a newer blurb shadowing an older one
  it is a prefix of) are documented at the function.
- **A VIDEO YOUTUBE NEVER CAPTIONS FAILED EVERY RUN, FOR EVER, AND NOBODY WAS TOLD.** Past
  `MWK_CAPTION_GRACE_HOURS` the tail is proposed on its own (`kind: 'append'`, his words kept
  whole). **Only the missing-transcript message is recovered** — a model error or a failed mint
  still throws, or every real fault becomes a quietly degraded description.
  - **Age comes from `%(timestamp)s`, and yt-dlp prints the literal string `NA`.** `Number('NA')`
    is NaN and NaN compares false against the grace, so an unguarded read takes the impatient
    branch on every video lacking a timestamp. `null` means wait.
- **Adding a proposal kind is TWO files.** `propose()` dropped an unknown kind to NULL and the
  dashboard then guessed from the diff, which calls an append a rewrite. `test/dashboard.test.js`
  reads the kinds out of `yt-description.js` and fails if `api.js`'s `PROPOSAL_KINDS` misses one.
- **"THE YOUTUBE DESCRIPTION IS THE BIGGEST CLICK SOURCE WE HAVE" WAS A MEASUREMENT ARTEFACT**
  (retracted 2026-08-27). It read 87 of 182 human clicks — all crawlers the UA test missed. The
  bursts land at the minute we WRITE the description (`yt_proposal.applied_at`
  2026-08-26T05:41:48 against hits at 05:40:45–05:46:01), and code `s8` took four "human" clicks
  inside 5.5 seconds. Under the counting rule it has **2** clicks, and exactly **one** counted
  hit in the whole table carries a `www.youtube.com` referer. **The description is still worth
  writing — it is what a viewer reads — but it is not a click channel, and no decision may rest
  on that number again.**

## Live streams

- **HE GOES LIVE STRAIGHT ON YOUTUBE, SO A LIVE STREAM NEVER ENTERS `posts:list`** — for eleven
  days that meant the first-comment watcher could not see one at all, and 9 of 19 streams had no
  CTA anywhere. `sources()` sweeps `analytics:posts` for it. **Two named sweeps, YouTube and
  Facebook, never a loop over `opts.platforms`** — and Facebook is VIDEOS ONLY, because a
  hand-made post on the page is his, not a stream. `test/links.test.js` pins both literals and
  the video filter.
- **A stream with the link already in its description is SKIPPED**, and that is the right answer
  to "does a first comment make sense?" — on long-form YouTube a description url is clickable, so
  a comment repeating it is noise. The comment is the net for a stream whose description has not
  been written yet.
- **`--sync` proposes but cannot act on an UPCOMING stream** — yt-dlp refuses a scheduled live
  event, and its comments are closed. Both are expected; neither is a fault to chase.
- **RESTREAM MIRRORED A LIVE STREAM AS TWO YOUTUBE VIDEOS** — one vertical and one landscape,
  same title and duration, both public and both wanting the CTA — **and as a Facebook Reel in
  the same minute, which is why the Facebook sweep exists. He turned both off in Restream's own
  settings and the sweeps stay.** Measured on `analytics:posts --source external`: the last
  vertical+landscape pair is 2026-09-14T10:37Z and the last Facebook+YouTube pair is
  2026-09-13T21:52Z; nothing of either shape since, against 7 pairs in the preceding month, so
  the query still finds one. **The settings are his, so this can come back without a commit** —
  re-run that query before treating a single upload as the rule. Related: `mwk-no-vertical-copies`.
- **NOTHING HERE READS A TITLE OR A THUMBNAIL, SO A WRONG ONE SITS THERE UNTIL HE SEES IT.** A
  stream went out for 3h40m under the previous episode's guest card (`gUAo3DSGf-o`, 2026-09-18);
  five others carried the placeholder title *Watch Me Work* for three weeks. **That is our gap,
  not the API's** — `posts:update-metadata` takes `--title` and `--thumbnailUrl` and both are
  EXERCISED (2026-09-18, read back off YouTube, on an `isExternal` VOD). No code path sets a
  title on its own, so it stays a by-hand fix. *How* the old card reached the new broadcast was
  never established — do not write down a mechanism nobody measured.
- **`content.json`'s `raw.url` IS the episode-to-video join, and it is a field rather than a
  guess** (exercised 2026-09-19 — nine videos took the site's title and that episode's card in
  one `update-metadata` call each, all nine verified off YouTube). The card comes from
  `~/share/work/mer-matewishkey-web/cards/<slug>/youtube-1920x1080.jpg`.
  - ⚠ **THE SITE NAMES THE VERTICAL COPY OF A PAIR, WHICH IS THE OPPOSITE OF WHAT ANYONE
    ASSUMES.** E008 and E009's `raw.url` point at the 1080x1920 upload, so deleting "the vertical
    duplicate" would leave both episode pages linking to a dead video. **Before deleting
    anything, check what names it**; repoint first.
  - **The vertical half of a Restream pair is not wanted and no more are recorded** (mate,
    2026-09-19) — memory: `mwk-no-vertical-copies`. Most vertical videos on the channel are this
    pipeline's own short clips, which have no landscape partner; "delete the verticals" is never
    a channel-wide query.

## Thumbnails

- **A custom thumbnail CAN be pushed to an already-published video** — `POST
  /posts/_/update-metadata` with `thumbnailUrl` — **and it works on a SHORT, which both YouTube's
  help and Zernio's docs deny.** Exercised 2026-09-22; the measurement, and the cache check that
  rules out the obvious objection, are in `scripts/lib/cover.js`'s header.
  - **What changes is the 16:9 thumbnail**: search, the channel's video grid, embeds, suggested,
    every share card. **What does NOT change is the vertical cover in the Shorts feed** — that is
    YouTube's own pick and no API sets it; it is the mobile app's *Edit cover*. **Never flatten
    the two into "we can set the thumbnail".**
  - **Verify at YOUTUBE's end, never by the API's echo**, and **bust the cache** (`?cb=$RANDOM`):
    `i.ytimg.com` served the old bytes for over three minutes after a write that had landed.
    **Never compare against the file you uploaded** — YouTube re-encodes it — compare against the
    BEFORE bytes. Round-tripping a video's own current thumbnail is the safe positive control.
- **THE CARD IS DRAWN IN THE WEBSITE REPO AND IS ALREADY ON THE SHARE — do not draw one here.**
  `mergodon/matewishkey-web`'s `npm run card -- <episode-slug>` writes it at the upload size,
  inside Zernio's 2 MB cap; that repo's `scripts/episode-card.mjs` header carries every rule with the date
  it was asked for — read it there, never edit that repo. **The episode's own `title` IS the
  card's headline**, so a YouTube title that disagrees with the card means one of the two was set
  by hand.
- **YouTube's own spec** (not a blog): 3840×2160 recommended, min width 640, 16:9, JPG or PNG —
  but **Zernio's 2 MB cap is what binds us**, and the account must be verified. **YouTube
  publishes no safe-zone guidance at all**; the "1100×620" and "bottom-right 15%" figures
  circulating are blog claims. What IS observable: the duration badge sits over the bottom-right,
  so branding does not go there.
- **A/B testing thumbnails has no API and would not conclude here.** Test & Compare is
  Studio-only, excludes Shorts, and a variant wants 1,000–5,000 impressions to settle — our best
  long-form video has 95 views lifetime. Do not re-research until a video clears four figures.
- **We do not make the show's pictures here** (mate, 2026-08-26). A picture reaches this pipeline
  already branded; what is ours is the aspect and format checks either side of it.
  (`scripts/reality-check/` is a separate thing and stays — it renders its own cards from the
  brand, and its README says so.)

## The platform table — wire it or do not add it

**A field on `platforms.js` that nothing reads is the single most repeated failure in this
repo.** Five shipped declared-and-never-read — `linkPlacement`, `landscapeOk`,
`hashtagsInCaption`, `shortsAreDead`, `captionMax` — and `hashtagsInCaption` being decorative
meant LinkedIn, Facebook and YouTube posted with no hashtags at all for weeks. All are wired now,
and everything since has landed with its reader in the same commit. **The config page renders
only a curated eight plus whatever `flowFor()`'s derived steps expose**, so a field can be on the
table, on no page, and read by nothing without anything looking wrong.

- **`shortsAreDead`** — a link can be dead for one CLIP and live for another.
  `platforms.linkDeadFor(name, probe)` decides it; `run-queue.js` computes the list per post.
- **`captionMax`** became load-bearing the day X's link joined his words. `captionForPlatform()`
  gives up **the tags first, then the link, and his words never** — if his words alone do not
  fit, the platform is dropped with a reason rather than truncated. **X counts every url as 23
  characters** however long it is. Composition is caught per account, so one over-long post does
  not take the others with it.
  - **A PLATFORM HIS WORDS WILL NOT FIT WAS DECIDED NINE HOURS AFTER ANYBODY WAS LOOKING**
    (2026-09-21). The publisher was right; the knowledge was in the wrong place. So the split is
    whether he NAMED the platform: **named → throw at queue time** (one edit, while he is still
    there); **implied → print it on the `queued` line and the dry run**, because "wherever it
    fits" already licenses a drop and what was missing was anybody being told. A warning higher
    up the output is the journal problem again, so a test pins WHERE it prints.
    `scripts/lib/captions.js` holds the one `captionLength` and `wontFit()`.
- **`captionOverlaysShort` — ON A SHORT THE CAPTION IS THE TITLE LINE, THE TAGS AND ANY BARE
  CREDIT, BECAUSE THE PLAYER PRINTS IT OVER HIS OWN SUBTITLES** (mate, 2026-09-22). Both halves
  decide it: the platform has a short-form player **and** the clip is one (`platforms.isShort`,
  shared with `linkDeadFor` rather than written twice). So Facebook and YouTube compose in full
  for the wide cut and short for the tall one, from the same words. Procedure: `mwk-post` §1b.
  - **Nothing is truncated and this is not the give-up order bending.** The rest of his words are
    deliberately not sent; **the first comment still carries everything.**
  - **It is measured per platform, not assumed.** Facebook was the one in doubt and is in — a
    9:16 page post carries `og:url = facebook.com/reel/<id>`. Threads, LinkedIn, X and Pinterest
    are out as text-first surfaces, **not measured with a ruler**; if he says the text covers a
    clip on one of them, add it to the table.
  - **A BARE CREDIT LINE RIDES WITH THE TITLE, AND PROSE DOES NOT.**
    `Thanks @thechrisgoor #couchtocreator` is prose and is dropped on a short;
    `@thechrisgoor #couchtocreator` survives. Write a credit bare.
  - **THE CREDIT IS COMPOSED LAST, AFTER OUR TAGS, EVERYWHERE** (*"put my tags first not chris
    one"*). It is **never given up to fit a cap** — he asked for the tag, so it ranks with his
    words.
  - **So the body is written title-first**: line one stands alone as the whole caption on four
    platforms, and the story goes underneath. `captions.titleLine()` is the one definition of
    that line, and `queue-add.js` prints which platforms will get it alone.
- **`coverFrame` — WE NEVER SENT A COVER, SO EVERY PLATFORM USED ITS OWN DEFAULT AND THEY
  DISAGREE** (mate, 2026-09-22: *"the key frames are incorrect"*). Nothing had failed: Instagram
  defaults to the literal first frame, and on a clip that opens on an empty shot that is a
  picture of nothing. `platforms.coverMsFor(probe)` gives one number in milliseconds and
  `coverFor(name, ms)` converts it per platform; `MWK_COVER_MS` moves it with no deploy.
  **The per-platform fields, the unit each one counts in, and the frame measurements behind the
  2,000 ms default are in `platforms.js`'s own header.** What matters here:
  - ⚠ **"THE TENTH FRAME" IS NOT A TIME** — 167 ms at 60 fps, 333 ms at 30, and on the clip that
    prompted this both land on the empty field he was complaining about. The setting is a
    duration.
  - ⚠ **A COVER IMAGE ON TIKTOK EDITS THE VIDEO.** On a developer-app account Zernio rehosts the
    image and stitches it in as a frame at the start of the clip. The timestamp does not, which
    is why the timestamp is what we send.
  - **YouTube is the one platform whose cover is set AFTER publishing**, and `run-queue` does it
    (`scripts/lib/cover.js`), caught on its own so a failed cover is a journal line and never the
    item's verdict. On Instagram, TikTok and Pinterest the frame is decided before it goes out or
    not at all.
- **`imageOk`** says who can take a still at all — **not YouTube** (nothing to post it *as*) and
  **not TikTok** (photo posts exist in its API and **mate declined building them**, 2026-08-26
  closing #27, so "not built" is the decision, not a gap). `imageAspectRange` is not
  `aspectRange` — IG video tops out at square while its images run to 1.91:1. Procedure:
  `mwk-image`.
- **`landscapeOk`** routes the two cuts. **One video per post, on every platform** — a vertical
  and a landscape cut are two posts, never one. `queue_item.media_wide_key` carries the second,
  and with no wide cut the tall one goes everywhere, so YouTube normally gets a Short.
- **A GALLERY IS SEVERAL STILLS IN ONE POST, AND IT IS THE OPPOSITE OF THE TWO CUTS.**
  `media_wide_key` is *the other video*; `queue_item.media_extra` rides **with** `media_key` in a
  single post. **Stills only** — `platforms.galleryFor()` collapses a set with any non-image in
  it back to one item rather than half-publishing a mixed post. Caps are `imageMax`; read the
  numbers out of `platforms.js`, never out of a doc.
  - ⚠ **`galleryProblems()` only checks that `imageOk` and `imageMax` agree.** It does NOT pin
    any cap — `galleryFor()` applies them, and Pinterest's 1 (which is why a pin is never part of
    a gallery) is the one number no test covers.
  - **GROUP ON THE WHOLE SET, NEVER THE FIRST FILE.** Keying the publish groups on `set[0]` is
    the natural way to write it and is wrong: X and LinkedIn share a first image and cap at 4 and
    20, so X would be handed twenty. A test fails if the key stops covering every file.
  - **CHECK EVERY IMAGE, NOT JUST THE CUT**, and drop a platform whole rather than sending it a
    shortened gallery — a silent 5-of-6 reads as success.
- **A CAPTION IS COMPOSED PER PLATFORM, and `publish()` groups by the caption a platform gets** —
  not by any fixed split. His words never vary; the link and the hashtags do.
- ⚠ **READ THE TABLE, NEVER THIS FILE, FOR WHICH SLOT A PLATFORM USES.** This section once said
  `linkPlacement: 'caption'` was live nowhere while it had been live on X for two days. The note
  is a copy, and the copy is what drifts.

## Reality check cards

- **`scripts/reality-check/` renders the cards; the episode is a json and lives on the SHARE, not
  here.** This repo is public and does not need to carry a specific claim to carry the format.
  `example.json` is the shape, and it renders. Its README carries the brand rules.
- **The brand is vendored from `matewishkey/mwk-og-image-generator`, not approximated** — the red
  is `#e2342b`, not the `#DE2725` an early draft guessed, and reading the real thing corrected
  two more in the same pass. **The RedBlock is the only logo and is never a bare mark.**
- **`validate.js` runs before anything renders, because the failure that matters is a card that
  comes out WRONG and looks fine** — two of four icons once rendered as empty squares after a
  rename and nothing said so. Its header lists what it refuses and `test/reality-check.test.js`
  has a case for each. **The renderer measures its own overflow and prints `OVERFLOW`** rather
  than cropping.
- **Portrait is THREE cards, not a cut-down.** Instagram takes nothing taller than 4:3 and the
  landscape card does not fit inside that, so 1080x1350 x3 as a carousel — verified as a gallery
  on the five platforms that take one (Pinterest takes a single image). **Do not sit on exactly
  0.75 or 1.91**; the same float edge that rejects a 1.91 image rejects these.
- **One scale across every bar, and every bar names its window.** Two scales let $126 and $3,600
  draw the same length, which is the opposite of what a chart is for.
- **Say where the numbers were counted generously.** Admitting the overestimate is what makes the
  conclusion hard to argue with; a card that only accuses reads as an axe being ground. Same
  reason the one case where the thing being checked WINS stays on the card.

## Publishing and the queue

- **The queue is OURS, not Zernio's** (reviewed 2026-08-21). Zernio's `/v1/queue/*` is a recurring
  timetable per profile; ours is a rate limit across accounts spanning two profiles. The full
  reasoning, and why the publisher cannot move into the Worker (ffprobe, ffmpeg and Whisper are
  binaries), is in `docs/playbook.md` — read it before proposing either again.
- **"Post it" means QUEUE it. Only publish when he says publish** (mate, 2026-08-21). The
  procedure is the `mwk-post` skill's opening section — read it there, this is the decision only.
- **THE PACE IS HIS, AND THE NUMBERS LIVE IN `pace.DEFAULTS`** — read them there and quote
  `pace.status().nextAt`, never a figure from a doc. Three decisions sit behind them:
  - ⚠ **THE WINDOW REVERSES HIS OWN EARLIER CALL.** "No time-of-day window" was mate's on
    2026-08-21; the morning window is mate's on 2026-09-21 (*"the morning giving us the best
    coverage"*). It is Brisbane morning because that is New York evening — *"i do not care about
    hungary at all"* — so **do not re-propose an evening slot for Europe.**
  - ⚠ **TWO A DAY IS HIS NUMBER AND RAISING IT NEEDS HIM TO SAY SO IN WORDS.** It was six until
    a Pinterest backfill put eight pins out in one day, every one legal, and the day read as a
    machine emptying a list. **The cap is the only thing between a backfill and a feed nobody
    wants to follow** — `--priority -1` orders the queue, it does not slow it down. His "one
    short a day" is what he SHOOTS, not what the queue releases; mistaking the two cost a revert
    the same day, and `pace.js` records the misreading above `perDay`.
  - ⚠ **THAT THE HOUR AFFECTS ANYTHING IS UNMEASURED, and the number that looked like proof was
    not one.** Over 253 posts the 04:00-08:00 block read 1.75x its platforms' medians — and its
    posts are a median 32 days old against 11, so most of it was views still accruing; matched
    on age it is 1.33x on 8-21 posts. Zernio's `analytics:best-time` is worse, its top slots
    resting on ONE post each. **No platform reports audience geography**, so "the US is awake" is
    a reasoned guess and must never be quoted as a finding.
- **A CONSTANT GAP IS A FINGERPRINT** (mate, 2026-09-21: *"make sure we are randomizing stuff"*)
  — ours was 95 minutes on the dot, and every `--at` item went out at 10:05 Brisbane eleven days
  running. The measurement is in `test/jitter.test.js`'s header. THREE jitters, and they are
  different mechanisms **on purpose**:
  - **THE DAY'S OPENING SLIDES, BECAUSE THE GAP ONLY EVER MOVES THE SECOND POST.** The first post
    of a day has no gap to wait out, so it landed at 07:05 every morning — half of everything we
    publish, and the half that sets the pattern. `pace.openingFor(day)` hashes the Brisbane DAY,
    and `whyNotNow` gives it its own refusal ("inside the window, but today opens at 09:34")
    because at 07:10 *"outside the window"* would be a lie. **The range stops an hour short of
    the close** so the day always keeps an hour of ticks to publish in.
    - ⚠ **A HASH THAT DOES NOT SPREAD CONSECUTIVE DATES LOOKS LIKE IT WORKS.** Plain FNV-1a gave
      a whole week inside a two-hour band — a date changes in its LAST character and the
      avalanche is weak in the low bits. `openingFor` runs it through murmur3's finalizer;
      `jitterFor` is deliberately NOT changed, its seed being a full timestamp. A test walks a
      year and fails under 120 distinct openings.
  - **The gap is HASHED off the last post's timestamp**, never `Math.random()`: the pace is
    recomputed every five minutes, so a fresh roll per tick is the MINIMUM of a dozen rolls,
    which collapses to about zero and is biased small.
  - **An unlock is a real roll, made ONCE and stored.** `--at` takes a plain day and writes a
    timestamp inside the window, so held items stop all landing at the same minute.
  - **`nextSlot()` must apply the same jitters as `whyNotNow()`** — the gap AND the opening — or
    the dashboard promises a time the publisher then refuses.
  - ⚠ **`--at`'s stored instant straddles midnight UTC**, so **asserting a UTC date on
    `not_before` is the trap**: two tests did and both broke the moment the window moved off
    midnight. Assert the BRISBANE day. The offset is derived from `cfg.tz`, never hardcoded.
  - **`MWK_WINDOW` changes the hours with no deploy**, and an unparseable value is treated as no
    window rather than throwing: a typo in an env var must not stop the queue.
- **QUEUEING IS ONLY A REVIEW GATE IF SOMETHING IS WAITING, AND ON A QUIET DAY NOTHING IS**
  (2026-09-15, learned by publishing). With `pace.status().why === null` the next tick is minutes
  away — the timer runs nine times an hour, twenty minutes being the widest gap — so an item
  queued and announced in the same breath is live before he reads the message. It happened, and
  four of five platforms had to be unpublished with Instagram permanently stuck. **`--at` is
  day-granularity only**, so there is no way to hold for an hour today. Either check the pace
  before calling a queue a gate, or say plainly that it goes out at the next tick. **His own
  dictated words need no gate**; drafts do.
- **An item that has put ANYTHING live is never queued again.** A throw in one publish group used
  to unwind the run and requeue the item — X's upload failed at 99% after five platforms had
  published, and the next tick reposted everything three times over. Each group is caught where
  it happens and `verdict()` returns `posted` with the failures named. **A retry after a partial
  publish is a human's decision, not the code's** (`test/queue-verdict.test.js`).
- **A publish call that times out has NOT necessarily failed.** The request aborts at the client
  and Zernio keeps processing, so `post.js` reconciles by searching `posts:list` for the exact
  caption, minutes old; not found, the platforms are recorded **`unknown`** — and `verdict()`
  never turns an unknown into `failed`, because failed is what the dashboard offers Re-queue on.
  A platform still `processing` when we stop waiting is unknown the same way. The queue page
  shows *"unknown, check by hand"* and no button.
- **A 207 WITH THE POST INSIDE IS A POST, NOT AN ERROR.** Zernio answers `207 "Post created but
  publishing failed"` with `error: true` AND the created post, still `pending`. `api()` threw on
  the flag, so run-queue recorded FAILED over a post Zernio was still publishing. It now returns
  a 207 carrying `post._id`; the caller polls and a still-pending platform lands as **unknown**.
  A 207 without a post, and any other `error: true`, still throw. Pinterest transcodes slowly;
  expect the first poll to see `pending`.
- **A claim older than 40 minutes is a run that died** (earlyoom, SIGTERM, a reboot — all in the
  journal) and `claim()` marks it **failed with a note, never re-queued**: it may have published
  before it died.
- **THE ONE SCRIPT THAT PUBLISHES WAS THE ONE THAT DID NOT CHECK ITS FLAGS** (#37). `run-queue.js`
  read them with `includes()`, so `--help` claimed an item and posted it to three platforms while
  somebody looked up the flag list — and Instagram and TikTok cannot be deleted, so that class of
  slip is permanent. **Every script refuses one now** (2026-09-22): the four with positionals
  keep their own parser, the rest go through `scripts/lib/args.js`, and `test/args.test.js`
  runs each job with `--bogus` and fails if it gets past the flag — so a new `main()` without a
  refusal fails the suite, not a Tuesday. ⚠ A grep was the verification here once and returned
  a clean absence; the test is the list.
- **A dry run hands its item back as `released`, not `queued`** — `queued` counts as an attempt,
  and three dry runs used to mark a good item failed.
- **`--no-first-comment` used to hold for about an hour** — post.js sent none, then the watcher
  found a published post with no CTA and posted one. `comment-state.js` is shared by both.
  **It never overwrites an existing entry**, or a post really commented on would be rewritten to
  look as though it never was.
- **Media: `scripts/lib/media.js`.** `probe(file)` → duration/aspect/codec/audio;
  `check(platform, probe)` → an ARRAY of problem strings, empty when fine. Note the argument
  order and the return shape. `run-queue.js` probes once and drops any platform that would
  reject it, rather than letting the platform fail an already-claimed item.
- **`zernio media:upload` infers the content type from the FILE EXTENSION** and rejects a file
  without one. The download cache names files from a hash, so the extension has to be put back.
- **X refuses a non-AAC audio track, and only at 99% of the upload.** Opus in an MP4 is legal and
  every other platform published the same file; it gets in through yt-dlp if you constrain the
  video codec and leave `+ba` free. `check('twitter', …)` refuses it before the bytes are paid
  for.
- **TikTok settings go in `tiktokSettings` at the TOP LEVEL**, not `platformSpecificData` —
  getting it wrong is silent, because `platformSpecificData` echoes any key. Six keys, all
  required; `post.js`'s `tiktokSettings()` reads the three interaction flags off
  `accounts:tiktok-creator-info` rather than assuming them, and TikTok's live
  `maxVideoDurationSec` is **3600**, not the 600 the static table once assumed.
- **TikTok returns a publish token, not a video ID**; the numeric ID arrives with the analytics
  sync. It does carry a `platformPostUrl`, with TikTok's own `utm_campaign=tt4d_open_api` on it.
- **TIKTOK IS THE VIEW NUMBER WORTH LOOKING AT, AND THE DOCS HERE ONLY EVER RECORDED ITS GAPS.**
  Measured 2026-09-20: views, likes, comments and shares all arrive; best 647 views, typical
  180-300, against YouTube's clips at 2-3. What is missing is comments, DMs and FYP analytics —
  that is the real limit, not the numbers.
- **TikTok has NO delete API**, and neither has Instagram; everything else deletes through
  `posts:unpublish <id> --platform <p>`. Image swap on a published post = unpublish + recreate
  (`posts:edit` is text-only).
- **Everything publishes through the queue; the mirror is gone** (mate, 2026-08-20). **Do not
  reintroduce a "is a copy already over there?" check** — it existed only because Restream put
  copies somewhere we could not see. A post made outside the pipeline is handled by hand.
- **`posts:list` is the whole universe now** — it carries a pipeline post the instant it
  publishes, where `analytics:posts` lags minutes behind.

## LinkedIn reshares

- **HIS PROFILE POSTS NATIVELY; THE PAGE AND THE OTHER PROFILE REPOST IT** (since 2026-09-14,
  reversing the 2026-08-26 shape). `linkedinAccounts().native` is what `run-queue.js` posts to
  and `.reposters` is who reposts, in order — page first with his words and the tracked CTA, then
  the other profile **plain**. It ran the other way for a month: the 30-follower page held the
  native post while the two profiles holding 7,222 merely reposted, and the one under her name
  said *"Bring me something you wish your computer did."* **Words under a person's name have to
  be that person's.** `OWNER_NAME` matches his profile by display name; with his profile not
  connected the old shape applies and a test pins the fallback. EXERCISED 2026-09-14 and pinned
  by `test/reshare.test.js`.
- **`personal` is a LIST, not a `find`** — it was a `find`, so a third account connected on
  2026-08-22 was invisible to the whole pipeline. No error, one fewer repost than anybody
  expected. A test fails if it goes back.
- **`reshareComment()` composes a CTA per account** and `quoteReshare` puts it in
  `platformSpecificData.firstComment`. Failing to compose one never costs the repost, and one
  account's 422 never costs the others.
- **The reposts are STAGGERED, four hours apart** (mate, 2026-08-22) — two accounts reposting in
  the same minute reads as one person running two. Zernio holds the `scheduledFor`, so nothing
  stays running on this box. `MWK_RESHARE_LAG_MINUTES` overrides 240.
- **A repost with no commentary needs `content` OMITTED, not empty.** `queue_item.reshare` is a
  separate flag from `reshare_text` for exactly this.
- **Each repost is RECORDED on the item** (`queue_item.result`, `role: 'repost'`), which is what
  lets `resolveClipId()` name the clip behind a code minted under the page's repost. The item's
  status and note are re-sent unchanged, so `verdict()` is not re-run over the extended list.

## The dashboard

- **The deployment, the three hostnames and the Access reasoning live in `docs/playbook.md` →
  *The dashboard*** — read it there. **`web/deploy.sh` ships it from this box, never on push** —
  that one is here because it governs what you do, not what the system is.
- **Short links: `mwkshow.com/<code>`.** A click stores the code, the time and the referring
  host: **no IP, no user agent, no cookie**, which keeps a redirect out of consent territory. A
  miss redirects to `LINK_FALLBACK` rather than 404ing — a link printed in a public comment must
  never dead-end. **Why it exists:** `clicks` comes back from Facebook and once from LinkedIn;
  the other five return 0 structurally, so the first-comment mechanic had no scoreboard.
- **Snapshots over SQL projections, where the box already knows the answer.** `platforms`,
  `voice` and `pace` are computed on the box and shipped whole — rebuilding them in D1 would
  only add a way for the two to disagree. What IS a table: the queue, links, clicks, daily
  metrics and follower points, because those are written at the far end or must outlive Zernio's
  ~12-month window.
- **`ship-events.js` runs every 2 min; the cursor advances only on a 2xx**, and replays are free
  (`INSERT OR IGNORE` on a stable ULID). It sends an empty batch when idle, but at most every
  `HEARTBEAT_MS` — without that beat "nothing happened" and "the box is off" are the same
  picture.
- **The heartbeat's period must stay UNDER the dashboard's stale threshold** — 10 minutes against
  15. Two constants in two runtimes that only make sense as a pair, and each says so at the
  other.
- **`MWK_LOG_TOKEN` / `MWK_LOG_URL` live in `td-sops/apps/mwk-social.enc.env`.**

## Numbers that would otherwise lie

**The reasoning lives in the header of `web/src/pages/stats.js` — read it there, do not restate
it.** That header owns: the `OWN_ACTIONS` deduction, that "seen" is three different measurements
and can never be ranked across channels, the dead site-wide engagement rate, which columns are
comparable, the age-matching rule and its three failure modes, the three trend guards, and the
funnel's unmeasurable last stage. What is NOT there, and is why the header is trusted:

- **HIS OWN LIKE AND REPOST COME OFF EVERY POST** (mate, 2026-09-20) — 2 likes and 2 shares per
  platform-post, because no platform says who liked. **The deduction is on the PAGE, not in the
  table**: `daily_metric` still holds what the platforms said, so the raw number is recoverable.
- **A VIEW IS NOT A VIEW: YouTube changed the unit on 24 August 2026.** A YouTube views trend
  crossing that date is refused with a reason rather than drawn (`viewsUnitBlocked`). ⚠ It
  refuses the whole YouTube views trend and does NOT know about formats — Shorts had counted
  from the first frame since March 2025 and were unaffected by the change, but their trend is
  refused too.
- **THE RAW NUMBERS WERE NOT A SMALL OVERSTATEMENT.** Measured 2026-09-15, before age-matching:
  raw reach read **+495%** week on week where the matched figure was **+51%**, and views
  **+4864%** against **+238%**. And summing drops across four action columns reported **44**
  missing days where there were **11** — drops are counted once, not per metric.
- **THE SETTLE TRAIL ANSWERED "IS IT SETTLED?" AND THE ANSWER IS MOSTLY NO.** 2026-09-14, over
  1,071 rows: not settled on any platform but TikTok, and not by +7 days on four of six. That is
  why a trend read at face value lies.
- **THE SOCIAL CLICK NUMBERS EXCLUDE THE WEBSITE** (2026-09-14; mate: *"fix them"*). The two
  booking-button codes on matewishkey.com were **56 of 91** counted hits all-time and **16 of
  16** in the week the tile read "16 link clicks (people)". Also: "people reached" is *reach,
  summed* — three platforms' unique reach added up is not a count of anyone.
- **THE FUNNEL'S LAST STAGE IS UNMEASURED, NOT ZERO.** What happens inside Google's calendar is
  not instrumented and will not be. **Writing 0 there would be inventing a measurement to
  complete a picture** — "nobody booked" is his to say, "we cannot see bookings" is ours. And
  the social row is NOT a parent of the booking rows: the buttons are on his own site, so 57
  presses over 38 social clicks is not a conversion rate and the page carries no percentage
  between the stages.
- **A LINK'S CLICK COUNT IS ALL TIME AND GETS READ AS "RECENTLY"**, so `/links` carries both
  columns. ⚠ **Two nearly identical columns are a short record, not a finding** — the first
  click ever recorded is 2026-08-21. The caveat and the control that removes it once the record
  outgrows the window are on the stats funnel card, not on `/links`.

## "Are we being suppressed?" — the seed test

**A SHORT THAT UNDERPERFORMS IS ALMOST NEVER A PENALTY, AND `daily_metric_revision` CAN PROVE IT
IN ONE QUERY** (2026-09-21, mate: *"did i got a shadowban because of the content"*). YouTube gives
every Short the same small trial and then either expands it or stops. **A suppressed video does not
get its trial** — so compare the FIRST HOURS, not the lifetime number.

- The revision table is hourly and `daily_metric` attributes lifetime accrual to a publish date, so
  **on a day with exactly one YouTube post that series IS that post's accrual curve.** Check
  `post_count = 1` before reading it as one video.
- Measured on the pair that prompted the question: `faHLBwsj7OE` (1,105 views) read **17 at 3h29m**
  and **326 at 5h29m**; `7Y90aN-LQAk` (20 views) read **18 at 3h54m** and **19 at 5h54m**. Identical
  seed, opposite outcome. The trial ran and did not convert — which is what 11 of the channel's 19
  Shorts do.
- **The channel is bimodal and that is the base rate, not a symptom**: 11 Shorts under 100 views
  lifetime, 8 over 350. A low number is the mode.
- **The best control is the neighbouring post.** One breakout 19 hours earlier, same pipeline, same
  face, same edit, kills every channel-level theory without any research at all.

- **SATURATION AND "FLAGGED AS AI" ARE BOTH MEASURABLE OR REFUTABLE — do not speculate.**
  `ffmpeg -vf "fps=2,signalstats,metadata=print:file=-"` gives SATAVG/YAVG per frame; the
  20-view clip read **9.8** against the 1,105-view clip's **12.4**, and its own source file read
  9.9, so YouTube had not crushed it either. The under-performer was the *less* saturated one.
  YouTube's inauthentic-content rule is a **monetization** policy about mass-produced or templated
  uploads, not a distribution throttle, and nothing in it keys on "made with AI".
- ⚠ **The 24 August 2026 view-count change did NOT touch Shorts.** Shorts have counted from the
  first frame since March 2025; the change brought long-form and live into line. So a Shorts trend
  crossing that date is real, and `viewsUnitBlocked` is about the other formats.
- **Most "shadowban" writing online is SEO filler.** The "Visual Uniqueness filter" that several
  2026 blogs describe has no YouTube source — do not repeat it. What IS observable from this box:
  `availability`, the channel's own Shorts tab from a logged-out `yt-dlp`, and the accrual curve.
  Retention and the monetization icon are Studio-only and no API exposes them.

## Traps that cost a session

- **A TEST WITH A FIXED FIXTURE AND A RELATIVE WINDOW PASSES UNTIL A DATE, THEN LIES**
  (2026-09-21). A test asserted the stats page still calls all-time and last-30 "nearly the same
  window", off a fixture whose first click was a literal date — and went red the morning that
  date left the rolling 30 days. **The page was right and the test was stale**, which is the
  dangerous direction: the obvious reading is that the change under way broke it. Anywhere a
  test feeds a literal date into something measured against `now`, ask what happens the day it
  ages out. `test/dashboard.test.js`'s `daysAgo()` is the worked case.

- **THIS FILE WAS EMPTY ON `main` FOR AN HOUR (`beb3a41`) BECAUSE OF
  `open(p,'w').write(open(p).read()...)`.** Python opens the write handle — truncating the file —
  BEFORE it evaluates the argument, so the read sees nothing and writes nothing back, and the
  script prints its success line. `git status` then showed a clean tree because the empty file
  had been committed. **Read into a variable first, assert every anchor, write once at the end**
  — and after any scripted edit of a tracked file, `wc -l` it before committing.

- **Node's `fetch` cannot reach a Meta CDN from this box — and it looks exactly like an expired
  URL.** `ETIMEDOUT` at ~253 ms: no IPv6 route here, the AAAA record wins, and undici's Happy
  Eyeballs window is 250 ms so it never tries IPv4. Media downloads shell out to curl. If you
  must use fetch, `net.setDefaultAutoSelectFamilyAttemptTimeout(500)`. **The same trap bites the
  dashboard hostnames** — use `curl -4` when testing by hand.
- **A comment read for a video the account doesn't own returns `success` with an EMPTY LIST**,
  not an error. So "no comments" never proves "not yet commented".
- **A YOUTUBE 403 ON A COMMENT READ IS NOT PERMANENT** — comments are closed *while a stream is
  live*, and treating that as final cost two streams their CTA. `MWK_COMMENTS_403_RETRY_HOURS`
  must stay UNDER the sweep's own `--hours`, or the retry falls due after the post has left the
  window; a test pins the pair. The generalisation, learned a second time when a stale note sat
  through nine hourly runs with the comments wide open: **a `continue` that leaves state
  untouched is a decision about the NEXT run, not just this one.** Detail at `isRetryable` in
  `first-comment.js`.
- **Report every time to him in BRISBANE time** (mate, 2026-08-21). The box stays on `Etc/UTC`
  and that is correct — so `systemctl`, `journalctl` and every log stamp are UTC, and quoting one
  verbatim is ten hours wrong to him. `TZ=Australia/Brisbane date '+%H:%M %Z'`. AEST is UTC+10
  year round.

## Alerting and the box's state

- ⚠ **NOTHING ALERTS ANYBODY TODAY.** `scripts/lib/health.js` is wired — three Healthchecks
  dead-man checks, unset = no-op so a job never fails because the alerting did — but no
  `MWK_HC_*_URL` is set (checked 2026-09-21), so every `health.ping` is a no-op. The code is
  ready; the Healthchecks project is mate's account to create.
- **A RED UNIT MEANT NOTHING WHILE ONE TRANSIENT ERROR COULD PAINT IT** (#36). A post carries its
  own consecutive-run count (`__failing` in the comment state) and only `MWK_COMMENT_STUCK_RUNS`
  failures in a row go red. **A SOURCE failure is deliberately still loud on the first run**: a
  sweep that could not read a source missed posts it never saw. A post that fails its way out of
  the `--hours` window is reported once as `GONE` and dropped, because an entry nothing can retry
  would hold the unit red for ever.
- **A FLAKY OPTIONAL SOURCE TOOK THE WHOLE SWEEP DOWN, AND THE ALERT COULD NOT FIRE BECAUSE THE
  THROW CAME FIRST.** A transient 503 on the live-stream sweep exited before a single pipeline
  post was looked at, so four platforms went uncommented for an hour over a dependency none of
  them uses — and the heartbeat ping sits at the END of `main()`. `sources()` returns
  `{ results, failures }` now: `posts:list` stays fatal, the optional sweeps degrade **loudly**
  and their failure is counted, so the exit code and the heartbeat both still say a source was
  missed. **A silent skip there is the nine-streams bug exactly.**
- **A HUNG JOB IS A TIMER THAT NEVER FIRES AGAIN, AND NOTHING WOULD SAY SO.** systemd refuses to
  start a oneshot while its last run is still active, so one wedged `yt-dlp` or `ffmpeg` stops
  that job for good. Every unit carries `TimeoutStartSec` — **read the values out of
  `install-timers.sh`, not this line** — and every network subprocess carries its own. **The unit
  ceiling is the backstop, not the mechanism**: a subprocess killed by its own timeout fails one
  video; a unit killed by systemd fails the run.
- **The box's disk is not backed up, and `~/.local/state/mwk-social/` is what makes the pipeline
  idempotent** — the first-comment ledger, the cached transcripts Zernio's expired URLs can never
  re-fetch, the only backup of every description overwritten. `scripts/state-copy.sh` copies it
  to the share nightly (the share IS backed up); why, in `install-timers.sh`'s state-copy block.
  Rebuild: README → *A new box*.

## Not used, and why

- **Webhooks** would replace the hourly poll, but need a public HTTPS endpoint and detection
  still waits on the same ~90 min sync — the only gain is fewer API calls.
- **Comment-to-DM on Instagram** is verified working (`zernio automations:*`) and is the only
  clickable route out of Instagram — but it is **per post**, so `automations:create` needs
  `--platformPostId`, `--accountId`, `--profileId`, `--name` and `--dmMessage` after every IG
  publish, not one setup. **Declined by mate on 2026-08-26.** Do not re-propose without a change
  on Instagram's side.
- **Sending a STILL where a clip would go is declined** (mate, 2026-08-26, closing #27: *"no
  posting photos is fine, so do not do it"*). Two proposals died with it: swapping the LinkedIn
  clip for the branded still, and building TikTok photo posts. The finding underneath the first
  is still true and is **not** a reason to re-propose — LinkedIn video came last on impressions
  in both large 2026 studies and it is the only format we send there. **`imageOk` and the aspect
  checks stay wired** for a still HE hands us; what is declined is the pipeline choosing one.
- **Stories**: postable via API but they get no stickers/links/music (Meta limit) — post by hand.
  An Instagram story shared onward to Facebook has no API analytics on the Facebook side.
- **Native/past posts**: `analytics:posts` picks them up on a ~90 min sync. **YouTube and
  Facebook are the two platforms we sweep** (*Live streams*, above); anywhere else a post made
  outside the pipeline is handled by hand.
- **REUSING AN OLD CLIP IS DECLINED — NEW CLIPS INSTEAD** (mate, 2026-09-21: *"do not resend
  anything yet... we will add new clips instead so do not reuse"*). This closes a proposal made
  the same day off a real coverage gap, so **the gap is not a reason to re-propose it**. The
  mechanism exists and works (`queue-add.js --media-key`). **The reasoning against it is his
  supply, not the platforms**: at two a day a backfill item eats half a day's output, which is
  the Pinterest complaint again.
  - **PINTEREST IS THE ONE CARVE-OUT** (mate, same day: *"Pinterest is fine, because it was
    never there"*). A clip going somewhere it has NEVER run is not a resend, and Pinterest is
    the only platform where that is true at scale. **What he banned was the RATE, not
    Pinterest** — a pin still costs a slot and still waits for a day with nothing new.
  - ⚠ **PINTEREST HAS EARNED NOTHING YET, AND WE CANNOT SEE ALL OF IT.**
    `analytics:posts --platform pinterest` returns only some of the live pins under every
    `--source`, so `daily_metric` undercounts them (repo issue #43). **Do not quote a Pinterest
    total as if it covered the pins** — count from `queue_item.result`. It is a search surface
    that accrues over weeks, so a day proves nothing either way.
  - **A HELD ITEM CAN BE A BACKFILL NOBODY CALLED ONE.** One card queued in August and held to
    the 22nd would have published the morning after this decision, having already run on
    Instagram. **When a reuse rule lands, read the queue for what is already holding**, the same
    way a voice change has to reach what is already drafted.

## X: follows only

- **The reply pipeline is GONE, and this note stops it being rebuilt** (mate, 2026-08-23: *"Stop
  the reply idea on X, just follow ppl... keep it simple"*). Two reasons, both still true:
  **X blocked programmatic replies on 23 Feb 2026** below Enterprise (self-replies are exempt,
  which is the only reason our own thread CTA ever published); and **the supply was never
  there** — 168 tweets read across three live runs, **0 on target**.
- **MORE FOLLOWS IS NOT THE LEVER — settled, do not re-research** (mate: *"lock in, right now we
  are good with x"*). 118 follows produced at most 8 followers. **The 500-following / 0.6-ratio
  cliff everyone warns about is DEAD** — `tweepcred` returns 0 hits in the 2026
  `xai-org/x-algorithm` release (positive control on the same search: `phoenix` 102).
- **X HAS AN EXPLICIT BOOST FOR ACCOUNTS UNDER 1,000 FOLLOWERS, AND IT EXCLUDES REPLIES AND
  REPOSTS** (`home-mixer/scorers/author_cold_start.rs`). We are well under the cap, so this is
  the only discovery path that applies to us — and it is the opposite of the "reply to three
  people, do not post" advice that had just been given, which is right for building a
  relationship and wrong for being found. **An ORIGINAL post is the only shape that gets in
  front of a stranger**: a reply and a repost are disqualified by name, on top of
  `oon_retweet_reply_filter.rs` dropping an out-of-network reply from the For You candidate set.
  **The boost is a trial, not a subsidy** — it switches off at an impression threshold or an age
  limit, whichever comes first.
  - ⚠ **NONE OF THIS REPO'S NUMBERS ARE MIRRORED HERE AND NOTHING PINS THEM.** The caps, the
    thresholds and every ranking weight (`home-mixer/params/param.rs`, which multiplies
    PREDICTED probabilities rather than raw counts) are defaults in a live repo. **Re-read the
    file before quoting any of them** — this section has already carried a stale ranker claim
    for weeks, and a weight list here went out of date under the note telling you to re-read it.
- **X: THE LINK IS IN THE TWEET** (mate, 2026-08-24). It rode in a thread reply before that, and
  the deciding reason is that an out-of-network reply is partitioned out of the feed — so the
  CTA was only ever *surfaced* to existing followers. **Say that precisely**: the reply stayed
  readable to anyone who opened the root tweet; what it could not do is reach a non-follower as
  a feed item.
  - **The penalty the thread dodged is not in the ranker.** Grepped
    `has_url|url_penalty|link_penalty|contains_link|external_link`: only USER dwell-time
    features and an ads threshold. `open_link_score` is a predicted-engagement term, weighted
    **positive**. Positive control: `favorite` hits 68 files.
  - **X's "link penalty" is REPORTING, and this note has been wrong in BOTH directions.** What
    is actually known: two hand-made posts with a link got 1 impression each, on an account with
    8 followers. That is evidence of 8 followers. **Do not rebuild a mechanic on this claim
    again.**
  - **Reversing it is one word in the platform table plus the code git has** (`threadWithLink()`,
    deleted 2026-09-13 in `50d94b1`). If it comes back: `threadItems` **REPLACES the top-level
    `content`** for that platform, so the media has to ride in `threadItems[0]`.
- **X's 403s were an ACCOUNT TOGGLE, not the plan.** `PUT /v1/accounts/{id}` takes
  `xCapabilities: { analytics, inbox }`, **both default `false`**, and both 403 in a way that
  reads exactly like a plan limit. Both are on and stay on.
- **Costs, measured off `usage:stats` rather than inferred**: a URL tweet is **20c FLAT — the fee
  replaces the base charge**; a plain tweet 1.5c; a follow 1.5c; a tweet READ 0.5c. (Zernio's
  `usage:x-pricing` lists `content_create_with_url` with an empty `triggeredBy`; that metadata
  is wrong.)
- **X rate-limits follows hard**: 37 went through back to back, then a wall of 429s. Long
  backoff.
- **`config/follow.json` is what survived** — 72 handles from 937 authors, ~5% yield. **Nothing
  reads it**; it is the record so the next sweep does not re-derive the same names. People,
  never brands.

## Cross-repo

This repo is PUBLIC, so only the public connections are named here:

- **`matewishkey/mwk-og-image-generator`** (public) — the AI image studio the show builds and posts
  about, and where the brand tokens, the RedBlock mark and the fonts are read from. Its `gpt2`
  alias is `openai/gpt-image-2`, OpenAI's newest image model; Replicate is the pipe, not the
  model. **Image work for the show is not done in this repo** (mate, 2026-08-26).
- **`mergodon/matewishkey-web`** — the website. It publishes `matewishkey.com/api/content.json`
  (contract: `API.md` in that repo), which is the editorial record of the show: episodes with
  their number, chapters, outcomes and topics, and the guests with their portraits.
  **`scripts/lib/show-notes.js` reads it** (since 2026-09-20, #40) to write every episode's
  YouTube description; `rss.xml` is the other read. It is also where the brand page lives.

Connected **private** repos are named in the internal state note, not in this file. Read that note
before filing a cross-repo issue, and file with `gh issue create -R <owner>/<repo>`. Never edit
another repo directly.

## Platform gotchas — what the TABLE cannot hold

**Per-platform limits, slots and caps are `scripts/lib/platforms.js`. Read the table, never this
file** (*The platform table*, above). What is recorded here is only what has no field:

- **Facebook posts to Pages only** — personal timelines are impossible via any API. Tokens ~60
  days.
- **LinkedIn: ARTICLES AND NEWSLETTERS ARE IMPOSSIBLE**, and it is LinkedIn's limit, not
  Zernio's — long-form has never been exposed by their API. It goes in LinkedIn's web editor by
  hand, or on `matewishkey.com` with the pipeline linking to it. **Duplicate content → 422.**
  **External links suppress reach (−40–50%)**, which is the whole reason for the first-comment
  mechanic. **Documents/carousels and polls are documented and have never been tested here** —
  treat both as unproven until one publishes.
  - ⚠ **Company page video runs to 30 minutes against a personal profile's 10, and NEITHER is in
    the table** — LinkedIn has no `videoMaxSec`, so nothing checks it and a 20-minute clip would
    reach Zernio unchecked.
- **Instagram**: business account required; media mandatory; caption folds at ~125 chars; no
  delete or edit via API. **A single video IS a Reel**, and the cap was 900 in the table until a
  measurement put it at 90 — nothing over 90 s has ever been sent, so raise it only after a
  longer clip has actually published.
- **Pinterest**: every pin needs a board, and **`zernio connect:get-pinterest-boards <id>`
  answers 405** while `GET /accounts/{id}/pinterest-boards` returns the list — `post.js` uses the
  REST route and **only READS**; it throws if the account has none, and the board we use was
  created by hand. No comments, no DMs, no delete exercised. Analytics: impressions, saves,
  clicks.
- **TikTok**: `accounts:tiktok-creator-info <accountId> --mediaType <video|photo>` returns the
  live privacy options and posting limits — read it instead of guessing. API posts have their own
  daily cap; consent flags are required per post; no comments, DMs or FYP analytics via API.
- **YouTube**: vertical <3min auto-classifies as a Short; impressions and CTR exist only in
  Studio's UI, not in any API. **Shorts DO take a custom 16:9 thumbnail** — see *Thumbnails*,
  above; what cannot be set is the vertical cover in the Shorts feed.
- **PLAYLISTS CAN BE LISTED AND ASSIGNED; CREATING ONE IS DOCUMENTED AND UNEXERCISED.**
  `posts:update-metadata --playlistId` assigns and `zernio connect:get-youtube-playlists
  <accountId>` lists. The addressing is the same trick descriptions use: `{platform, videoId,
  accountId}` — **the Zernio `_id` from `analytics:posts` 404s here**, because an external video
  is not a post. `POST /v1/accounts/{accountId}/youtube-playlists` is documented; exercise it
  before telling him a playlist needs Studio.
  - ⚠ **A 404 ON THE ROUTE YOU GUESSED IS NOT AN ABSENT CAPABILITY.** `/v1/youtube/playlists`
    really does answer *"No such API endpoint"*, and the working route was under `connect:` the
    whole time. **`zernio --help | grep <thing>` before recording one as impossible** — this
    line has been wrong in both directions.
  - **The `With Guests` playlist is the UNCUT one**, and `content.json`'s `raw.url` list is the
    membership test.
  - ⚠ **An empty playlist is invisible from the public side.** `@channel/playlists` and yt-dlp
    both showed one playlist where the account had two. Do not conclude a playlist is missing
    from a logged-out read.
