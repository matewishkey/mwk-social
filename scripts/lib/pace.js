/*
 * When may something go out?
 *
 * One answer, for the one thing that publishes. Everything now goes out through
 * the queue, so the event log is the complete record of what we have sent — no
 * second source to reconcile against.
 *
 * THERE IS A TIME-OF-DAY WINDOW AGAIN SINCE 2026-09-21, AND IT REVERSES THE
 * 2026-08-21 CALL. The old reasoning was that the audience is spread across
 * timezones, so holding one back for a "good hour" only delays it. What
 * changed is the arithmetic: **07:00-11:00 Brisbane is 17:00-21:00 in New
 * York**, the evening of the audience he actually wants, and at ONE post a
 * day the slot matters in a way it did not at six. Mate: "i think better
 * morning is better", "the morning giving us the best coverage", "i do not
 * care about hungary at all" (it is 23:00-03:00 there, ruled irrelevant).
 *
 * The other half of the rule is unchanged: volume. A daily cap and a minimum
 * gap, so the feed never gets a burst.
 *
 * ⚠ **The window is REASONING, not a measurement.** Across 253 posts the
 * publish hour explains nothing once post age is controlled for. It is a
 * decision about who we are aiming at and must never be quoted as a finding
 * about performance.
 *
 * The cost is real and is the point: something queued at noon waits until
 * tomorrow morning. `MWK_WINDOW` ("7-11", or "off") is the way out.
 *
 * The day boundary for that cap is still the AUDIENCE's, never the box's. This
 * machine runs Etc/UTC; counting UTC days would reset the cap twelve hours
 * early against a Brisbane audience.
 *
 * A FIXED GAP IS A FINGERPRINT, AND OURS WAS EXACTLY 95 MINUTES (mate,
 * 2026-09-21: "make sure we are randomizing stuff"). The gap was a constant
 * 90 and the timer fires every five minutes, so consecutive posts landed 95
 * minutes apart almost every time, on a handful of minute values: of 42
 * publishes, 20 landed at :04-:08 past the hour. Nothing about that reads as
 * a person with a phone. `jitterMinutes` adds 0-60 minutes on top of the
 * minimum gap.
 *
 * IT HAS TO BE DETERMINISTIC, AND THIS IS THE WHOLE TRAP. The pace is
 * recomputed from scratch every five minutes, so a fresh Math.random() per
 * tick is not a delay of 0-60 minutes — it is the MINIMUM of a dozen rolls,
 * which collapses to roughly zero and is biased small. The jitter is hashed
 * off the LAST POST'S TIMESTAMP instead: the same answer at every tick, a
 * different one after each publish. A held item's unlock is jittered too,
 * but at the other end — queue-add.js rolls it once and stores it, because
 * that value is written a single time and never recomputed.
 */
'use strict';

const TZ = process.env.MWK_TZ || 'Australia/Brisbane';

/**
 * "7-11" to { from: 7, to: 11 }, "off" (or anything unparseable) to null.
 * Unparseable is deliberately null rather than a throw: a typo in an env var
 * must not stop the queue publishing altogether.
 */
function parseWindow(spec) {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(String(spec || ''));
  if (!m) return null;
  const from = Number(m[1]); const to = Number(m[2]);
  if (from < 0 || to > 24 || from >= to) return null;
  return { from, to };
}

const DEFAULTS = {
  /*
   * ONE (mate, 2026-09-21: "I want to focus one short per a day instead of
   * overdo it... i think it is better i am learning things"). It was six on
   * the morning of the 21st, then TWO by lunchtime after the Pinterest
   * backfill put EIGHT pins out in a single day behind a priority of -1 —
   * each one legal under the cap and the gap, and the whole day reading as a
   * machine emptying a list. One is the same decision taken further, and the
   * reason he gave is not throughput: he would rather make one clip he has
   * learned something from than feed a schedule.
   *
   * At one a day the minimum gap and its jitter can never bind — the cap
   * refuses first, every time. They stay because the cap is his number and
   * may move again, and a pace with no gap underneath it would be a burst
   * the day it does.
   *
   * A backfill now costs the WHOLE day rather than half of it, which is the
   * intended price: `--priority -1` orders the queue, so a pin goes out only
   * on a day he has written nothing. The cap is the only thing standing
   * between a backfill and a feed nobody wants to follow. Raising it is HIS
   * call and he has to say so; passing perDay in an opts object is how a
   * caller would quietly undo this, so do not.
   */
  perDay: 1,
  /*
   * The posting window in the AUDIENCE's hours, start inclusive and end
   * exclusive: 7 to 11 means a post may go from 07:00:00 to 10:59:59
   * Brisbane. `MWK_WINDOW=off` restores the old any-hour behaviour with no
   * deploy.
   */
  window: parseWindow(process.env.MWK_WINDOW || '7-11'),
  minGapMinutes: 90,
  jitterMinutes: 60,
  tz: TZ,
};

