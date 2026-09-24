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

**EVERY POST IS AN INVITATION TO THE SHOW, SO IT ENDS ON THE LINE** (mate, 2026-09-14:
*"the end is always prompt it yourself right? ... the idea is really to invite folks to the
show"*). A drafted caption lands on **Prompt it yourself!** The exclamation mark is part of it
(`matewishkey.com/brand`: *"yourself! takes it in the answer"*), and the wording is the site's,
never a paraphrase — read it off the live page rather than typing it from memory.

- **The pair is the full form**: *Why let others solve your problems with AI?* then *Prompt it
  yourself!* Use both where the caption has not already asked the question. Where the clip asks
  it out loud, the answer alone is right and repeating it is padding.
- **DO NOT ASK ANYONE TO COME** (mate, 2026-09-22). He renamed `/show` to *Apply to be a
  guest* and killed the begging register: *"stop using the beg to come, just mention the site,
  that's it"*. **Prompt it yourself!** still ends a caption — that is the argument, not a plea —
  but *"come to the show"*, *"bring me yours"* and *"yours could be next"* are gone. A line
  states something true and then names the site. Applying is the site's own frame and is the
  opposite of begging: he picks every guest.
- **THE FIRST COMMENT IS JUST THE LINK** (mate, 2026-09-22: *"we do not have to ask a question
  just the link... if they do not want to come i do not care"*). The url and the topic tags,
  one variant, no rotation to think about. Do not write him comment options — there is nothing
  to choose. The CAPTION is where his voice goes, and it still ends on the line.
- **"Invite" is not "teach", and the brand page bans the second one outright** (*"Never position
  him as the expert, the teacher"*). The post says the thing is doable and where to come; it does
  not run a lesson. The goal is *"to create curiosity, not to prove that somebody became a
  developer"*.
- **This is a caption rule, not a comment rule.** Since 2026-09-22 the first comment is the
  link and the tags and carries no prose at all, so it cannot collide with a caption line. Only
  X puts a CTA in the post itself, and there it is the bare url.
- **It was missed once, on a clip that WAS the argument.** A 28s clip about people selling
  themselves as AI experts went out ending *"Worth knowing before the invoice turns up."*
  Diagnosing the problem is not the post; the answer is.

## 1b. A SHORT GETS THE TITLE LINE AND NOTHING ELSE OF HIS

Mate, 2026-09-22: *"the text what you are sending is overlaying my captions, so it can take too
much space... keep the title and the hashtags, keep it super short, to drive them into the video.
It is only rules for the shorts, and not for the comments."*

A short-form player prints the caption ON the video, over the subtitles he burns into every clip.
**TikTok, Instagram, Facebook and YouTube** do that to a vertical clip under three minutes; the
publisher works it out per platform and per clip (`platforms.captionOverlaysShortFor`), so there
is nothing to switch on. What it needs from the DRAFT is one thing:

- **Write the body title-first.** Line one has to stand alone, because on those four it is the
  whole caption. The story goes underneath, for LinkedIn, Threads, X and Pinterest.
- **A credit goes on its own line, bare, and is published LAST.** A line that is ONLY
  `@mentions` and `#tags` is lifted out of the body and composed after our hashtags, on every
  platform — his brand tags lead, whoever else is tagged (mate, 2026-09-22: *"put my tags first
  not chris one"*). It survives onto a short; a sentence does not, so write
  `@thechrisgoor #couchtocreator` and never `Thanks @thechrisgoor #couchtocreator`. Tagging
  somebody is worth most on Instagram and TikTok, which are shorts.
- **Line one is also the YouTube title** (capped at 100, refused at queue time) and the Pinterest
  pin title. One line, three jobs.
- **The invitation still has to land somewhere he can read it.** On Instagram, Facebook and
  YouTube the first comment carries the full CTA, untouched — he excluded comments by name.
  **TikTok has no comment path at all**, so if the line is to reach a TikTok viewer it has to be
  in the title itself.
- `queue-add.js` prints which platforms are getting the title alone, on the `queued` line. Read it
  back to him rather than describing the post as if every platform got all of it.

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
- `#mwkshow #piy #promptityourself` lead every post automatically, show or PIY alike (his order,
  2026-09-24; he typed `#pyi` once, read as `#piy`). Do not add them by hand. They take three of
  Instagram's five, all of Pinterest's three, and the one tag X and Threads get — so a topic tag
  reaches Instagram twice over at most.
- **A PIY short is queued with `--piy <slug>`** (2026-09-24): it points at
  `promptityourself.com/prompts/<slug>` and connects the number THE PAGE prints (`piy.show/005`), shown on the
  `queued` block so it can go on the video. One number per prompt page, printed in every comment
  even where nothing is clickable, because it is typed. **Which shorts are PIY is his to say.**
- **No credit line unless he asks for one on THAT post.** The `@thechrisgoor #couchtocreator`
  example above is the shape, not a default: he stopped it on 2026-09-22 (*"you can stop
  posting to chris tag, so remove them"*).

`config/voice.json`'s `blocked` list is the hard backstop — check a candidate against it before
proposing it:

```sh
node -e 'const v=require("./config/voice.json");
  for (const t of process.argv.slice(1))
    console.log(v.tags.blocked.includes(t.replace(/^#/,"").toLowerCase()) ? "BLOCKED "+t : "ok "+t)' \
  '#ComputerProblems' '#Debugging'
```

**ALWAYS pass `--topics`.** The watcher only reaches a post with NO comment yet, and a pipeline
post already has one — so omitting them means no topic tags anywhere, permanently.
That went out to five platforms on 2026-09-13 and none of them can be edited.

## 3. The media has to survive every platform it is aimed at

```sh
node -e 'const m=require("./scripts/lib/media");const p=m.probe(process.argv[1]);
  console.log(JSON.stringify(p));
  for (const pl of ["facebook","instagram","youtube","linkedin","tiktok","threads","twitter","pinterest"])
    console.log(pl, JSON.stringify(m.check(pl,p)))' /path/to/clip.mp4
```

An empty array is a pass. `check()` returns an ARRAY of problems, and the argument order is
`(platform, probe)` — both are easy to get backwards.

**WHAT HE UPLOADS IS A MASTER, NOT A DELIVERABLE — EVERY PLATFORM REFUSES IT AS IT ARRIVES.**
The `.mov` files that land in `~/share/work/mat-mwk-social/input/` are **ProRes video with PCM
audio**, 1080x1920, around a gigabyte for forty seconds — 3 of 3 checked on 2026-09-21 (`001 -
Chris Website`, `002 - Refund`, `003 - Job interview`). `check()` fails all eight platforms on
the codec alone, and X fails a second time on the audio. So *"the video is ready"* means the
master is ready; the encode is ours:

```sh
ffmpeg -y -hide_banner -loglevel error -i "<master>.mov" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 20 -preset slow \
  -movflags +faststart -c:a aac -b:a 192k -ar 48000 "<slug>-<NNN>.mp4"
```

That took 1.24 GB to 32.8 MB with the picture and the 38.6 s untouched, and passed all eight.
Write it **beside the master in `input/`**, named `<slug>-<NNN>.mp4` after the master's number
(`chris-website-001.mp4` is the one already in the archive) — then probe THAT file, never the
`.mov`. Both go to `input/archive/<date>/` once the post is out.

Pulling a clip off YouTube, two traps that bite every time:

```sh
yt-dlp -q --no-warnings --no-playlist --force-ipv4 --merge-output-format mp4 \
  -f 'bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1]/b[ext=mp4]/b' \
  -o clip 'https://www.youtube.com/watch?v=<id>'
```

**No code holds this string any more** — `downloadYouTube()` was deleted on 2026-08-24, so this
skill is the copy. Copy it whole, do not shorten it, and **constrain BOTH streams.** Three ways
it bites:

- It **appends its own extension** (ask for `clip`, get `clip.mp4` — reading that as "downloaded
  nothing" has happened).
- It **serves AV1 video by default**, which Instagram and TikTok reject.
- It serves **Opus audio** by default, and `+ba` on its own takes it. Facebook, LinkedIn, YouTube,
  TikTok and Threads all publish Opus-in-MP4 without complaint; **X uploads the entire file and
  then fails at 99%** with "media processing failed". `+ba[ext=m4a]` is what gets AAC. This one
  cost a post on 2026-08-21 — the shortened format string in this file is how it got in.

**One VIDEO per post on every platform** (several STILLS do ride together — `mwk-image` §5).
A vertical and a landscape cut are two posts, or one
item with `--media-wide`.

## 3b. The cover frame is automatic, and only three platforms have one

`run-queue.js` sends a cover offset with every clip — **2,000 ms** by default, clamped to inside
the clip, `MWK_COVER_MS` to change it. Nothing to pass.

- **Instagram, TikTok and Pinterest** take it. Their own defaults are 0 ms, 1,000 ms and 0 s, so
  before 2026-09-22 two of the three showed the literal first frame.
- **YouTube takes an image, not a timestamp — and it DOES work on a Short** (exercised
  2026-09-22, against the docs). `run-queue` pushes the same frame after publishing. It sets the
  16:9 thumbnail — search, the channel grid, embeds — and **not** the vertical cover inside the
  Shorts feed, which is YouTube's own and has no API. Facebook, LinkedIn, X and Threads document
  nothing at all.
- **It cannot be fixed after publishing on Instagram, TikTok or Pinterest** — there the cover
  is decided before it goes out or not at all. YouTube is the exception, above.
- ⚠ A frame INDEX is not a time — "the tenth frame" is 167 ms at 60 fps and 333 ms at 30.

## 4. Queue it

```sh
./scripts/with-secrets.sh node scripts/queue-add.js \
  --body-file words.txt --media clip.mp4 \
  --platforms facebook,youtube,linkedin,tiktok,threads,twitter \
  --topics ComputerProblems,CopyPaste
```

**`--link` when the post is ABOUT something with a page of its own.** A project, an episode, a
tool. That page becomes the pin's destination and X's caption link, and it goes out as the
**full url** — `mwk.show` is the show's address and stands for nothing else (mate,
2026-09-22). Leave it off and everything points at the show, which is right for a clip off the
show. The cost, which is his call: a project link is not counted.

⚠ **The first comment only follows a destination on HIS OWN site.** A vendor page (Elgato, a
marketplace) reaches the pin and the caption and not the comment, because the duplicate guard
could never recognise a comment carrying it. `queue-add.js` prints which one you are getting.

`--dry-run` prints the SQL and writes nothing; `--help` prints the usage. Leaving `--platforms`
off means "wherever it fits". Local media goes to R2; a URL is stored as-is.

Before choosing platforms, **check whether the clip has run there before** — `posts:list` is the
whole universe of what this pipeline has sent. Do NOT reintroduce an "is a copy already over
there?" sweep across `analytics:posts --source external`; that existed only for the retired mirror
and the playbook says so. Instagram and TikTok are the ones to be careful with: **neither can be
deleted through the API**, so a repeat inside a fortnight is permanent.

## 5. Say what will actually happen

- **The pace releases it, and the numbers are `pace.DEFAULTS`** — read them there, and quote
  `pace.status().nextAt` rather than any figure from a doc. They are his and only he changes
  them, so say what they will do to a batch rather than working around them. Two consequences
  worth stating to him every time: **something queued after the window closes waits until the
  next morning**, and **the opening slides by the day**, so never promise a clock time you have
  not read off `nextAt`.
- The CTA lands as a first comment on Facebook, Instagram, LinkedIn, YouTube (natively at publish)
  and Threads (the hourly watcher).
- **X takes the link IN THE TWEET** (changed 2026-08-24). It rode in a thread reply for three days;
  an out-of-network reply never reaches the For You feed, so that CTA only reached existing
  followers, and the demotion it was dodging is not in X's open-sourced ranker. One tweet is 20c.
- **Instagram and TikTok get NO LINK AT ALL** — a url is plain text on both, in a caption and in a
  comment alike. Instagram's CTA says "link in my bio" and mints nothing; the bio link is the
  tracked one. **TikTok says nothing about a link** (since 2026-09-14): the bio link is plain text
  too on a personal account under 1,000 followers, so the caption is his words and the tags.
- **Pinterest gets the clip as a video pin** (since 2026-09-20): the first line of his words is
  the pin's title (100 max), the words plus up to three tags are the description, and the pin's
  own destination field carries the link — the show by default, or **whatever `--link` names**.
  The PIN cannot be edited afterwards (and no delete has been exercised) — but its destination
  is a `mwk.show/<code>` we own (older ones say `mwkshow.com`; same table), and the code's `target` is a row in D1 read fresh on every
  hit, so a show-code pin is repointed with one `UPDATE link` and the pin is never touched
  (done for the 2026-09-22 Dial pin; CLAUDE.md → *Links* has the rule and its limits). A full
  `--link` url is baked in and is decided now. 2:3, 1:1 or 9:16 only. No comment, no watcher.
- **Never say the watcher will pick up TikTok or X. It cannot.** `platforms.commentWatched()` is the
  one definition of what it covers: Instagram, Threads, Facebook, YouTube, LinkedIn.
- Tags go in the caption **or** the comment, never both — that is the behaviour, and it holds.
  **The 5-cap is Instagram's; "caption and comments count together" is NOT** (retracted
  2026-08-24). Why, and what else went with it, is argued once in `docs/playbook.md`
  → *What each platform allows* → *The two worth getting right* — do not restate it here.
- **Every code minted carries the queue item id**, so a click answers "which platform, which
  placement, which video" on `/links`. Nothing to do by hand; `run-queue.js` passes it down.
- **A LinkedIn post is three surfaces and two codes** (since 2026-09-14): **his own profile
  publishes it**, the company page reposts it with his thought on top and **its own** tracked CTA,
  and any other connected profile reposts **plain** — no words of his, no comment in his voice,
  because words under a person's name have to be that person's. Reposts stagger four hours apart.
  It ran the other way for a month — the 30-follower page posting natively while the two profiles
  holding 7,222 merely reposted — which is the reason for the flip, not a detail of it.
- **A vertical clip under three minutes sent to YouTube is a SHORT, and a url in a Short is plain
  text** — description and comment alike. `run-queue.js` works this out per clip and the CTA names
  the channel instead of spending a code. **With no `--media-wide` the tall cut goes everywhere,
  so this is the normal case, not an edge one.**
- **`--no-first-comment` means it now.** The publisher records the decision where the hourly watcher
  looks, so the flag is not just a one-hour delay any more.

Then give him the caption, the platforms, when it goes, and
https://social.matewishkey.com/queue — where he can cancel or bump it.
