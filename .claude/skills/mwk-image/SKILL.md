---
name: mwk-image
description: Put a still picture out as an MWK post — the brand band across the bottom, the format traps that bite silently, the platforms that cannot take a picture at all, and into the queue. Use whenever the thing to post is a photo, screenshot, poster, thumbnail or generated image rather than a clip.
---

# mwk-image — a picture, branded, queued

For a **still**. A clip is `mwk-post`; everything there about his voice, the hashtag rule and
"post it means queue it" still applies here, and is not repeated.

## 1. Two platforms cannot take a picture at all

`imageOk` on the platform table decides it, and `run-queue.js` acts on it:

| takes a still | does not |
|---|---|
| Facebook, Instagram, LinkedIn, Threads, X | **YouTube**, **TikTok** |

**YouTube** has nothing a still can be posted *as*. **TikTok** photo posts need
`contentType: photo` and have never been exercised here — false rather than optimistic, on
purpose. Expect both to be skipped in the run output and say so before he asks.

So a picture reaches five surfaces, not seven. If the point of the post needs TikTok or YouTube,
it needs a clip.

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

## 4. The brand band

`mwk-og-image-generator` draws it in code: RedBlock, Fraunces headline, JetBrains kicker,
pixel-identical every time, no API call and no cost.

```
cd ~/projects/mwk-og-image-generator          # REQUIRED — see the trap below
node src/cli.ts brand <file>.png --title "..." --kicker "Mate Wish Key"
```

**Two traps, both verified:**

- **It only runs with that repo as the working directory.** `brand/brand.json` is read relative
  to cwd, so calling it from anywhere else exits `ENOENT: brand/brand.json`.
- **It crops to 1200×630** (`fit: 'cover'`), so any picture not authored at 1.9:1 loses its
  edges — on the genie picture that was the laptop and the "Enter your wish…" prompt box, which
  was the subject. Filed as
  [issue #8](https://github.com/matewishkey/mwk-og-image-generator/issues/8); until it lands,
  **pad by hand and composite the real band below the picture**:

```
convert branded.og.png -crop 1200x150+0+480 +repage band.png        # the real band, drawn by the tool
convert <src>.png -resize 1200x -background '#12100f' -gravity north -extent 1200x825 full.png
convert full.png band.png -geometry +0+675 -composite out.png       # 1200x825, nothing lost
```

Never redraw the band by hand. Lift the strip the tool produced, so the branding cannot drift.

**The band's `--title` is the post's own first line**, not a generic strapline. It is what makes
the picture read as belonging to the words under it.

## 5. Queue it

```
scripts/with-secrets.sh scripts/queue-add.js \
  --body-file words.txt --media out.png --topics AIFail,BusinessPlan,SmallBusinessOwner
```

`--dry-run` first prints the SQL and uploads nothing. **Name the file something meaningful** —
the R2 key is derived from it (`queue/<date>-<name>.png`), and `final.png` tells nobody anything
in six months.

**Draft the words and queue them; do not wait for his dictation** (mate, 2026-08-24: *"The
accountability is still on your side"*). The queue **is** the review gate — he reads it on the
dashboard and releases it — so an unqueued post is a stall, not caution. Say plainly that the
words are yours and easy to replace. If he dictates, his words win untouched.

## 6. Then say what happened

Read the run output, not your expectations. Five platforms publish, two skip, and the skip lines
name the reason. Instagram mints **no** short code — nothing there is clickable, so its CTA
points at the bio.

## Where the knowledge lives

- Platform rules: `scripts/lib/platforms.js` — `imageOk`, `imageAspectRange`.
- What a file actually is: `scripts/lib/media.js` — `probe()` sets `isImage` off ffprobe's
  container name; `check()` branches on it.
- Everything we say out loud: `config/voice.json`.
