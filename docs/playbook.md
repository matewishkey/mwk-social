# Playbook

What this pipeline does, the rules it runs on, and what each platform will and won't allow.
Everything here was learned by doing it live — where a rule exists, something broke to earn it.

## The shape of it

```
the queue (dashboard) ──> run-queue.js ──> Facebook · Instagram · YouTube · LinkedIn
                              │            Threads · TikTok · X
                              │                     │
                              │            the CTA, in a comment or the caption
                              │                     │
first-comment.js (hourly) ────┴─────────────────────┘   fills anything the publish missed
```

**Everything publishes from here** (2026-08-21). There used to be a second origin — Restream put
clips on Facebook and a mirror copied them onward — which is why this file once carried a whole
chapter on deciding whether a copy already existed somewhere. One origin means nothing to
reconcile, and that chapter, `mirror.js` and `lib/matcher.js` are all gone.

Two ways the call-to-action gets under a post:

| | How | Where |
|---|---|---|
| **At publish time** | `platformSpecificData.firstComment`, posted by Zernio seconds after the post | Facebook, Instagram, LinkedIn, YouTube |
| **Afterwards** | `scripts/first-comment.js`, hourly — Threads has no native field, and it also catches a native comment that silently failed | + Threads |
| **In the caption** | no comment API exists | TikTok, X |

They compose safely because both read `config/voice.json` and both skip a post that already
carries the marker — whoever put it there.

## What gets said

`config/voice.json` is the only place. The CTA variants, the identity tags, the per-platform
hashtag caps, the blocklist, the YouTube blurb, the feed URL. Change it there or you'll change it
in the wrong place.

- **`#MWKShow` and `#PIY` go on every post, in that order** — the brand and the motto short form.
  A cap tighter than the pair truncates it, so X's one tag is `#MWKShow`.
- **Tags go in the CAPTION or the first COMMENT, never both.** `hashtagsInCaption` on the platform
  table decides: Facebook, YouTube, LinkedIn, TikTok and X take them in the caption; Instagram and
  Threads keep the caption clean, because Instagram's cap of 5 counts caption and comments together
  and putting them in both would spend the budget twice.
  "Prompt it Yourself" is written out in the comment text where it reads as a sentence; as a tag it
  is just `#PIY`.
- **Topic tags describe the video**, derived from its own transcript. If it's about trading it
  says `#Trading`. Never audience tags, never marketing, never `#AI` — there's a blocklist that
  enforces it whatever the model suggests.
- **The comment rotates** so it isn't the same three lines forever, and roughly two in five quote
  a real guest wish from `matewishkey.com/rss.xml` and link that episode.
- **`matewishkey.com/show` is load-bearing.** It's how we recognise our own comments. Any composed
  comment that loses it is refused rather than posted.

## Rules that exist because something broke

| Rule | What happened |
|---|---|
| Comment calls take the **platform-native** post ID, never Zernio's `_id` | The Zernio id 404s on every `inbox:` call |
| Never pass a post ID as a CLI positional | A YouTube ID starting with `-` is read as a flag; the CLI printed its help and the script logged a failure. Hence `scripts/lib/api.js` |
| Secrets never in `argv` | `ps` is world-readable |
| Alert on `needsReconnect` or `error`, never on `warning` | Tokens refresh lazily; `warning` is a normal state to pass through |
| Write state after **every** decision | A backfill killed at two minutes had posted 13 comments and recorded none |
| A caption that already has the link gets no comment | Otherwise the same URL appears twice under one post |
| Wait for the transcript rather than posting untagged | The comment is one-shot; it can't be edited later |
| No `--flag` on `post-everywhere.sh` | A stray `--dry-run` was read as the video argument and published for real |
| An item that has put **anything** live is never queued again | X's media upload failed at 99%; the exception unwound past four platforms that had already published, the item went back to `queued`, and the next tick posted the lot again — three copies on TikTok, Facebook and LinkedIn before it was stopped by hand |
| Each publish group is caught where it happens | One group throwing used to abandon the groups behind it *and* discard the record of the ones in front |

## What each platform allows

