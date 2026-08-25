# mwk-social

A complete cross-platform social posting pipeline — **shipped in one hour**, driven
entirely from the terminal with the [Zernio](https://zernio.com) CLI.

![A full social posting pipeline, shipped in one hour](assets/og-card.png)

## What this is

One CLI, one API, five connected accounts at launch (Facebook Page, LinkedIn
personal + company, Instagram, YouTube — TikTok joined since). The launch announcement went out to four platforms
at once, straight from a shell — these are the actual live posts:

- Facebook: <https://www.facebook.com/1218437048021839_122107644951415959>
- LinkedIn: <https://www.linkedin.com/feed/update/urn:li:share:7494047885701853184/>
- Instagram: <https://www.instagram.com/p/DcBmp3tCNXN/>
- YouTube: <https://www.youtube.com/watch?v=57AbTXfNguQ>

## What's inside

- `assets/og-card.png` — the AI-rendered launch card (1200×630), generated with
  [mwk-og-image-generator](https://github.com/matewishkey/mwk-og-image-generator)
  and branded by code.
- `assets/` — also holds the ImageMagick announcement card (1080×1080), wide
  version (1920×1080) and the 10s launch video.
- `scripts/generate-assets.sh` — regenerates the three ImageMagick/ffmpeg assets
  (the AI og-card comes from mwk-og-image-generator).
- `scripts/post.js` — publishes to any set of connected accounts and attaches the
  standard first comment natively, so it lands seconds after the post does.
- `scripts/post-everywhere.sh` — the original one-liner entry point, now a thin
  wrapper over `post.js`.
- `config/voice.json` — everything the pipeline says out loud: the rotating first-comment
  variants, the identity and brand tags, per-platform hashtag caps, the tag blocklist and the
  YouTube show blurb. One file to change what gets posted.
- `scripts/first-comment.js` — makes sure everything published has its comment.
  Facebook, Instagram, LinkedIn and YouTube get it natively at publish time;
  Threads has no such field, so this picks it up. TikTok has no usable comments
  API at all; X has one, but its link ships in the tweet itself, so a watcher
  comment would be the same link twice under one post. The wording rotates, and some comments quote a real guest
  wish from the show's feed.
- `docs/playbook.md` — the rules this pipeline runs on, and what each platform
  will and won't allow.
- `scripts/lib/media.js` — probes a clip's duration, aspect, codec and audio,
  and says which platforms will take it. The queue checks this before publishing:
  a video Instagram or TikTok would reject costs the post otherwise.
- `scripts/lib/topic-tags.js` — works out what a video was about so the comment
  can say so. Downloads the clip, strips the audio with ffmpeg, transcribes it,
  and names the subjects it covers — `#Invoicing`, `#Xero`, whatever the clip is
  actually about, in words an ordinary person would use rather than technical ones. Needs `OPENAI_API_KEY`
  and `GEMINI_API_KEY`; without them the comment still goes out, just untagged.
  Results are cached per post under `~/.local/state/mwk-social/topics/`.
- `web/` — the dashboard on Cloudflare Workers + D1, behind an email one-time
  PIN at `social.matewishkey.com`. Six pages: what the pipeline has been doing
  and what needs a human, the stats, the queue, YouTube show notes awaiting
  approval, every short link and what it earned, and a workflow map of what
  happens on each platform. Fed by
  `scripts/ship-events.js` (every two minutes) and `scripts/ship-stats.js`
  (hourly).
- **Everything publishes from here.** The pipeline used to also mirror reels
  that Restream had put on Facebook, and carried a whole matcher to work out
  whether a copy was already on a platform before posting another. That is gone:
  the queue is the only way content goes out, so there is nothing to reconcile
  against and nothing to guess about. Anything posted outside it is a one-off,
  handled by hand.
- `scripts/lib/pace.js` — the one thing that decides *when* anything goes out:
  the daily cap (counted in the audience's timezone) and the minimum gap between
  posts. No time-of-day window — the audience is in every timezone.
  Everything that publishes asks it, so queueing five things at once produces
  five posts spread over hours rather than five posts in a minute.
- `scripts/run-queue.js` — takes one item off the dashboard queue and posts it,
  if now is a good moment. Claims before publishing, and puts an item back
  rather than burning it when something goes wrong.
- `scripts/queue-add.js` — puts something in that queue from the box, where the
  dashboard's own form is how he does it. His words go into a SQL literal, so
  the escaping is the part that matters and the part that is tested.
- `.claude/skills/` — the procedures an agent working here follows: `mwk-status`
  for where everything stands, `mwk-post` for turning his words into a queued
  post, and `mwk-image` for putting out a still rather than a clip. They load
  when the work calls for them rather than every session.
- `scripts/lib/shortlink.js` — mints the `mwkshow.com/<code>` link that every
  call to action carries, one code per platform and post, so a click says which
  channel and which clip earned it. Every link we post gets one, not just the
  CTA. Idempotent, and never fatal: with no dashboard the plain URL goes out and
  the comment still happens. **Link-preview fetches are not counted as clicks** —
  a platform fetching the URL to build its card would otherwise read as traffic.
- `scripts/lib/reshare.js` — LinkedIn reposting. The company page posts it, then
  every personal account reposts that — plainly, with no commentary, which is the
  usual case, and staggered four hours apart so two accounts never repost the same
  thing in the same minute. A thought on top is optional and always his words,
  never generated. Each repost carries **its own** tracked CTA comment: the
  company page and the personal profiles are different audiences, and until
  2026-08-24 the profiles holding all of them got a bare repost with no link at
  all.
- `scripts/yt-description.js` — writes YouTube descriptions from each video's own
  transcript. `--sync` fills in videos that have none and files a *proposal* for
  anything that already has a description, which does nothing until it is
  approved on the dashboard. A **Short** gets no tracked code: YouTube renders
  every url in a Short's description as plain text, so the tail names the channel
  instead — which is YouTube's own route out of a Short.
- `scripts/lib/comment-state.js` — which published posts the watcher has dealt
  with. Shared, because the publisher writes it too: an item queued with the
  first comment switched off is recorded here, or the watcher would fill the
  deliberate gap back in an hour later.
- `scripts/install-timers.sh` — installs the five systemd `--user` timers: the
  comment check hourly, the queue every five minutes (stopping at `:45`, to
  leave the comment watcher a clear run at `:00`), the event uploader every two
  minutes, analytics hourly and the show-notes draft daily. The posting *pace*
  lives in `lib/pace.js`, not the timers.

## Reproduce it

```bash
npm install                      # installs @zernio/cli locally
./node_modules/.bin/zernio auth:login    # device flow
./node_modules/.bin/zernio connect:get-url facebook --profileId <your-profile-id>
./node_modules/.bin/zernio connect:get-url linkedin --profileId <your-profile-id>
# open the printed URLs, authorize, then:
./node_modules/.bin/zernio accounts:list # grab your account IDs

scripts/generate-assets.sh
export ZERNIO_IMAGE_ACCOUNTS=<id1>,<id2>
scripts/post-everywhere.sh "Your announcement text" assets/ship-card.png
```

## What's worth measuring

At this size, followers are not the scoreboard — five of the ten connected
channels are still in single digits, and one (LinkedIn personal) holds almost
all of the audience. The stats page is built around five things
instead, in this order:

1. **reach / views** — did anyone see it
2. **engagement rate** — did anyone care, normalised so it survives growth
3. **link clicks** — the only number tied to the actual goal, guest sign-ups
4. **cadence** — posts per week, the biggest lever fully within our control
5. **follower growth** — last, and only where there is a base to grow

Each channel card shows only the metrics that channel genuinely returns,
measured across live posts rather than read off a docs page. Facebook reports
clicks; Instagram, YouTube, TikTok, Threads and X report zero on every post,
which is exactly why the CTA has its own short domain.

## Platform notes (the ones that bite)

- **Facebook posts to Pages only** — no API on earth can post to a personal
  timeline; that's Meta's rule, not Zernio's.
- **Instagram needs a Business/Creator account**, and every post needs media.
- **LinkedIn** rejects duplicate content (422) and caps posts at 3,000 chars.
  Reshare an existing post via `platformSpecificData.reshareUrl` (quote-repost
  when you add text).
- **YouTube** posts are video uploads — `--title` + `--media <video url>`.
- **Comment APIs take the platform's native post ID**, not the Zernio one — read
  it from `platforms[].platformPostId`, or every `inbox:*` call 404s.
- **X's endpoints are opt-in per account, and default to off.**
  `xCapabilities: { analytics, inbox }` on `PUT /v1/accounts/{id}` gate tweet
  search and the comment API respectively. While they are off, both 403 with a
  message that reads like a plan limit. It isn't one.
- **First comments are a native field**, `platformSpecificData.firstComment`, on
  Facebook, Instagram, LinkedIn and YouTube — but not TikTok, and not from the
  CLI, so `post.js` calls the REST API directly.
- **A post made outside this pipeline never gets its comment.** The per-platform
  sweep that used to find app-authored posts went when the mirror did — those are
  now one-offs, handled by hand. Everything published from here is covered.
- **YouTube won't take comments on a private video** — the API 403s and a
  `firstComment` never appears. Unlisted works fine.
- **Instagram can't be deleted or edited through any API.** Every mistake there
  is permanent, so a clip is checked against its limits before anything is sent.
- **Hashtags go in the caption or the first comment, never both.** Facebook,
  YouTube, LinkedIn, TikTok and X take them in the caption; Instagram and Threads
  keep the caption clean and spend them in the comment.
- **X's link is in the tweet.** It rode in a thread reply from 21 to 24 August,
  to keep an external link out of the tweet that has to travel. Two things ended
  that: the demotion it was dodging is not in the open-sourced ranker, and an
  out-of-network reply is dropped before the For You feed — so the CTA only ever
  reached people already following us. One tweet is also 20c against the
  thread's 21.5c, because the URL fee replaces the base charge.
- **Instagram caps hashtags at 5, and we never spend that budget twice.** The cap is
  Instagram's. The "caption and comments count together" part is NOT — that claim, and
  the penalties usually listed beside it, trace to marketing blogs rather than to
  Instagram, and were retracted on 2026-08-24. The behaviour stayed anyway: never
  spending the budget twice is free, and costs nothing if the stricter reading turns
  out to be wrong. So the caption carries none and the comment spends all five — two
  always-on tags and three describing the clip.
- **One video per post, on every platform.** So a vertical cut and a landscape cut
  are two separate posts: the reel goes to Instagram, TikTok and Threads, the wide
  one to Facebook, YouTube, LinkedIn and X.
- **A still picture reaches five of the seven.** Facebook, Instagram, LinkedIn,
  Threads and X take one; YouTube has nothing a picture can be posted *as*, and
  TikTok's photo posts exist in its API but have never been built here. `imageOk`
  decides it, and a picture is judged on image rules — not on audio and H.264.
- **TikTok's settings go in `tiktokSettings` at the top level** of the request,
  not in `platformSpecificData` — which would look accepted and silently apply
  none of them, because that field stores and echoes any key you send it.

The full set, with the story behind each, is in [docs/playbook.md](docs/playbook.md).