/*
 * FNV-1a, for a stable spread with no dependency. The point is not crypto, it
 * is that the same seed gives the same answer in this process and the next.
 */
function hash(seed) {
  let h = 2166136261;
  const str = String(seed);
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/*
 * FNV-1a ALONE DOES NOT SPREAD CONSECUTIVE DAY STRINGS, and the first version
 * of openingFor() shipped that way for about a minute: seven days running
 * came out 107, 112, 137, 142, 127, 132, 157 — a two-hour band out of three,
 * and neighbouring days five minutes apart. The avalanche is weak in the low
 * bits when the input changes only in its last character, which a date does.
 * This is murmur3's finalizer, and it is the difference between a jitter and
 * a slower metronome. The seed for the gap is a full timestamp and spreads on
 * its own, so jitterFor() is deliberately left as it was.
 */
function mix(h) {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507);
  x ^= x >>> 13;
  x = Math.imul(x, 3266489909);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Extra minutes on top of the minimum gap, 0..jitterMinutes inclusive.
 *
 * @param {string} seed anything stable between ticks. The caller passes the
 *   last post's timestamp, so the answer holds until the next publish moves it.
 */
function jitterFor(seed, jitterMinutes = DEFAULTS.jitterMinutes) {
  if (!seed || !jitterMinutes || jitterMinutes < 0) return 0;
  return hash(seed) % (Math.floor(jitterMinutes) + 1);
}

/*
 * WHEN THE WINDOW OPENS *TODAY* — a second fingerprint, and it only became
 * the whole story when the cap went to one.
 *
 * The gap jitter can never bind at one post a day: the cap refuses a second
 * post outright, so the only thing deciding the minute is the window's start
 * plus the first timer tick after it. That is 07:05 Brisbane, every single
 * morning, for ever — the exact thing mate asked us to stop doing on
 * 2026-09-21 ("make sure we are randomizing stuff"). At two a day it was half
 * the posts; at one it is all of them.
 *
 * So the day's opening slides. Hashed off the Brisbane DAY for the same
 * reason the gap is hashed off the last post: the pace is recomputed every
 * five minutes, and a fresh roll per tick is the minimum of a dozen rolls,
 * which collapses to zero.
 *
 * The range stops an hour short of the window's end, so the day always keeps
 * at least an hour of runway — a post that opened at 10:58 would have one
 * tick to publish in and then wait a day.
 *
 * @returns {number} minutes after `window.from` at which today may start.
 */
function openingFor(dayKey, cfg = DEFAULTS) {
  if (!cfg.window || !dayKey) return 0;
  const room = Math.max(0, (cfg.window.to - cfg.window.from) * 60 - 60);
  if (!room) return 0;
  return mix(hash(`open:${dayKey}`)) % (room + 1);
}

/** Minutes-since-midnight as "HH:MM", for the one-line reasons below. */
function clock(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The calendar day and hour at an instant, as the audience sees them. */
function zoned(date, tz = TZ) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Every publish we have made, newest last, straight off the event log. */
function sentTimes(events) {
  return (events || [])
    .filter((e) => e.kind === 'queue.posted' && e.ts)
    .map((e) => e.ts)
    .sort();
}

/**
 * @returns {string|null} why not now, or null if now is fine.
 */
function whyNotNow(events = [], opts = {}, now = new Date()) {
  const cfg = { ...DEFAULTS, ...opts };
  const here = zoned(now, cfg.tz);
  const sent = sentTimes(events);
  const todays = sent.filter((at) => zoned(new Date(at), cfg.tz).day === here.day);
  if (todays.length >= cfg.perDay) return `${todays.length} already went out today`;

  // The window is checked BEFORE the gap: when both are true, "not this hour"
  // is the more useful thing to read.
  if (cfg.window && (here.hour < cfg.window.from || here.hour >= cfg.window.to)) {
    return `${String(here.hour).padStart(2, '0')}:${String(here.minute).padStart(2, '0')} is outside `
      + `the ${cfg.window.from}:00-${cfg.window.to}:00 window`;
  }

  // Inside the window, but this day's opening has not come round yet. Two
  // distinct refusals on purpose: "wrong part of the day" and "right part of
  // the day, wrong minute" are different things to read at 07:10.
  if (cfg.window) {
    const open = cfg.window.from * 60 + openingFor(here.day, cfg);
    const minutes = here.hour * 60 + here.minute;
    if (minutes < open) {
      return `inside the window, but today opens at ${clock(open)} (it slides so we are not `
        + `posting at the same minute every morning)`;
    }
  }

  const last = sent[sent.length - 1];
  if (last) {
    const gap = (now - new Date(last)) / 60000;
    const extra = jitterFor(last, cfg.jitterMinutes);
    if (gap < cfg.minGapMinutes + extra) {
      return `only ${Math.round(gap)} min since the last one (${cfg.minGapMinutes} min minimum, `
        + `${extra} min of jitter on this one)`;
    }
  }
  return null;
}

/** The next instant a post could go out, as an ISO string. */
function nextSlot(events = [], opts = {}, now = new Date()) {
  const cfg = { ...DEFAULTS, ...opts };
  const sent = sentTimes(events);
  const last = sent[sent.length - 1];

  // Earliest candidate: the minimum gap PLUS this slot's jitter after the last
  // post, or now. The same jitterFor() call as whyNotNow, or the page would
  // promise a time the publisher then refuses.
  let at = new Date(Math.max(now.getTime(),
    last ? new Date(last).getTime()
      + (cfg.minGapMinutes + jitterFor(last, cfg.jitterMinutes)) * 60000 : 0));

  // Then walk forward over full days. Bounded rather than while(true): a bad
  // timezone or a silly cap must not spin.
  for (let guard = 0; guard < 96; guard++) {
    const here = zoned(at, cfg.tz);
    const todays = sent.filter((s) => zoned(new Date(s), cfg.tz).day === here.day).length;
    if (todays >= cfg.perDay) {
      at = new Date(at.getTime() + 60 * 60000);       // an hour at a time until the day turns
      continue;
    }
    if (cfg.window && (here.hour < cfg.window.from || here.hour >= cfg.window.to)) {
      // Step to the TOP of the next hour rather than adding an hour to a time
      // that has minutes on it, or the answer keeps the minutes of whenever
      // the page happened to load and drifts on every render.
      at = new Date(at.getTime() + (60 - here.minute) * 60000);
      at.setUTCSeconds(0, 0);
      continue;
    }
    if (cfg.window) {
      // The same openingFor() call whyNotNow makes, or the page promises a
      // minute the publisher then refuses. Jump straight to it rather than
      // stepping: it is a known instant on this day.
      const open = cfg.window.from * 60 + openingFor(here.day, cfg);
      const minutes = here.hour * 60 + here.minute;
      if (minutes < open) {
        at = new Date(at.getTime() + (open - minutes) * 60000);
        at.setUTCSeconds(0, 0);
        continue;
      }
    }
    return at.toISOString();
  }
  return null;
}

/** What the dashboard shows about the pace. Computed here so the page cannot disagree. */
function status(events = [], opts = {}, now = new Date()) {
  const cfg = { ...DEFAULTS, ...opts };
  const here = zoned(now, cfg.tz);
  const sent = sentTimes(events);
  const today = sent.filter((at) => zoned(new Date(at), cfg.tz).day === here.day).length;
  const why = whyNotNow(events, cfg, now);
  const next = nextSlot(events, cfg, now);
  return {
    perDay: cfg.perDay,
    today,
    minGapMinutes: cfg.minGapMinutes,
    jitterMinutes: cfg.jitterMinutes,
    window: cfg.window,
    tz: cfg.tz,
    why,
    nextAt: next ? new Intl.DateTimeFormat('en-GB', {
      timeZone: cfg.tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(next)) : null,
    nextAtIso: next,
    computedAt: now.toISOString(),
  };
}

module.exports = { TZ, DEFAULTS, zoned, whyNotNow, nextSlot, status, sentTimes, jitterFor,
  openingFor, parseWindow };