| | Comment API | Delete via API | Notes |
|---|---|---|---|
| **Facebook** | yes | yes | Pages only, never personal timelines. ~60-day tokens |
| **Instagram** | yes | **no** | Business account, media mandatory. **Nothing can be deleted or edited via API — every mistake is permanent.** Caption folds at ~125 chars |
| **LinkedIn** | yes | yes | 3,000 chars, duplicate content 422s, links cut reach 40–50%. Post to the company page, quote-reshare from personal |
| **YouTube** | yes | yes | Vertical under 3 min becomes a Short; Shorts get no custom thumbnail. Private videos 403 on comments — unlisted is fine |
| **Threads** | yes | yes | Same Meta auth as Instagram. 500 chars, 5-minute video. **Invisible to `analytics:posts`** — it can prove presence, never absence |
| **TikTok** | **none at all** | **no** | Link goes in the caption. Consent flags required per post. Its own daily cap. **Nothing can be deleted through the API** — `posts:unpublish` returns "TikTok does not support post deletion via API" (2026-08-21). Manual only, like Instagram |
| **X** | 403 on this plan | yes | Link goes in the post. Premium required or link posts get zero engagement |

### The two that cost money or reach if you get them wrong

**Instagram caps hashtags at 5, counting the caption and the comments together.** Enforced since
18 Dec 2025; over the cap and the post loses Explore, hashtag pages and Reels recommendations.
So an Instagram caption carries *zero* hashtags and the comment spends the budget — two
always-on tags and three describing the clip.

**X bills $0.20 for a post containing a URL, against $0.015 without.** The fee follows whichever
post holds the link, so a thread pays the $0.20 *plus* $0.015 for the second post — the link goes
in the post itself, never in a reply. Measured against real billing, not the price list.

## Media

`scripts/lib/media.js` fetches a clip once, caches it under
`~/.local/state/mwk-social/media/`, and probes it with `ffprobe`. `run-queue.js` probes a queued
upload before publishing and drops any platform that would reject it — a duration or aspect a
platform will not take costs the post otherwise, and the item is already claimed by then.

- **Check before the platform does.** `check(platform, probe)` returns an array of reasons, empty
  when the clip is fine. Note the argument order and the return shape.
- Media URLs from a CDN are often **signed and expire** — two of seven Facebook clips were dead
  within a fortnight. Download when you see it, not when you publish.
- **YouTube serves AV1 by default.** Instagram and TikTok want H.264 for a reel, so the format
  selector asks for `avc1` first and only falls through if there is none.
- **yt-dlp appends its own extension to `-o`.** Asking for `x` and getting `x.mp4` reads as "the
  download produced nothing". It downloads into a scratch directory and takes whatever lands.
- YouTube returns an **empty** media URL, so transcripts there come from `yt-dlp --write-auto-subs`
  instead. Free, and it covers a four-hour stream in full rather than the first fifteen minutes.
- TikTok and X withhold media entirely (`platform_withheld`).
- `--download-sections` segfaults this box's ffmpeg build. Don't reach for it.
- The aspect check is the **video** range, inclusive at both ends. Instagram's "exactly 1.91:1 is
  rejected" edge is an *image* rule; applying it to video throws away a legitimate square reel.

### Downloads use curl, not fetch, and that is not an accident

Node's `fetch` fails on every Meta CDN host from this box — `ETIMEDOUT` at almost exactly 253 ms,
every time. The box has no IPv6 route, the CDN's AAAA record wins the lookup, and undici's
Happy Eyeballs window is 250 ms by default, so it gives up before trying IPv4. curl falls back
correctly and gets a 206.

**That failure is indistinguishable from an expired signed URL**, which is an expensive thing to
misdiagnose: it makes seven live clips look dead. If you ever do need `fetch` against a Meta host,
`net.setDefaultAutoSelectFamilyAttemptTimeout(500)` fixes it — measured, four out of four, not
guessed.

## The pace, and what runs it

Five systemd `--user` timers, all from `scripts/install-timers.sh`:

| Unit | When | What |
|---|---|---|
| `mwk-first-comment` | `*:00` | the CTA comment on anything that hasn't got one |
| `mwk-queue` | `*:20` | `--scheduled` — publishes the next queued item, if this is a turn |
| `mwk-ship-events` | `*:0/2` | ships the event log to the dashboard |
| `mwk-ship-stats` | `*:35` | analytics, follower counts, the platform table |
| `mwk-yt-notes` | `05:40` | drafts YouTube show notes for approval |

