---
name: mwk-post
description: Turn mate's words or a clip into a queued MWK post — his voice kept intact, hashtags in everyday language, media checked against every platform, queued rather than published. Use whenever he says post/share/put this out, gives a clip or screenshot to post, or asks for caption options.
---

# mwk-post — his words, checked, queued

## The rule that comes before everything

**"Post it" means QUEUE it** (mate, 2026-08-21). He reviews on the dashboard and the pace
releases it. Publishing straight out takes that last look away from him — and Instagram cannot
delete or edit anything through the API, so a premature publish is permanent.

Publish directly (`run-queue.js --now`, `scripts/post.js`, `lib/reshare.js`) **only when he has
said publish in those words.**

## 1. The words are his

Never write marketing copy. When he dictates, his dictation IS the post — copy it across, fix
nothing but a typo.

When he asks for options, or says "add small wording", write plainly in his register: first
person, the viewer as the subject, ordinary language. Never "expert", "teacher", "free",
"guaranteed" or "safe", and never a claim that anyone became a developer. `matewishkey.com/brand`
is the authority — **read it, it moves** — and its rules are recorded beside the text in
`config/voice.json`.

**When there is media and no dictation, draft the dullest honest version and QUEUE it** (mate,
2026-08-24: *"The accountability is still on your side"*). The queue is the review gate; an
unqueued post is a stall, not caution. Say the words are yours and easy to replace, and offer
alternatives underneath rather than in front of him. Never PUBLISH words he has not seen — that
is what queueing protects.

A still picture rather than a clip: `mwk-image`.

## 2. The hashtags are for normal humans, never for tech people

Mate's call, 2026-08-21, absolute. His words: *"#xero is well known, #cloudflare is not at all."*

**The test for every tag: would someone who does NOT work in technology already know this word and
use it themselves?** If they would have to look it up, it is wrong.

- Name the everyday thing — the job (`#Invoicing`, `#Bookkeeping`), the tool people already use by
  name (`#Xero`, `#Canva`, `#Dropbox`), or the problem they recognise (`#LatePayments`,
  `#ComputerProblems`).
- A product name is fine when ordinary people know the product. `#Xero` yes, `#Cloudflare` no.
  That distinction is the rule, not an exception to it.
- **Fewer good tags beat more weak ones, and none is an acceptable answer.**
- `#MWKShow #PIY` lead every post automatically. Do not add them by hand.

`config/voice.json`'s `blocked` list is the hard backstop — check a candidate against it before
proposing it:

```sh
node -e 'const v=require("./config/voice.json");
  for (const t of process.argv.slice(1))
    console.log(v.tags.blocked.includes(t.replace(/^#/,"").toLowerCase()) ? "BLOCKED "+t : "ok "+t)' \
  '#ComputerProblems' '#Debugging'
```

Omit `--topics` entirely to let the watcher derive them from the clip's own transcript instead.

## 3. The media has to survive every platform it is aimed at

```sh
node -e 'const m=require("./scripts/lib/media");const p=m.probe(process.argv[1]);
  console.log(JSON.stringify(p));
  for (const pl of ["facebook","instagram","youtube","linkedin","tiktok","threads","twitter"])
    console.log(pl, JSON.stringify(m.check(pl,p)))' /path/to/clip.mp4
```

An empty array is a pass. `check()` returns an ARRAY of problems, and the argument order is
`(platform, probe)` — both are easy to get backwards.

Pulling a clip off YouTube, two traps that bite every time:

```sh
yt-dlp -q --no-warnings --no-playlist --force-ipv4 --merge-output-format mp4 \
  -f 'bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1]/b[ext=mp4]/b' \
  -o clip 'https://www.youtube.com/watch?v=<id>'
```

That is the same format string `lib/media.js` uses — copy it, do not shorten it. **Constrain BOTH
streams.** Three ways it bites:

