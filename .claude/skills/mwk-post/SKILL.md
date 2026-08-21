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

Never write marketing copy. His dictation IS the post — copy it across, fix nothing but a typo.

When he asks for options, or says "add small wording", write plainly in his register: first
person, the viewer as the subject, ordinary language. Never "expert", "teacher", "free",
"guaranteed" or "safe", and never a claim that anyone became a developer. `matewishkey.com/brand`
is the authority and its rules are recorded beside the text in `config/voice.json`.

**Show him what you wrote before it goes.** Words published under his name have to be his.

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
yt-dlp -q --no-warnings -f 'bv*[vcodec^=avc1]+ba/b[vcodec^=avc1]/b' \
  --merge-output-format mp4 -o clip 'https://www.youtube.com/watch?v=<id>'
```

It **appends its own extension** (ask for `clip`, get `clip.mp4` — reading that as "downloaded
nothing" has happened), and it **serves AV1 by default**, which Instagram and TikTok reject.

Images: aspect must be 0.75–1.91:1 and **exactly 1.91 is rejected** (float edge, bitten live).
Pad with the screenshot's own background colour — never crop.

**One video per post on every platform.** A vertical and a landscape cut are two posts, or one
item with `--media-wide`.

## 4. Queue it

```sh
./scripts/with-secrets.sh node scripts/queue-add.js \
  --body-file words.txt --media clip.mp4 \
  --platforms facebook,youtube,linkedin,tiktok,threads,twitter \
  --topics ComputerProblems,CopyPaste
```

`--dry-run` prints the SQL and writes nothing. `--help` is the header of the file. Leaving
`--platforms` off means "wherever it fits". Local media goes to R2; a URL is stored as-is.

Before choosing platforms, **check whether the clip has run there before** — `analytics:posts
--source external` covers posts made in the apps. Instagram is the one to be careful with: it
cannot be deleted, so a repeat inside a fortnight is a real cost.

## 5. Say what will actually happen

- The pace releases it: six a day, ninety minutes apart, **no time-of-day window**.
- The CTA lands as a first comment on Facebook, Instagram, LinkedIn, YouTube (natively at publish)
  and Threads (the hourly watcher).
- **TikTok and X take the link in the CAPTION** — they have no usable comments API. **Never say
  the watcher will pick them up. It cannot.**
- Tags go in the caption **or** the comment, never both — Instagram counts the two together
  against one cap of five.

Then give him the caption, the platforms, when it goes, and
https://social.matewishkey.com/queue — where he can cancel or bump it.