The queue runs twenty minutes after the comment check so a post has settled before the watcher
goes looking for it. Every unit is `Type=oneshot` and runs through `scripts/with-secrets.sh`,
because systemd's `EnvironmentFile` can read neither `~/.secrets` nor the sops-encrypted project
env.

**The pace is in `scripts/lib/pace.js`, not the cadence.** The timer is a dumb hourly heartbeat and
`whyNotNow()` says no most of the time — six a day, ninety minutes apart. Keeping it in one module
means a run by hand obeys the same rules, and it counts `queue.posted` events so there is one
budget rather than one per caller.

**There is no time-of-day window** (mate's call, 2026-08-21). There used to be a 09:00–21:00 one.
The audience is spread across timezones — someone in the US reads a post hours after it goes up
and is none the wiser — so holding a post for a "good hour" only delayed it. What is left is
volume, not timing.

**The daily cap is still counted in the audience's timezone.** The box is `Etc/UTC` and the
audience is in Brisbane, so counting UTC days would reset the cap twelve hours early. `MWK_TZ`
moves it.

## The dashboard

`social.matewishkey.com` — five pages behind Cloudflare Access with an email one-time PIN:
overview, stats, the queue, YouTube show notes and the workflow map. `web/` holds it;
`web/deploy.sh` ships it from this box, never on push.

| | |
|---|---|
| Worker | `mwk-social-log`, one script, three hostnames |
| Dashboard | `social.matewishkey.com`, Access (OTP), 720h session |
| Ingest | `ingest.matewishkey.com`, bearer token |
| Short links | `mwkshow.com` — **public, no Access application, ever** |
| Storage | D1 `mwk-social` (10 tables) + R2 `mwk-social-media` for queued uploads |
| Uploader | `scripts/ship-events.js` every two minutes, `scripts/ship-stats.js` hourly |

**`workers_dev = false` is the line that keeps it closed.** Access binds to a hostname, not to a
Worker script, so leaving workers.dev on would publish the entire dashboard at
`mwk-social-log.<subdomain>.workers.dev` with no gate — beside the gated hostname, and invisible
from it. The Worker also verifies the `Cf-Access-Jwt-Assertion` itself, checking the signature, the
audience *and* the expiry: a signature alone would accept a perfectly valid token minted for a
different application in the same Access org.

**Separate hostnames, not one with path rules — and this is not a preference.** An Access
application covers a HOSTNAME and runs in front of the Worker, so putting ingest behind the same
one would 302 the uploader into a login page. Measured the same way for short links: a request to
`/l/<code>` on the dashboard host 302s to the Access login page before any Worker code runs. That
is why `mwkshow.com` is its own hostname with no Access application on it.

**Snapshots where the box already knows the answer.** `platforms`, `voice` and `pace` are computed
on the box and shipped whole, because the code that uses them is the code that computes them —
rebuilding either in D1 would add nothing except a way for the two to disagree. What is a real
table: the queue, links, clicks, daily metrics and follower points, because those are written at
the far end or must outlive Zernio's ~12-month window.

**The cursor advances only on a 2xx.** Anything else leaves it where it was and the same events go
again next run; replays are free because the sink is `INSERT OR IGNORE` on a stable ULID. And the
uploader sends an **empty batch when idle**, at least every fifteen minutes — without that
heartbeat, "nothing happened" and "the box is off" are the same picture, which is the one thing a
status page must never do.

## Reading the API

`posts:list` has a pipeline post the instant it publishes, and since everything publishes from
here it is the whole universe — **read it alone**. `analytics:posts` lags minutes behind and is
only worth reading for its numbers; it used to be swept per platform because it was the one place
app-authored posts appeared, and that went with the mirror.

Neither `/v1/analytics/posts` nor `/v1/analytics/daily` is a REST route — Zernio answers an unknown
path with its marketing site, so a wrong one fails as "not JSON" rather than as a 404. Use the CLI
for analytics, and positive-control any new path against `/v1/inbox/comments` before believing a
failure.

A comment read on a post the account doesn't own returns success with an empty list — "no
comments" never proves "not commented".
