/*
 * When may something go out?
 *
 * One answer, for the one thing that publishes. Everything now goes out through
 * the queue, so the event log is the complete record of what we have sent — no
 * second source to reconcile against.
 *
 * There is no time-of-day window (mate's call, 2026-08-21): the audience is
 * spread across timezones and reads a post whenever it reaches them, so holding
 * one back for a "good hour" only delays it. What is left is volume — a daily
 * cap and a minimum gap — so the feed never gets a burst.
 *
 * The day boundary for that cap is still the AUDIENCE's, never the box's. This
 * machine runs Etc/UTC; counting UTC days would reset the cap twelve hours
 * early against a Brisbane audience.
 */
'use strict';

const TZ = process.env.MWK_TZ || 'Australia/Brisbane';

const DEFAULTS = {
  perDay: 6,
  minGapMinutes: 90,
  tz: TZ,
};

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

  const last = sent[sent.length - 1];
  if (last) {
    const gap = (now - new Date(last)) / 60000;
    if (gap < cfg.minGapMinutes) {
      return `only ${Math.round(gap)} min since the last one (${cfg.minGapMinutes} min minimum)`;
    }
  }
  return null;
}

/** The next instant a post could go out, as an ISO string. */
function nextSlot(events = [], opts = {}, now = new Date()) {
  const cfg = { ...DEFAULTS, ...opts };
  const sent = sentTimes(events);
  const last = sent[sent.length - 1];

  // Earliest candidate: the minimum gap after the last post, or now.
  let at = new Date(Math.max(now.getTime(),
    last ? new Date(last).getTime() + cfg.minGapMinutes * 60000 : 0));

  // Then walk forward over full days. Bounded rather than while(true): a bad
  // timezone or a silly cap must not spin.
  for (let guard = 0; guard < 96; guard++) {
    const here = zoned(at, cfg.tz);
    const todays = sent.filter((s) => zoned(new Date(s), cfg.tz).day === here.day).length;
    if (todays >= cfg.perDay) {
      at = new Date(at.getTime() + 60 * 60000);       // an hour at a time until the day turns
      continue;
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
    tz: cfg.tz,
    why,
    nextAt: next ? new Intl.DateTimeFormat('en-GB', {
      timeZone: cfg.tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(next)) : null,
    nextAtIso: next,
    computedAt: now.toISOString(),
  };
}

module.exports = { TZ, DEFAULTS, zoned, whyNotNow, nextSlot, status, sentTimes };
