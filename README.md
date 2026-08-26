# mwk-social

A paced publishing queue for seven platforms, driven from the terminal with the
[Zernio](https://zernio.com) CLI, with a dashboard for the decisions that need a human.

It runs the social side of [Mate Wish Key](https://matewishkey.com), a show where people with no
coding experience build something they actually want.

![mwk-social](assets/og-card.png)

## What it does

**One item in, seven platforms out, spread over hours.** Something is queued — from the dashboard
or from the box — and `lib/pace.js` decides when it goes: a daily cap counted in the audience's
timezone and a minimum gap, with no time-of-day window because the audience is in every timezone.
Queue five things at once and you get five posts across the day, not five in a minute.

**Every post carries a route back to the show.** A first comment with a tracked
`mwkshow.com/<code>` link, minted per platform and placement, so a click says which channel and
which clip earned it. Where a url is not clickable at all — Instagram, TikTok, a YouTube Short — the
comment names where the link *is* instead of spending a code on a click that cannot happen.

**It knows what each platform will actually accept**, and checks before sending rather than
letting a publish fail an item it has already claimed: duration, aspect, codec, audio, caption
length, and which platforms take a still at all.

## The pieces

| | |
|---|---|
| `config/voice.json` | Everything the pipeline says out loud — comment variants, tags, caps, the YouTube blurb. One file to change what gets posted |
| `scripts/run-queue.js` | Takes one item off the queue and publishes it, if now is a good moment |
| `scripts/post.js` | The publisher: composes a caption per platform, mints the links, attaches the native first comment |
| `scripts/first-comment.js` | The net under it — Threads has no native first-comment field, and any platform's can silently fail |
| `scripts/yt-description.js` | Writes YouTube descriptions from each video's own transcript, and files a proposal rather than overwriting words already approved |
| `scripts/lib/media.js` | Probes a clip and says which platforms will take it |
| `scripts/lib/topic-tags.js` | Works out what a video was about, so the comment can say so in ordinary words |
| `scripts/lib/pace.js` | The one thing that decides *when* |
| `scripts/lib/shortlink.js` | Mints the tracked code. Idempotent, and never fatal — no dashboard means a plain url and the comment still goes out |
| `scripts/lib/reshare.js` | LinkedIn: the company page posts, the personal profiles repost, staggered |
| `web/` | The dashboard — Cloudflare Workers + D1, behind an email one-time PIN |
| `.claude/skills/` | The procedures an agent working here follows, loaded when the work calls for them |

Five systemd `--user` timers run it (`scripts/install-timers.sh`): the queue every five minutes,
the comment watcher hourly, events every two minutes, analytics hourly, show notes daily.

## Reproduce it

```bash
npm install                                     # installs @zernio/cli locally
./node_modules/.bin/zernio auth:login           # device flow
./node_modules/.bin/zernio connect:get-url facebook --profileId <your-profile-id>
# open the printed URL, authorize, then:
./node_modules/.bin/zernio accounts:list        # grab your account IDs

scripts/install-timers.sh                       # the timers that publish and watch
scripts/with-secrets.sh scripts/queue-add.js --body "Your post" --media clip.mp4
```

## What's worth measuring

At this size followers are not the scoreboard — most of the connected channels are in single
digits and one holds nearly all the audience. What the stats page shows instead:

1. **Posts and actions per post** — the only two numbers measured the same way everywhere
2. **Tracked clicks** — one redirect hit with crawlers filtered, identical on all seven channels
3. **Cadence** — the biggest lever fully within our control
4. **"Seen"** — kept because it is what we have, but **never ranked across channels**: three of
   ours report reach, two report views and one reports impressions, and those are different things

There was a site-wide engagement rate. It counted actions from seven channels over a denominator
covering three, and read half again as high as the truth. It was deleted rather than caveated.

## Platform notes (the ones that bite)

- **Facebook posts to Pages only.** No API can post to a personal timeline; that is Meta's rule.
- **Instagram needs a Business/Creator account**, every post needs media, and **nothing there can
  be deleted or edited through any API** — so a clip is checked against its limits before sending.
- **Comment APIs take the platform's native post ID**, not the Zernio one, or every call 404s.
- **A url is not clickable everywhere.** Instagram and TikTok make nothing clickable, and YouTube
  renders urls in a Short's description as plain text deliberately. Acting as though they did cost
  this pipeline three weeks of unmeasurable posts.
- **First comments are a native field** on Facebook, Instagram, LinkedIn and YouTube — but not
  TikTok, and not from the CLI, so `post.js` calls the REST API directly.
- **X's endpoints are opt-in per account and default to off.** While they are off they 403 with a
  message that reads exactly like a plan limit. It is not one.
- **One video per post, on every platform** — so a vertical cut and a landscape cut are two posts.
- **TikTok settings go in `tiktokSettings` at the top level**, not `platformSpecificData`, which
  would look accepted and apply none of them because that field echoes any key you send it.

The full set, with the story behind each, is in [docs/playbook.md](docs/playbook.md).

## History

Built in an hour on 2026-08-14 as a single publish script, with the launch announcement going to
four platforms at once from a shell. `assets/` holds the launch-day cards as published. It has
since grown a queue, a pace, a dashboard, a link shortener and a show-notes writer; the Restream
mirror it used to reconcile against is gone, and everything publishes from here.