- It **appends its own extension** (ask for `clip`, get `clip.mp4` — reading that as "downloaded
  nothing" has happened).
- It **serves AV1 video by default**, which Instagram and TikTok reject.
- It serves **Opus audio** by default, and `+ba` on its own takes it. Facebook, LinkedIn, YouTube,
  TikTok and Threads all publish Opus-in-MP4 without complaint; **X uploads the entire file and
  then fails at 99%** with "media processing failed". `+ba[ext=m4a]` is what gets AAC. This one
  cost a post on 2026-08-21 — the shortened format string in this file is how it got in.

Images: aspect must be 0.75–1.91:1 and **exactly 1.91 is rejected** (float edge, bitten live).
Pad with the screenshot's own background colour — never crop.

**One VIDEO per post on every platform** (several STILLS do ride together — `mwk-image` §5).
A vertical and a landscape cut are two posts, or one
item with `--media-wide`.

## 4. Queue it

```sh
./scripts/with-secrets.sh node scripts/queue-add.js \
  --body-file words.txt --media clip.mp4 \
  --platforms facebook,youtube,linkedin,tiktok,threads,twitter \
  --topics ComputerProblems,CopyPaste
```

`--dry-run` prints the SQL and writes nothing; `--help` prints the usage. Leaving `--platforms`
off means "wherever it fits". Local media goes to R2; a URL is stored as-is.

Before choosing platforms, **check whether the clip has run there before** — `posts:list` is the
whole universe of what this pipeline has sent. Do NOT reintroduce an "is a copy already over
there?" sweep across `analytics:posts --source external`; that existed only for the retired mirror
and the playbook says so. Instagram and TikTok are the ones to be careful with: **neither can be
deleted through the API**, so a repeat inside a fortnight is permanent.

## 5. Say what will actually happen

- The pace releases it: six a day, ninety minutes apart, **no time-of-day window**.
- The CTA lands as a first comment on Facebook, Instagram, LinkedIn, YouTube (natively at publish)
  and Threads (the hourly watcher).
- **X takes the link IN THE TWEET** (changed 2026-08-24). It rode in a thread reply for three days;
  an out-of-network reply never reaches the For You feed, so that CTA only reached existing
  followers, and the demotion it was dodging is not in X's open-sourced ranker. One tweet is 20c.
- **Instagram and TikTok get NO LINK AT ALL** — a url is plain text on both, in a caption and in a
  comment alike. Their CTA says "link in my bio" and mints nothing. The bio link is the tracked one.
- **Never say the watcher will pick up TikTok or X. It cannot.** `platforms.commentWatched()` is the
  one definition of what it covers: Instagram, Threads, Facebook, YouTube, LinkedIn.
- Tags go in the caption **or** the comment, never both. **The 5-cap is Instagram's; "caption and
  comments count together" is NOT** — that claim traces to marketing blogs and was retracted
  2026-08-24. The behaviour stays because never spending the budget twice is free.
- **Every code minted carries the queue item id**, so a click answers "which platform, which
  placement, which video" on `/links`. Nothing to do by hand; `run-queue.js` passes it down.
- **A LinkedIn post is three posts and three codes**: the company page publishes it, then every
  personal profile reposts that — staggered four hours apart, each with **its own** tracked CTA
  comment. The company page has 2 followers and the personals hold 7,192, so a repost with no link
  was most of the audience with nowhere to go (fixed 2026-08-24).
- **A vertical clip under three minutes sent to YouTube is a SHORT, and a url in a Short is plain
  text** — description and comment alike. `run-queue.js` works this out per clip and the CTA names
  the channel instead of spending a code. The pipeline only sends YouTube the wide cut, so this
  normally does not arise; it matters if you ever route the tall one there.
- **`--no-first-comment` means it now.** The publisher records the decision where the hourly watcher
  looks, so the flag is not just a one-hour delay any more.

Then give him the caption, the platforms, when it goes, and
https://social.matewishkey.com/queue — where he can cancel or bump it.
