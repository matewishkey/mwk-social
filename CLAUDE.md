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
- **A URL IS NOT CLICKABLE EVERYWHERE, and for three weeks this pipeline acted as though it was**
  (found 2026-08-22, on mate's instinct, and he was right). Instagram makes NOTHING clickable — not
  a caption, not a comment, not a Reel; the link-in-bio industry exists because of it. TikTok is
  the same. **YouTube deliberately makes urls in SHORTS descriptions and SHORTS comments plain
  text** (its own help page says so) while long-form is fine — this pipeline only sends YouTube the
  wide cut, and a landscape video is never a Short, so ours are live. The damage was measurable:
  five TikTok codes and five Instagram codes took **0 and 1** human clicks between them, which
  reads as "posted, nobody cared" rather than "nobody could".
- **`linkClickable: { caption, comment, profile }` is the fact; `linkPlacement` is the decision, and
  `platforms.linkProblems()` refuses to let them disagree.** A test asserts it returns empty, so
  `linkClickable` cannot become the fourth decorative field on that table after `linkPlacement`,
  `landscapeOk` and `hashtagsInCaption` each shipped declared-but-never-read.
- **`linkPlacement: 'profile'` means: say where the link is, mint nothing.** Instagram and TikTok
  only. `{show}` renders as `firstComment.profileCta` ("link in my bio") instead of a tracked code,
  and any variant carrying `{episodeUrl}` is dropped from the pool — that url is exactly as dead.
  **The phrasing MUST be in `markers[]`**, and it is: the guard finds the CTA by matching the text,
  so a comment with no url in it would otherwise be unrecognisable and the watcher would re-comment
  on every Instagram post for ever.
- **`commentWatched()` is not `linkPlacement === 'comment'`.** Instagram's link lives in the bio and
  its CTA still lives in a comment saying so. What excludes a platform from the watcher is carrying
  its CTA **inside the post** — X, in its thread reply.
- **`clip_id` was declared and never written — 0 of 55 links carried one** (found 2026-08-22 when
  mate asked whether the linking actually worked). The only route from a click back to a VIDEO was
  a `LIKE` on the `post_key` prefix: it resolved for 14 links and for none of the 25 minted outside
  the queue. Every mint now carries the queue item id as `clip_id`, the placement as `medium` and
  `clip` as the default campaign, so **click → `link.clip_id` → `queue_item.media_key`** is one
  join. `run-queue.js` is where the id comes from; a test reads `post.js` and fails if any
  `linkFor()` call omits its medium.
- **`shortsAreDead` is READ now, and a link can be dead for one CLIP and live for another.**
  YouTube turns a vertical video under three minutes into a Short, and a url in a Short's
  description or comment is plain text. `platforms.linkDeadFor(name, probe)` decides it,
  `run-queue.js` computes the list per post and `publish({ linkDead })` makes those platforms
  behave exactly like Instagram: the CTA names the bio and no code is minted. **This is the fourth
  field on that table to ship declared-but-never-read** — after `linkPlacement`, `landscapeOk` and
  `hashtagsInCaption`. Wire it or do not add it.
- **HALF THE YOUTUBE DESCRIPTIONS CARRIED A LINK NOBODY COULD CLICK** (2026-08-24, found by an
  audit he asked for, not by a test). **12 of the 24 videos on the channel are Shorts** — verified
  with a positive control, `/shorts/<id>` answers 200 for those twelve and 303s to `/watch` for the
  other twelve — and YouTube renders every url in a Short's description as plain text, deliberately.
  `yt-description.js` minted an `episode` code for all 24 regardless: `linkDeadFor()` governed the
  publish path and **never reached this file**. It does now (`tailFor()` asks `isShort()` BEFORE it
  mints), and a test pins the order — asserting both positions are present first, because `indexOf`
  returns -1 for a deleted line and `-1 < anything` passed the revert on the first attempt.
- **`voice.profileCta(platform)` — "link in my bio" is Instagram's words, not everyone's.** Under a
  YouTube Short the clickable thing is the CHANNEL (YouTube's own documented route out of a Short),
  so `firstComment.profileCtaBy.youtube` says so instead. **Every value there must also be in
  `markers[]`** and `voice.js` refuses to load a config where it is not — same rule, same reason, as
  `profileCta` itself.
- **"NO TERMINAL NEEDED" WAS FALSE AND WAS LIVE ON ALL 23 VIDEOS** (mate, 2026-08-24: *"B is
  incorrect they do need terminal lol"*). It had been in the blurb from the beginning and nothing
  caught it, because it reads exactly like the reassurance a show for beginners ought to give. The
  brand page describes the AUDIENCE as someone who *"has never opened a terminal"* — that is who
  turns up, not a promise about what the session needs, and collapsing the two is how the claim got
  written. Gone with the short blurb; a test fails if the word returns to anything we say out loud
  (`showBlurbPast` is exempt — it is the record of what WAS written, and the `blocked` tag list is a
  different thing). **Reassurance is where a false claim hides: check it against what actually
  happens on the show, not against how kind it sounds.**
- **SHORT IS THE HOUSE STYLE NOW** (mate's call, 2026-08-24: *"Keep the text simple short and
  concise, so we will not do AI issues"*). The description went 819 characters to **347** — the
  three-line brand headline, the ask, and where it is live, and nothing else. Every comment variant
  roughly halved. His reasoning is that length is what reads as machine-written, so a long correct
  paragraph loses to a short one.
- **A VARIANT CARRYING A SECOND URL IS DROPPED WHERE URLS ARE DEAD, and the test is ANY url now.**
  It keyed on `{episodeUrl}` by name, which held for exactly as long as that was the only variant
  with a link in it. The archive line (*"Every episode is online, start to finish: {episodes}"*,
  his idea) would have printed a dead `matewishkey.com/episodes/` under every Instagram post — the
  2026-08-22 mistake again, from a new direction. `CARRIES_URL` matches `{episodeUrl}`, `{episodes}`
  and a literal `http`, and a positive control (narrowing it back) fails two tests.
- **`matewishkey.com/brand` IS the voice, it MOVES, and it renders `VOICE.md` at that repo's root —
  read it, never restate it.** Checked 2026-08-24 and it had moved: the headline is now **three
  lines in that order** — *"Why let others solve your problems with AI? / Prompt it yourself! /
  Mate Wish Key is a show about curious people taking their first steps solving problems with AI,
  with a little guidance along the way."* His words for the set: *"This is the full story."* They
  are one unit and are not split. **The exclamation mark on `yourself!` is load-bearing, not
  decoration** — the page marks `AI?` and `yourself!` in red so the marked words alone carry the
  argument, and a typo-cleanup pass flattened it to a full stop within the hour. Two more rules that
  bit on the same read: **no em dashes anywhere the site speaks** (two episode variants had them),
  and the visitor-facing wishes sentence is exactly *"you can bring up to three, and you do not have
  to choose which one first"*. Still unreconciled and flagged to him, not silently changed: the page
  says **"I, never we"** while the blurb says "we build it" and "what we build".
- **EDITING THE BLURB'S PROSE RETIRES IT — push the old text to `showBlurbPast` or 23 videos get
  rebuilt.** `findBlurb()` matches the constant halves either side of `{show}`, so the wording
  *around* the slot is part of the key: the day a paragraph changes, every description already on
  the channel stops being recognised as ours and takes the model-rewriting rebuild path. Same lesson
  as the tail fix below, one layer out — that one taught it to see past the LINK in the slot, this
  one past the PROSE around it. Nothing is ever deleted from the list; a video written a year ago
  still carries the blurb of its day. A test walks every retired blurb and a positive control (the
  past list ignored) fails it.
- **`voice.findBlurb()` recognises our tail whatever went into its link slot.** The old check tested
  for two literal shapes (today's tail, and the plain-url one), so a description holding any THIRD
  shape read as "not ours" and took the full rebuild path — which would have handed him twelve
  model-rewritten summaries to re-approve the moment the dead codes came out. Matching the constant
  halves either side of `{show}` keeps every one of them a one-line swap. **Three tails now exist
  (plain, tracked, Short) and a test pins that any two differ on exactly one line.**
- **THE HOURLY WATCHER WAS THE FOURTH MINT SITE AND THE ONLY ONE NO TEST COVERED** (fixed
  2026-08-24). `first-comment.js` knew none of the link rules: it would write a live `mwkshow.com`
  code into an **Instagram** comment — the exact mistake post.js was fixed for on 2026-08-22, still
  standing on the path that exists to catch a native comment that silently failed — and it minted
  with `campaign`, `medium` and `clip_id` all null. Evidence in the table: `pgapk`, `jvssw`, `zbg4d`,
  all `created_by = pipeline`, all three columns empty. It now asks `linkIsLive()` (plus
  `linkDeadFor` for a YouTube Short), mints `campaign: 'clip', medium: 'comment'`, and passes
  `noTags` for a platform whose caption already carries them. **There is no clip id on this path** —
  it only ever sees a published post, never the queue item behind it — so `post_key` stays the join.
- **THE LINKEDIN REPOSTS CARRIED NO CTA AND NO CODE AT ALL** (fixed 2026-08-24). The company page —
  2 followers — got the tracked comment; **Mate Visky (2,152) and Zsuzsanna Elma Fay (5,040) got a
  bare repost**, so essentially the whole LinkedIn audience had no route to the sign-up page but
  clicking through to the company post and finding its comment there. `reshare.reshareComment()`
  now composes one **per account** (`campaign: 'reshare'`, `medium: 'comment'`, post key carries the
  account id) and `quoteReshare` puts it in `platformSpecificData.firstComment`, the same field and
  the same place a native post uses. Failing to compose one never costs the repost.
  **NOT YET VERIFIED LIVE** — Zernio stores any `platformSpecificData` key it is sent, so the worst
  case is the status quo, but watch the next real repost before believing it.
- **`--no-first-comment` used to hold for about an hour.** post.js correctly sent none, then the
  watcher read `posts:list`, found a published post with no CTA in its caption and none in its
  comments, and posted one — it had no way to tell a deliberate absence from the gap it exists to
  fill. `scripts/lib/comment-state.js` is now shared by both: `run-queue.js` writes a suppression
  entry keyed `<platform>:<native post id>` when the item said no. **It never overwrites an entry
  that already exists**, or a post really commented on would be rewritten to look as though it
  never was.
- **Every link carries a campaign now, and it is part of the MINT KEY.** `link` gained `campaign`,
  `medium`, `created_by` and `note`. Same destination from the bio and from a reply = two
  codes, or "which one earned this" has no answer — which is the state every link minted before
  2026-08-22 was in: 40 codes, all pointing at `matewishkey.com/show`, no campaign dimension at all.
  `medium` is the *placement* (`profile`/`caption`/`comment`/`reply`), `platform` is the source.
- **The redirect hands NOTHING to the destination — no `utm_`, no cookie, no banner** (mate's call,
  2026-08-22: keep it slim). A `utm` column existed for about an hour and was dropped; an earlier
  note here described the appending behaviour as if it shipped, which it never did. The code
  already carries platform, placement and campaign, so a utm would count the same click twice in
  somebody else's system. `web/src/links.js` passes the target through byte for byte and a test
  fails if a utm parameter is ever added back.
- **THE REPOINT WORKED, AND THIS IS THE EVIDENCE** (2026-08-24, the day after the codes went in).
  Mate replaced both 15-minute booking calendars. Both short codes were repointed in one `UPDATE`
  and **the website was not touched** — the five links on `/show` kept working through the change.
  That is the entire argument for the shortener over pasting destinations directly, and it is no
  longer theoretical.
- **A booking code is bound by PURPOSE, not by destination** — `manual:pretalk-public` and
  `manual:pretalk-private`. `target` is part of the mint key, so a code identified only by where it
  points stops being findable the moment it is repointed, and the next mint would quietly make a
  second one. Bind anything whose destination can move.
- **Public vs private is `MWK: Public Show pre-talk` against `MWK: Private coaching pre-talk`**, and
  the mapping was confirmed by fetching each calendar and reading its own title rather than trusting
  the order they arrived in. `30zc4` is public (hero + the free-show tier), `g9q8j` is private (the
  one-to-one and team tiers).
- **A PROFILE LINK NAMES ITS ACCOUNT, OR IT IS USELESS** (2026-08-24, and mate found it, not a
  test). Nine bio codes were labelled `linkedin bio` and `facebook bio` — with three LinkedIn
  accounts connected and Facebook posting only to Pages, neither label answered the only question
  that matters: **which one?** His words: *"these are confusings it has to be correctly
  generaterated."* Every bio code now carries `post_key = 'account:<zernio account id>'` and a
  label naming the account and what KIND of thing it is — `LinkedIn — Mate Wish Key (COMPANY page)`
  against `LinkedIn — Mate Visky (personal profile)`.
- **So a new bio code MUST pass a `postKey` naming the profile, and this is now load-bearing.**
  `postKey` is part of the mint key, so minting one without it will NOT match the existing row and
  will quietly create a second code for the same profile — one in his bio, one collecting nothing.
  Two forms, and both are in use: **`account:<zernio id>`** for a profile the pipeline is connected
  to (resolve the id from `accounts:list`, never type one, and never put one in this file — the
  repo is public), and **`manual:<slug>`** for a profile it is not, which is how his own personal
  Facebook profile gets a link (`manual:facebook-personal`). Anywhere he pastes a link by hand and
  we have no account for takes the `manual:` form.
- **Which account is which, verified 2026-08-24 against `accounts:follower-stats`, not assumed:**
  LinkedIn has THREE — `Mate Wish Key` is the company page (2 followers), `Mate Visky` (2,152) and
  `Zsuzsanna Elma Fay` (5,040) are personal. Facebook has ONE and it is a **Page**
  (`facebook.com/matewishkey`, 93) — a personal timeline is impossible through any Meta API, so
  there is nothing to confuse it with on our side, but the label says "PAGE" anyway because he
  asked the question.
- **`/links` on the dashboard is the database, and it can mint by hand.** That was the actual gap:
  a link could only be created as a side effect of publishing, so anything he pastes somewhere
  himself — a bio, a newsletter, a talk — had to be a raw url and was invisible. The seven
  `campaign = bio` codes are the ones Instagram and TikTok now point at, so they are the whole
  conversion path on both.
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
- **`reshare.quoteReshare()` takes an account argument, but "adding an account is a connection job,
  never a code change" WAS WRONG** — an earlier note here said exactly that, and a third LinkedIn
  account connected on 2026-08-22 proved it. `linkedinAccounts().personal` was
  `all.find(a => a !== company)`: **`find` where it needed `filter`**, so the new account was
  invisible to the whole pipeline the moment it arrived. No error, no warning, one fewer repost
  than anybody expected. `personal` is a LIST now, `reshare.reshareAll()` reposts from every one of
  them, and a test fails if it ever goes back to `find` (verified with a positive control — the
  revert fails six tests).
- **The two personal reshares are STAGGERED, four hours apart** (mate's call, 2026-08-22: "keep them
  out of sync... let's have some wait time"). Two accounts reposting the same thing in the same
  minute reads as one person running two accounts, which is what it is. The first goes now, each
  one after it gets `scheduledFor` — **Zernio holds it**, so nothing has to stay running on this
  box. `MWK_RESHARE_LAG_MINUTES` overrides the 240.
- **Each reshare is caught for itself, and the lookup is caught too.** One account's 422 or expired
  token must not cost the reposts from the others, and none of it may turn an already-published
  post into a failed one. Same rule as the publish groups, learned the same expensive way.
- **A LinkedIn account other than the company page is NEVER posted to natively** — `run-queue.js`
  filters them out before publishing. They only ever repost what the company page published. That
  filter keys off the company account, so it keeps working as personals are added.
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
- **UNCHANGED IS NOT THE SAME AS CURRENT, and conflating them froze every description**
  (2026-08-24, found because mate asked whether anything was missing — no test caught it).
  `yt-description.js` opened its loop with `alreadyWritten.get(id) === existing.trim()` and skipped
  **before `build()` was ever reached**, so no change to the constant tail could land on a video
  that already had one: the per-episode link added the day before would have reached **2 videos out
  of 23**. Measured: 2 proposals before the fix, 21 after. It also keyed off the wrong set —
  `applied` only holds videos that went through the approval flow, and most were auto-filled while
  empty, so they were never in it. **The tail itself is the honest test**: if the text carries it,
  we wrote it, whichever route it took. Same disease `RULES_VERSION` cures in `topic-tags.js`, in a
  second place — so when adding anything to the constant part of a generated artefact, ask how it
  reaches the ones already written.
- **A stale tail is SWAPPED, never rebuilt.** `build()` regenerates the opening with a model, so
  rebuilding would hand him 21 rewritten summaries to re-approve — words he already said yes to,
  changed for no reason he asked for. When only the tail is out of date it is replaced in place: no
  transcript, no model call, and the diff is one line. **Two tests pin what makes that safe** — the
  plain and tracked blurbs must differ on exactly ONE line, or the "one-line change" the dashboard
  shows him is a lie.
- **The show-notes loop did not converge**: `build()` regenerates the opening with a model every
  run, so an applied description never matches byte for byte and immediately re-proposed itself.
  `/youtube/pending` returns what was last WRITTEN as well as what is approved, and a video already
  carrying exactly that is skipped. The upsert's `WHERE state = 'proposed'` was hiding the churn at
  the database level while the work still happened every run.
- **TikTok takes the CTA in the CAPTION, and `post.js` now actually does it.** The platform table
  declared `linkPlacement: 'caption'` from the start but nothing ever acted on it, so posts there
  went out with his words alone — no route to the sign-up page and nothing measurable. **A platform
  carrying its own link cannot share a request with the comment platforms** (one body, one
  caption), so publish() sends one request for the comment group and one per platform that mints
  its own short code — they need different captions anyway, since X's tag cap is 1 against TikTok's
  none. His words stay first and untouched; link and tags are appended. X was in this group until
  2026-08-21 and now takes its link in a thread reply instead — see below.
- **`platforms.commentWatched(name)` is the ONE definition of "the hourly watcher covers this",
  and it is two conditions, not one:** a comments API *and* `linkPlacement === 'comment'`. X has
  a comments API now and is still not watched, because its CTA ships with the post as a thread
  reply. post.js has printed "the watcher adds it" about a platform it cannot reach **twice** —
  first keyed off `!linkInCaption`, then off `commentsApi` alone — so it is now derived from one
  function, and a test pins `first-comment.js`'s hand-written `ALL_PLATFORMS` to exactly that set.
  **Verified with a positive control both times:** adding `twitter` to that list fails the suite.
- **X's 403s were an ACCOUNT TOGGLE, not the plan — everything we wrote off as impossible on X
  was one PUT away** (2026-08-22, and this is the correction that matters most on this page).
  `PUT /v1/accounts/{id}` takes `xCapabilities: { analytics, inbox }`, **both default `false`**
  because each meters X API cost. Off, they 403 with `X_ANALYTICS_NOT_ENABLED` /
  `X_INBOX_NOT_ENABLED` — which reads exactly like a plan limit and is not one. Both are on now.
  What they unlock:
  - **`GET /v1/twitter/search`** (needs `analytics`) — public tweets from the last 7 days, X's
    own search operators passed through (`from:`, `-is:retweet`, `lang:en`, `OR`). Its own docs
    say "e.g. to discover tweets to reply to". 300 req / 15 min per account. **Verified live.**
  - **`GET/POST /v1/inbox/comments/{id}`** on X (needs `inbox`) — returned `success` with an
    empty list on a real published tweet the moment the toggle flipped. **Verified live.**
  - **`POST /v1/twitter/follow|unfollow|retweet|bookmark`** (`twitterengagement:*` in the CLI)
    were never gated. Follow takes `targetUserId`, the NUMERIC X id, not the handle.
    **X rate-limits follows hard**: 37 went through back to back, then a solid wall of 429s.
    Retry with a long backoff, do not hammer it.
- **X: the link goes in a THREAD REPLY, not the post and not a comment** (changed 2026-08-21).
  A comments API exists again, but the CTA still does NOT go through the watcher: it is published
  with the post as `platformSpecificData.threadItems`, and a watcher comment on top would be the
  same link twice under one tweet. `platformSpecificData.threadItems` publishes a
  root tweet plus its replies in one call, which gets the link out of the tweet that has to
  travel. `linkPlacement: 'reply'` is the third value that field takes; only X uses it.
  **threadItems REPLACES the top-level `content` for that platform** — the caption is published as
  `threadItems[0]`, so the media has to ride there too, and a `content` left at the top level is
  used for display and search only. It lives in `platformSpecificData` **on the PlatformTarget**,
  same place as `firstComment`, not at the top level of the body.
- **X's link penalty is REDUCED by Premium, not removed — an older note here said otherwise and was
  wrong** (corrected 2026-08-21 against current reporting). X deprioritises a post carrying an
  external link to keep people on-platform; non-Premium link posts are effectively invisible,
  Premium ones get a fraction of normal engagement. **Every X post made before 2026-08-21 carried
  the CTA in its caption and was therefore in the penalised class** — including the two mate posted
  by hand from the app, both of which got 1 impression.
- **A URL tweet costs 20c FLAT — the fee replaces the base charge, it does not add to it.**
  Measured off `usage:stats`, not inferred: `content_create: 2` + `content_create_with_url: 5`
  came to `xSpendCents: 103`, and 2 × 1.5 + 5 × 20 = 103 exactly. Re-measured after 37 follows
  and one search: `+ posts_read: 11 + user_interaction_create: 37` → `164`, and
  2×1.5 + 11×0.5 + 5×20 + 37×1.5 = 164 exactly. **So a follow is 1.5c and a tweet READ is 0.5c** —
  a reply-finding run that reads 30 tweets costs 15c, about $4.50 a month daily. So a clean root plus a link
  reply is **21.5c against 20c** — 1.5c to get the root tweet out of the penalised class, which
  is why the thread won. (Zernio's `usage:x-pricing` lists `content_create_with_url` with an empty
  `triggeredBy`; that metadata is wrong — the operation does fire.)
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

- **The queue is OURS, not Zernio's, and that was reviewed rather than assumed** (2026-08-21).
  Zernio's `/v1/queue/*` is a recurring *timetable* per profile; ours is a rate limit across
  accounts that span two profiles, for posts that are up to four Zernio requests each. The full
  reasoning, and the parallel finding that the publisher cannot move into the Worker (ffprobe,
  ffmpeg and Whisper are binaries), is in `docs/playbook.md` — read it before proposing either
  again.
- **The heartbeat's period must stay UNDER the dashboard's stale threshold.** `ship-events.js`
  beats every 10 minutes; `overview.js` calls the box stale at 15. They were both 15, so on a quiet
  box the beat always landed just after the page had given up and the tile flickered red for
  nothing. Two constants in two runtimes that only make sense as a pair — change one, look at the
  other.
- **An item that has put ANYTHING live is never queued again** (2026-08-21, learned expensively).
  `run-queue.js` publishes in groups — one request per distinct caption — and a throw in any group
  used to unwind the whole run and put the item back as `queued`. X's media upload failed at 99%
  after Facebook, LinkedIn, YouTube, Threads and TikTok had all published; the next tick reposted
  everything, three times over before it was stopped by hand. Each group is now caught where it
  happens, and `verdict()` returns `posted` with the failures named whenever anything is live.
  **A retry after a partial publish is a human's decision, not the code's.**
- **TikTok has NO delete API** — `posts:unpublish` returns "TikTok does not support post deletion
  via API" (verified 2026-08-21 against two real duplicates). The playbook said `yes` for two
  weeks. TikTok and Instagram are both manual-only for deletion; every other platform we post to
  deletes cleanly through `posts:unpublish <id> --platform <p>`.
- **X refuses a non-AAC audio track, and only at 99% of the upload** (root-caused 2026-08-21).
  `Twitter media upload failed: … {"progress_percent":99,"state":"failed"}` on a clip whose audio
  was **Opus**. Opus in an MP4 is legal and Facebook, LinkedIn, YouTube, TikTok and Threads all
  published the same file; every clip X has accepted was AAC. It got in through yt-dlp: constrain
  the video codec and leave `+ba` free and you get YouTube's best audio, which is Opus — the AV1
  trap one stream down. `media.js` now reports `audioCodec` and `check('twitter', …)` refuses a
  non-AAC track up front, so the platform is dropped before the bytes are paid for.
- **Report every time to him in BRISBANE time** (mate's call, 2026-08-21, scoped to this project).
  The box stays on `Etc/UTC` — that is correct and is not to be changed — so `systemctl`,
  `journalctl` and every log stamp are UTC and quoting one verbatim is ten hours wrong to him.
  Convert as you write: `TZ=Australia/Brisbane date '+%H:%M %Z'`. The dashboard already renders
  Brisbane (`TZ_DISPLAY`), so a time read off the page needs nothing done to it. AEST is UTC+10
  year round — Queensland has no DST, so the offset never moves.
- **"Post it" means QUEUE it. Only publish when he says publish** (mate's call, 2026-08-21). He
  reviews on the dashboard and releases it himself; an item that went straight out took that
  choice away from him. So the default action for any content request is a `queue_item`, and
  `run-queue.js --now` or a direct `post.js` run needs him to have asked for it in those words.
- **There is no time-of-day posting window** (mate's call, 2026-08-21) — his reasoning: the
  audience is spread across timezones and someone in the US reads a post later regardless, so
  holding one for a "good hour" only delays it. `lib/pace.js` still caps the day and spaces posts
  ninety minutes apart; the day boundary is still the audience's timezone, or the cap would reset
  twelve hours early against a UTC box.
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
  OTP, allow-list of two addresses — named in the internal state note, not here), `ingest.matewishkey.com` (bearer token) and
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

## X: follows only (2026-08-23)

- **The reply pipeline is GONE, and this is the note that stops it being rebuilt.** Mate's call:
  *"Stop the reply idea on X, just follow ppl, and we will see how it goes... keep it simple."*
  Deleted with it: `scripts/replies.js`, `scripts/lib/replies.js`, `scripts/lib/typos.js`,
  `config/replies.json`, `web/src/pages/replies.js`, the `/replies/*` ingest endpoints, the
  `reply_target` table and the `mwk-replies` timer. **Do not propose it again** without a change on
  X's side — the two reasons below are both still true.
- **X blocked programmatic replies on 23 February 2026**, on every plan below Enterprise:
  `POST /2/tweets` only replies if the original author has @mentioned or quoted you first. Zernio
  surfaces it as a 207. **Self-replies are exempt, which is why our own thread CTA still publishes**
  — that carve-out is the only reason X posting works at all.
- **The supply was never there either, and that was measured, not guessed**: 168 tweets read across
  three live runs, **0 on target**. Broad queries collide with X's own jargon ("receipts" is read
  receipts, "quotes" is quote tweets); tight queries returned marketers using the exact language of
  the problem; the reply sections of six large accounts gave 100 replies, 96 noise, 4 promo, 0
  usable. The people this show is for are not on X phrasing problems in searchable ways.
- **`config/follow.json` is what survived** — 72 handles found by reading 937 authors across three
  discovery sweeps, at about a 5% yield. **Nothing reads it**; it is the record, so the next sweep
  does not re-derive the same names and re-follow people already followed. People, never brands —
  a brand account posts marketing by definition, and a follow is a public statement about what this
  account is.
- **A follow is 1.5c and `POST /v1/twitter/follow` takes the NUMERIC X id, not the handle.**
  X rate-limits follows hard: 37 went through back to back, then a solid wall of 429s. Long backoff,
  do not hammer it.
- **`xCapabilities: { analytics, inbox }` on `PUT /v1/accounts/{id}` stay ON.** They are what
  `GET /v1/twitter/search` and the X comment endpoints need, both default `false`, and both 403 in a
  way that reads exactly like a plan limit and is not one.
- **MORE FOLLOWS IS NOT THE LEVER — settled 2026-08-23, do not re-research this.** Mate: *"lock in,
  right now we are good with x."* The whole X question was taken to the source code and closed. What
  we hold: 8 followers, 118 following, 11 tweets, account opened 11 August. 118 follows produced at
  most 8 followers — **6.8%, a ceiling not a measurement**, since attributing them needs a paid
  follower-list read. Industry average is ~13.7%.
- **The 500-following / 0.6-ratio cliff everyone warns about is DEAD, and believing it is the common
  mistake.** It was real — `UserMass.scala` in the 2023 repo divided reputation by
  `exp(5 × (ratio − 0.6))` once you passed 500 follows. **X open-sourced a new algorithm in January
  2026 (`xai-org/x-algorithm`) and `tweepcred` returns 0 hits in it.** Verified with a positive
  control on the same search: `phoenix` 102, `follower` 96. There is no mechanical penalty left.
- **What replaced it is a language model reading your profile as prose**, so there is no threshold to
  game and nowhere to hide. `grox/core/lm/user.py` renders `Account Created`, `Followers`,
  `Following` and `Subscription` as literal text for Grok. A 118/8 line reads as what it is. Roughly
  half the For You feed is out-of-network, so followers were never the distribution mechanism.
- **The real gap is CADENCE, and it is the one free lever: we post to X ~1.5×/day against the 3–5
  every guide converges on.** That needs no new code — it is the queue's pacing.
- **If we ever do want more people, the follower lists of the 72 we already follow beat X's own
  search, on cost and on aim.** Apify's `data-slayer/twitter-followers` is **$1.50/1,000 profiles,
  no login, no API key** — 0.15c a person against X's 0.5c per *tweet* returned — and everyone
  following a designer is a designer, where a keyword search returns whoever typed the word.
  Followerwonk/Circleboom/Fedica do bio search free in a browser. **Not started, deliberately.**
- **Keep the room in mind before spending anything more here**: 0 usable posts out of 168 measured,
  Facebook has 91 followers to X's 8, and LinkedIn 7,190 across the two accounts.

## Skills

Procedures live in `.claude/skills/`, not in this file — a skill loads when the work calls for it,
where everything here loads every session whether it is relevant or not.

- **`mwk-status`** — where the pipeline stands: unpushed work, the five timers, the queue and the
  pace, account health, what is waiting on mate. The sweep every restart starts with.
- **`mwk-post`** — his words or a clip to a queued post: the voice, the hashtag rule, the media
  checks, `scripts/queue-add.js`, and what will actually happen once it is in.

**When a rule here turns out to be one a skill enforces, move it into the skill and leave this file
pointing at it.** Two copies of a rule is how one of them drifts.

## Cross-repo

This repo is PUBLIC, so only the public connections are named here:

- **`matewishkey/mwk-og-image-generator`** (public) — the AI image studio the show builds and posts
  about; it produces the OG cards used in posts.

Connected **private** repos are named in the internal state note, not in this file — naming them
here would publish their existence. Read that note before filing a cross-repo issue, and file with
`gh issue create -R <owner>/<repo>`. Never edit another repo directly.

## Platform gotchas (verified against docs.zernio.com)

- **Facebook posts to Pages only** — personal timelines are impossible via any API (Meta rule).
  Tokens ~60 days; watch `accounts:health`.
- **LinkedIn: ARTICLES AND NEWSLETTERS ARE IMPOSSIBLE, and it is LinkedIn's limit, not Zernio's.**
  Long-form (`linkedin.com/article/new/`) has never been exposed by the LinkedIn API, so no tool can
  do it — Zernio's own docs list it under "What You Can't Do". Long-form goes in LinkedIn's web
  editor by hand, or on `matewishkey.com` with the pipeline posting a link to it. Verified against
  the docs and independently, 2026-08-24.
- **Company page video runs to 30 minutes against a personal profile's 10.** Text limits are the
  same on both. **Documents/carousels and polls are DOCUMENTED as supported and have never been
  tested here** — a third-party source claims the API does not carry them, so treat both as unproven
  until one actually publishes. This repo has shipped four declared-but-never-read platform fields;
  do not add a fifth by trusting a table.
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
