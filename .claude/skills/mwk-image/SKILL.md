---
name: mwk-image
description: Put a still picture out as an MWK post — the format traps that bite silently, the platforms that cannot take a picture at all, and into the queue. The picture arrives made; we do not make it. Use whenever the thing to post is a photo, screenshot, poster, thumbnail or generated image rather than a clip.
---

# mwk-image — a picture, branded, queued

For a **still**. A clip is `mwk-post`; everything there about his voice, the hashtag rule and
"post it means queue it" still applies here, and is not repeated.

## 1. Two platforms cannot take a picture at all

`imageOk` on the platform table decides it, and `run-queue.js` acts on it:

| takes a still | does not |
|---|---|
| Facebook, Instagram, LinkedIn, Threads, X, Pinterest | **YouTube**, **TikTok** |

**YouTube** has nothing a still can be posted *as*. **TikTok** photo posts need
`contentType: photo` and are **declined, not merely unbuilt** (mate, 2026-08-26, closing #27) —
do not propose building them. Expect both to be skipped in the run output and say so before he asks.

**And the pipeline never CHOOSES a still.** Sending one where a clip would go was declined the same
day. This skill is for a picture he hands over, or one the post is genuinely about — never for
swapping a clip out.

So a picture reaches six surfaces, not eight. If the point of the post needs TikTok or YouTube,
it needs a clip.

**Pinterest takes exactly ONE image** (`imageMax: 1`), so it is never part of a gallery, and it
refuses landscape: 2:3, 1:1 or 9:16 only. Its title is the first line of his words, 100 characters.

## 2. Believe `identify`, never the file name

**A file named `.jpg` is not necessarily a JPEG.** One arrived on 2026-08-24 named
`mwk_wish_wisely.jpg` and was a PNG. `zernio media:upload` infers the content type **from the
extension**, so uploading it under the wrong name declares the wrong type.

```
identify <file>          # PNG 1672x941 ... — the truth
```

Rename to what it actually is before anything else touches it.

## 3. Pad to fit, never crop

The aspect rules for **images** are not the video ones. Instagram takes **0.75–1.91**, and
**exactly 1.91:1 is rejected** — a float edge, bitten live.

- A wide screenshot: pad to about **1.78** with the screenshot's own background colour.
- A tall grab (phone, email): pad up to **4:5 (0.8)** the same way.
- Never crop to fit. The thing that gets cropped is the bottom of the frame, and the bottom of
  the frame is usually the point.

`scripts/lib/media.js` `check(platform, probe)` answers it for real — probe the file and read
the array, do not eyeball the numbers.

## 4. The branding is not ours to draw

**We do not make pictures here** (mate, 2026-08-26). The two requests this repo had open against
`mwk-og-image-generator` — pad-instead-of-crop and the 4:5 / 9:16 shapes — were withdrawn the same
day. There is no requester behind them any more.

So a picture reaches this pipeline **already branded**. If one arrives without the band, ask him
where it should come from rather than drawing one: **never redraw the band by hand and never
regenerate one**, because a band drawn twice is a band that drifts.

What is still ours is everything either side of it — the aspect and format checks above, and
the queueing below.

## 5. Several pictures are ONE post, and the set is padded together

`--media` takes a comma-separated list. The first is the post's media, the rest ride with it in
the same post — a LinkedIn/Facebook/Threads gallery, an Instagram carousel, an X multi-image
tweet. **Stills only**: one video per post is a hard limit everywhere, so a set with a clip in
it silently collapses to the first item.

Caps are per platform and `platforms.galleryFor()` applies them: **LinkedIn 20, Facebook 10,
Instagram 10, Threads 10, X 4, Pinterest 1** — a pin is therefore never part of a gallery. Over the cap it truncates; a platform that takes no still gets
nothing.

**Pad the SET to a common ratio, not each file to whatever passes.** Instagram forces one aspect
across a carousel, so mixed shapes get cropped by Instagram itself — the thing §3 exists to
prevent. Pick one ratio for all of them (4:5 is the tall end and usually right for screenshots)
and pad each with its own background colour:

```
bg=$(convert in.png -format "%[pixel:p{5,5}]" info:)     # its own corner, not white-by-guess
convert in.png -background "$bg" -gravity center -extent 1084x1354 out.png
```

Then probe every file, not just the first — `run-queue.js` drops the whole platform and names the
offending file, so one stray image costs the platform rather than being quietly left out.

## 6. Queue it

```
./scripts/with-secrets.sh node scripts/queue-add.js \
  --body-file words.txt --media out.png --topics AIFail,BusinessPlan,SmallBusinessOwner

./scripts/with-secrets.sh node scripts/queue-add.js \
  --body-file words.txt --media one.png,two.png,three.png --platforms linkedin,facebook
```

**One `body` per queue item, so two platforms wanting different words are two items.** Threads
caps at 500 characters and LinkedIn at 3,000: a long post aimed at both silently loses Threads.
Split them and aim each with `--platforms`.

`--dry-run` first prints the SQL and uploads nothing. **Name the file something meaningful** —
the R2 key is derived from it (`queue/<day>-<slug>-<ulid><ext>` — the ULID is deliberate, two
posts named the same must not overwrite each other), and `final.png` tells nobody anything
in six months.

## 7. Then say what happened

Read the run output, not your expectations. Six platforms publish, two skip, and the skip lines
name the reason. Instagram mints **no** short code — nothing there is clickable, so its CTA
points at the bio.

## Where the knowledge lives

- Platform rules: `scripts/lib/platforms.js` — `imageOk`, `imageAspectRange`, `imageMax`
  (the gallery cap; `galleryFor()`, `galleryProblems()` and the config page read it).
- What a file actually is: `scripts/lib/media.js` — `probe()` sets `isImage` off ffprobe's
  container name; `check()` branches on it.
- Everything we say out loud: `config/voice.json`.
