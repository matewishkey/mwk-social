-- The dashboard's storage. Three tables and no projections, deliberately.
--
-- An earlier design maintained clip/clip_target projection tables in SQL so the
-- dashboard could render current state without scanning the log. That work is
-- already done on the box: mirror-ledger.json IS the projection, computed by the
-- thing that knows the truth. Shipping it as a snapshot removes a whole class of
-- drift — a projection that disagrees with the ledger — for less code.

-- Append-only. INSERT OR IGNORE on the ULID makes a retried batch free, and the
-- unique dedupe_key stops the same decision being recorded twice from two runs.
CREATE TABLE IF NOT EXISTS event (
  id          TEXT PRIMARY KEY,
  dedupe_key  TEXT UNIQUE,
  ts          TEXT NOT NULL,
  run_id      TEXT,
  source      TEXT,
  kind        TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'info',
  clip_id     TEXT,
  platform    TEXT,
  account_id  TEXT,
  post_key    TEXT,
  url         TEXT,
  message     TEXT,
  data        TEXT,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_ts   ON event (ts DESC);
CREATE INDEX IF NOT EXISTS event_kind ON event (kind, ts DESC);

-- Current state, shipped whole rather than rebuilt from the log: one row per
-- kind, last writer wins.
CREATE TABLE IF NOT EXISTS snapshot (
  name       TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The heartbeat. The uploader sends an empty batch when idle, because without
-- one "nothing happened" and "the box is off" look identical on a dashboard.
CREATE TABLE IF NOT EXISTS ingest_batch (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  count   INTEGER NOT NULL,
  source  TEXT
);
CREATE INDEX IF NOT EXISTS ingest_at ON ingest_batch (at DESC);

-- ---------------------------------------------------------------------------
-- Added with the app-shell dashboard: the queue, short links and the metrics
-- we bank ourselves.

-- Posts waiting for a slot. The Worker writes rows here from the queue form;
-- the box claims them one at a time when its own pace rules say it may post.
-- The pace lives on the box, not here — this table is a to-do list, not a
-- scheduler, so there is exactly one thing deciding when a post goes out.
CREATE TABLE IF NOT EXISTS queue_item (
  id            TEXT PRIMARY KEY,     -- ULID minted by the Worker
  created_at    TEXT NOT NULL,
  created_by    TEXT,                 -- the Access identity that queued it
  status        TEXT NOT NULL DEFAULT 'queued',  -- queued|claimed|posted|failed|cancelled
  body          TEXT NOT NULL,        -- the post text
  platforms     TEXT NOT NULL,        -- JSON array; [] means "wherever it fits"
  media_key     TEXT,                 -- R2 object key, when a file was uploaded
  media_url     TEXT,                 -- or a URL, when one was pasted
  media_type    TEXT,
  first_comment INTEGER NOT NULL DEFAULT 1,
  priority      INTEGER NOT NULL DEFAULT 0,      -- higher jumps the line
  claimed_at    TEXT,
  posted_at     TEXT,
  result        TEXT,                 -- JSON, per-platform outcome
  note          TEXT
);
CREATE INDEX IF NOT EXISTS queue_ready ON queue_item (status, priority DESC, created_at);

-- One short code per (destination, platform, clip), so a click tells us which
-- channel and which video earned it. Codes are never reused.
CREATE TABLE IF NOT EXISTS link (
  code       TEXT PRIMARY KEY,
  target     TEXT NOT NULL,
  platform   TEXT,
  clip_id    TEXT,
  post_key   TEXT,
  label      TEXT,
  created_at TEXT NOT NULL
);

-- One row per click. Deliberately no IP, no user agent, no cookie: the channel
-- and the time answer the only question we have, and storing nothing personal
-- keeps this out of consent territory entirely.
CREATE TABLE IF NOT EXISTS click (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL,
  at           TEXT NOT NULL,
  referer_host TEXT
);
CREATE INDEX IF NOT EXISTS click_code ON click (code, at DESC);
CREATE INDEX IF NOT EXISTS click_at   ON click (at DESC);

-- Daily per-platform metrics, banked as they arrive. Zernio keeps roughly
-- twelve months per account; this is the part that cannot be backfilled once
-- that window rolls, which is the whole reason it is a table and not a snapshot.
CREATE TABLE IF NOT EXISTS daily_metric (
  date        TEXT NOT NULL,
  platform    TEXT NOT NULL,
  post_count  INTEGER, impressions INTEGER, reach INTEGER, views INTEGER,
  likes       INTEGER, comments INTEGER, shares INTEGER, saves INTEGER, clicks INTEGER,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (date, platform)
);

-- Follower counts over time, same reasoning.
CREATE TABLE IF NOT EXISTS follower_point (
  day        TEXT NOT NULL,
  account_id TEXT NOT NULL,
  platform   TEXT, username TEXT, followers INTEGER,
  PRIMARY KEY (day, account_id)
);

-- The "your turn" list: things no API can do for us, chiefly sharing a Facebook
-- post to a personal timeline. A row is a link to click, not a task to type.
CREATE TABLE IF NOT EXISTS manual_action (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  kind       TEXT NOT NULL,
  platform   TEXT, clip_id TEXT, url TEXT, label TEXT,
  done_at    TEXT, done_by TEXT
);
CREATE INDEX IF NOT EXISTS manual_open ON manual_action (done_at, created_at DESC);

-- YouTube descriptions the box has drafted. A video with no description is
-- filled in automatically — there is nothing to overwrite and the original is
-- backed up on the box either way. A video that already has one only ever gets
-- a PROPOSAL, which sits here until someone says yes.
CREATE TABLE IF NOT EXISTS yt_proposal (
  video_id     TEXT PRIMARY KEY,
  title        TEXT,
  current_text TEXT,
  proposed     TEXT,
  state        TEXT NOT NULL DEFAULT 'proposed',  -- proposed|approved|applied|rejected
  proposed_at  TEXT NOT NULL,
  decided_at   TEXT, decided_by TEXT, applied_at TEXT
);
CREATE INDEX IF NOT EXISTS yt_state ON yt_proposal (state, proposed_at DESC);

-- The personal-account commentary for a LinkedIn quote-reshare. Empty means no
-- reshare: the thought on top is his to write, never one to generate, so the
-- absence of words is a decision rather than a gap to fill.
ALTER TABLE queue_item ADD COLUMN reshare_text TEXT;

-- A custom first comment for one queued post, replacing the rotating CTA.
-- Any url in it is swapped for a tracked short link before it goes out, so
-- "which link earned this click" stays answerable for every link we publish,
-- not only the call to action.
ALTER TABLE queue_item ADD COLUMN comment_text TEXT;

-- Topic tags for one queued post, as a JSON array. Everyday words only — see
-- the rule in CLAUDE.md. Empty means no topic tags, only the always-on pair.
ALTER TABLE queue_item ADD COLUMN topics TEXT;

-- A link preview fetch is not a click. Platforms fetch a url to build the card,
-- and every fetch hits the redirect — the first live post showed 18 "clicks" on
-- one link within three minutes. The User-Agent is read to DECIDE, and still
-- never stored: the flag is all we keep.
-- 0 = looked human, 1 = looked automated, 2 = logged before this column existed
-- and therefore unknown. Only 0 counts as a click: calling an unclassified hit
-- human would be a guess, and the User-Agent that would settle it was never
-- stored — correctly.
ALTER TABLE click ADD COLUMN bot INTEGER NOT NULL DEFAULT 0;

-- An optional landscape cut of the same clip. One video per post is a hard
-- limit on every platform, so the two versions can never ride together — the
-- box publishes the vertical one to the vertical surfaces and this one to the
-- rest, as separate posts.
ALTER TABLE queue_item ADD COLUMN media_wide_key TEXT;
ALTER TABLE queue_item ADD COLUMN media_wide_url TEXT;

-- Whether the personal LinkedIn account reposts the company post. Separate from
-- reshare_text on purpose: a plain repost with no commentary is the default, and
-- an empty comment must not read as "do not repost".
ALTER TABLE queue_item ADD COLUMN reshare INTEGER NOT NULL DEFAULT 1;

-- A retry of an earlier item, carrying only the platforms that failed on it.
-- The point of naming the original is the SHORT CODE: run-queue derives a post's
-- tracked links from `queue:<id>`, so a retry under a fresh id would mint a
-- different code for the same post and split its clicks in two.
ALTER TABLE queue_item ADD COLUMN retry_of TEXT;

-- ---------------------------------------------------------------------------
-- Campaigns (2026-08-22). Every link ever minted pointed at the same sign-up
-- page with no way to tell one placement from another, so "which post earned
-- this click" was answerable and "which campaign earned it" was not.
--
-- campaign  what this link is FOR   ("bio", "og-generator", "x-replies")
-- medium    where it was placed     ("caption", "comment", "reply", "profile")
-- source    is the existing `platform` column — the network it was minted for.
--
-- The redirect passes NOTHING of this on to the destination. These three live
-- on our side only: the code already identifies the placement, so appending
-- utm_ parameters would count the same click twice and would make a redirect
-- look like more tracking than it does. (A `utm` column existed for about an
-- hour on 2026-08-22 and was dropped — mate's call, keep it slim.)
ALTER TABLE link ADD COLUMN campaign TEXT;
ALTER TABLE link ADD COLUMN medium TEXT;
-- Who minted it: an Access identity for one made by hand on the dashboard, or
-- the job name for one the pipeline minted. Blank for everything before this.
ALTER TABLE link ADD COLUMN created_by TEXT;
-- Free text for a link made by hand — what it is, where it went, why.
ALTER TABLE link ADD COLUMN note TEXT;
CREATE INDEX IF NOT EXISTS link_campaign ON link (campaign, created_at DESC);

-- ---------------------------------------------------------------------------
-- Reply targets: GONE (2026-08-23). The X reply pipeline is retired — X blocked
-- programmatic replies on 23 February 2026 on every plan below Enterprise, so
-- the only version left was a page he copied off by hand, and that was more of
-- his attention than the idea had earned. X strategy is now follows only; the
-- list of who lives in config/follow.json.
--
-- Dropped rather than left standing: a table nothing writes is a table somebody
-- reads in six months and believes.
DROP TABLE IF EXISTS reply_target;

-- ---------------------------------------------------------------------------
-- What KIND of change a proposal is, decided by the box that made it rather
-- than guessed from the text at render time.
--
-- The dashboard's bulk approve splits "one line of boilerplate moved" from
-- "your words were replaced", and it was inferring that from a line-by-line
-- diff. That inference holds only while the boilerplate happens to be one line.
-- The 2026-08-24 brand update made the blurb's opening three lines, and every
-- proposal would have been labelled a rewrite while each video's own summary
-- was in fact untouched — the label lying in the direction that makes him click
-- through 23 diffs to approve nothing he needed to read.
--
-- yt-description.js knows which path it took: 'swap' means findBlurb matched and
-- only the blurb was replaced, 'rebuild' means the description was regenerated.
-- NULL is every row filed before this column existed; the dashboard falls back
-- to the diff for those.
ALTER TABLE yt_proposal ADD COLUMN kind TEXT;

-- ---------------------------------------------------------------------------
-- How many times the box has claimed this item and handed it straight back.
--
-- The release path is deliberate — "put it back rather than burn it" — but it
-- had no floor, and nothing else stopped a repeat: a failure that throws emits
-- queue.failed rather than queue.posted, so the pace never counts it either.
-- A deterministic failure (a media url that has expired, a silent clip no
-- platform will take, lapsed Zernio auth) therefore re-claimed itself every
-- five minutes for ever: 288 cycles a day, 288 error events, and an item that
-- never surfaced as needing a person.
--
-- Counted on the Worker, which owns the row, so both release paths are covered.
-- Reset to 0 by a re-queue from the dashboard: a human looking at it is exactly
-- the condition the counter was waiting for.
ALTER TABLE queue_item ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Who he sent this one to, when he shares a link by hand.
--
-- mwkshow.com/<code>/<tag> — the tag is a label HE types into the url as he
-- sends it ("natalie", "tom", "book-club"), so one code serves everybody and he
-- mints nothing per person. It is his own word, not anything read off the
-- visitor: still no IP, no user agent, no cookie, no fingerprint, which is what
-- keeps a redirect out of consent territory.
--
-- It says the link labelled natalie was opened. It does NOT say Natalie opened
-- it — links get forwarded, and a messenger fetches the url to build a preview
-- the moment it is sent. The bot flag is what keeps the second one honest.
ALTER TABLE click ADD COLUMN tag TEXT;
CREATE INDEX IF NOT EXISTS click_tag ON click (tag, at DESC);

-- The settle curve (2026-08-26, issue #31). daily_metric is upserted because a
-- day's numbers keep moving after the day ends — but the upsert overwrote all
-- nine metrics AND updated_at unconditionally, so nothing recorded the movement.
-- That left "is the last complete day settled?" unanswerable, and the trend
-- excludes today on instinct rather than on a measurement.
--
-- This keeps the superseded value instead of dropping it. Two timestamps,
-- because the gap between them IS the lag: written_at is when the value we are
-- replacing was recorded, superseded_at is when a platform changed its mind.
-- Nothing reads this yet — it is a fortnight of evidence first, then the
-- exclusion gets set from data or the trend loses the day it cannot stand up.
CREATE TABLE IF NOT EXISTS daily_metric_revision (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  date          TEXT NOT NULL,
  platform      TEXT NOT NULL,
  post_count    INTEGER, impressions INTEGER, reach INTEGER, views INTEGER,
  likes         INTEGER, comments INTEGER, shares INTEGER, saves INTEGER, clicks INTEGER,
  written_at    TEXT NOT NULL,
  superseded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dmr_date ON daily_metric_revision (date, platform, superseded_at);

-- IS NOT, not <>: a metric going NULL -> 0 is a real change and <> answers NULL
-- to it, which would silently record nothing. A ship that re-writes identical
-- numbers must leave no row, or the lag is measured against our own cadence
-- instead of the platform's.
CREATE TRIGGER IF NOT EXISTS daily_metric_settle
BEFORE UPDATE ON daily_metric
WHEN OLD.post_count  IS NOT NEW.post_count
  OR OLD.impressions IS NOT NEW.impressions
  OR OLD.reach       IS NOT NEW.reach
  OR OLD.views       IS NOT NEW.views
  OR OLD.likes       IS NOT NEW.likes
  OR OLD.comments    IS NOT NEW.comments
  OR OLD.shares      IS NOT NEW.shares
  OR OLD.saves       IS NOT NEW.saves
  OR OLD.clicks      IS NOT NEW.clicks
BEGIN
  INSERT INTO daily_metric_revision
    (date, platform, post_count, impressions, reach, views, likes, comments,
     shares, saves, clicks, written_at, superseded_at)
  VALUES
    (OLD.date, OLD.platform, OLD.post_count, OLD.impressions, OLD.reach,
     OLD.views, OLD.likes, OLD.comments, OLD.shares, OLD.saves, OLD.clicks,
     OLD.updated_at, NEW.updated_at);
END;
