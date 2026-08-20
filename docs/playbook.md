# Playbook

What this pipeline does, the rules it runs on, and what each platform will and won't allow.
Everything here was learned by doing it live — where a rule exists, something broke to earn it.

## The shape of it

```
Restream ──> Facebook · LinkedIn · YouTube · Twitch      (automatic, not ours)
                │
                └── the mirror ──> Instagram · TikTok · Threads · X
                                          │
first-comment.js (hourly) ────────────────┴──> the CTA comment, everywhere it can reach
```

Two ways the call-to-action gets under a post:

| | How | Where |
|---|---|---|
| **At publish time** | `platformSpecificData.firstComment`, posted by Zernio seconds after the post | Facebook, Instagram, LinkedIn, YouTube |
| **Afterwards** | `scripts/first-comment.js`, hourly, for anything we didn't publish | + Threads |
| **In the caption** | no comment API exists | TikTok, X |

They compose safely because both read `config/voice.json` and both skip a post that already
carries the marker — whoever put it there.

## What gets said

`config/voice.json` is the only place. The CTA variants, the identity tags, the per-platform
hashtag caps, the blocklist, the YouTube blurb, the feed URL. Change it there or you'll change it
in the wrong place.

- **`#PIY` and `#MWKShow` go on every post, in that order** — the motto short form and the brand.
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
| Check the target before posting | We put a clip on TikTok that was already there. An assumed list of "what Restream covers" will always drift |
| Secrets never in `argv` | `ps` is world-readable |
| Alert on `needsReconnect` or `error`, never on `warning` | Tokens refresh lazily; `warning` is a normal state to pass through |
| Write state after **every** decision | A backfill killed at two minutes had posted 13 comments and recorded none |
| A caption that already has the link gets no comment | Otherwise the same URL appears twice under one post |
| Wait for the transcript rather than posting untagged | The comment is one-shot; it can't be edited later |
| No `--flag` on `post-everywhere.sh` | A stray `--dry-run` was read as the video argument and published for real |

## What each platform allows

| | Comment API | Delete via API | Notes |
|---|---|---|---|
| **Facebook** | yes | yes | Pages only, never personal timelines. ~60-day tokens |
| **Instagram** | yes | **no** | Business account, media mandatory. **Nothing can be deleted or edited via API — every mistake is permanent.** Caption folds at ~125 chars |
| **LinkedIn** | yes | yes | 3,000 chars, duplicate content 422s, links cut reach 40–50%. Post to the company page, quote-reshare from personal |
| **YouTube** | yes | yes | Vertical under 3 min becomes a Short; Shorts get no custom thumbnail. Private videos 403 on comments — unlisted is fine |
| **Threads** | yes | yes | Same Meta auth as Instagram. 500 chars, 5-minute video. **Invisible to `analytics:posts`** — it can prove presence, never absence |
| **TikTok** | **none at all** | yes | Link goes in the caption. Consent flags required per post. Its own daily cap |
| **X** | 403 on this plan | yes | Link goes in the post. Premium required or link posts get zero engagement |

### The two that cost money or reach if you get them wrong

**Instagram caps hashtags at 5, counting the caption and the comments together.** Enforced since
18 Dec 2025; over the cap and the post loses Explore, hashtag pages and Reels recommendations.
So a mirrored Instagram caption carries *zero* hashtags and the comment spends the budget.

**X bills $0.20 for a post containing a URL, against $0.015 without.** The fee follows whichever
post holds the link, so a thread pays the $0.20 *plus* $0.015 for the second post — the link goes
in the post itself, never in a reply. Measured against real billing, not the price list.

## Telling a mirror from a new clip

The mirror only ever publishes something it can prove is missing. `scripts/lib/matcher.js` is
where that proof is made, and it is the answer to the one real incident: a clip went to TikTok
twice, once by hand at 10:59 and once from here at 20:29 the same day.

**The caption is the only cross-platform signal that exists.** Measured over the whole corpus:
`videoDurationSeconds` is populated on Instagram alone and only on some posts, and TikTok and X
withhold media entirely. So the caption scores decisively on its own and everything else is
corroboration around it. A balanced multi-signal score built from fields that are mostly `null`
would look rigorous and be theatre.

Three things the corpus taught that a reasonable-looking rule would have got wrong:

- **Compare on the shorter caption's length, not a fixed 64 characters.** The manual TikTok
  caption normalises to 45 characters — just the hook — where ours carries the hook plus the body.
  A fixed-length key comparison misses the very duplicate it was written for.
- **"Published before the source" needs a tolerance window.** That manual TikTok predates its own
  Facebook source by one minute. Penalising anything earlier than the source would have republished
  it.
- **The mirror universe is Facebook *video* posts.** Seven of eighteen. The rest are image and text
  posts, and are not reels.

Four verdicts, and only one of them publishes:

| | Means | Publishes |
|---|---|---|
| `duplicate` | a copy is already there | no |
| `review` | the signals disagree | no |
| `unknown` | we could not see clearly — no caption to match on, or the platform read failed | no |
| `none` | genuinely missing | **yes** |

**It fails closed.** A false duplicate costs one missed mirror, visible in the next `--plan`. A
false new costs an Instagram post that no API can delete. Everything above follows from that.

Threads is the one exception worth stating: it never appears in `analytics:posts`, so absence
there only proves *we* have not mirrored it. That is still the thing we need to know, the ledger
records it, and Threads posts can be deleted — so it publishes, flagged `weak`.

## Media

`scripts/lib/media.js` fetches a clip once, caches it under
`~/.local/state/mwk-social/media/`, and probes it with `ffprobe`. `mirror.js --media` runs the
whole thing over every reel and reports what each target would make of it.

- Facebook's media URLs are **signed and expire** — two of seven were dead within a fortnight.
  Download at detection, not at publish.
- **YouTube is the fallback, and it is the better copy.** Both dead clips came back through
  `yt-dlp` at 1080x1920, against Facebook's 720x1280. Same matcher as the dedupe finds the video,
  so "this is the same clip" means one thing everywhere.
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

## Reading the API

`posts:list` has a pipeline post the instant it publishes. `analytics:posts` lags minutes behind
but is the only place natively-authored posts ever appear. **Read both.**

A comment read on a post the account doesn't own returns success with an empty list — "no
comments" never proves "not commented".
