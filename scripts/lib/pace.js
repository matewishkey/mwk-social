/*
 * When may something go out?
 *
 * One answer, shared by the mirror and the queue, because two schedulers would
 * eventually disagree about what today already holds — and the audience sees
 * one feed, not two pipelines.
 *
 * Everything here is in the AUDIENCE's timezone, never the box's. This machine
 * runs Etc/UTC; unqualified, a 09:00-21:00 window would put every post out
 * between 19:00 and 07:00 Brisbane — the entire window overnight. Day
 * boundaries for the daily cap are zoned for the same reason, or the cap
 * resets twelve hours early.
 */
'use strict';

const TZ = process.env.MWK_TZ || 'Australia/Brisbane';

const DEFAULTS = {
  perDay: 6,
  startHour: 9,
  endHour: 21,
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

/**
 * Every publish we have made, newest last. Two sources, each authoritative for
 * its own half: the ledger records what the mirror sent, the event log records
 * what the queue sent. Neither can see the other's work, so both are read.
 */
function sentTimes(ledger, events) {
  const out = [];
  for (const clip of Object.values((ledger && ledger.clips) || {})) {
    for (const t of Object.values(clip.targets || {})) {
      if (t.note === 'mirrored' && t.at) out.push(t.at);
    }
  }
  for (const e of events || []) {
    if (e.kind === 'queue.posted' && e.ts) out.push(e.ts);
  }
  return out.sort();
}

/**
 * @returns {string|null} why not now, or null if now is fine.
 */
function whyNotNow(ledger, opts = {}, now = new Date(), events = []) {
  const cfg = { ...DEFAULTS, ...opts };
  const here = zoned(now, cfg.tz);
  if (here.hour < cfg.startHour || here.hour > cfg.endHour) {
    return `${here.hour}:00 ${cfg.tz} is outside the ${cfg.startHour}:00-${cfg.endHour}:00 window`;
  }
  const sent = sentTimes(ledger, events);
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
function nextSlot(ledger, opts = {}, now = new Date(), events = []) {
  const cfg = { ...DEFAULTS, ...opts };
  const sent = sentTimes(ledger, events);
  const last = sent[sent.length - 1];

  // Earliest candidate: the minimum gap after the last post, or now.
  let at = new Date(Math.max(now.getTime(),
    last ? new Date(last).getTime() + cfg.minGapMinutes * 60000 : 0));

  // Then walk forward over closed windows and full days. Bounded rather than
  // while(true): a bad timezone or a silly cap must not spin.
  for (let guard = 0; guard < 96; guard++) {
    const here = zoned(at, cfg.tz);
    const todays = sent.filter((s) => zoned(new Date(s), cfg.tz).day === here.day).length;
    if (todays >= cfg.perDay || here.hour > cfg.endHour) {
      at = new Date(at.getTime() + 60 * 60000);       // an hour at a time until the day turns
      continue;
    }
    if (here.hour < cfg.startHour) {
      at = new Date(at.getTime() + (cfg.startHour - here.hour) * 3600_000 - here.minute * 60000);
      continue;
    }
    return at.toISOString();
  }
  return null;
}

/** What the dashboard shows about the pace. Computed here so the page cannot disagree. */
function status(ledger, opts = {}, now = new Date(), events = []) {
  const cfg = { ...DEFAULTS, ...opts };
  const here = zoned(now, cfg.tz);
  const sent = sentTimes(ledger, events);
  const today = sent.filter((at) => zoned(new Date(at), cfg.tz).day === here.day).length;
  const why = whyNotNow(ledger, cfg, now, events);
  const next = nextSlot(ledger, cfg, now, events);
  return {
    perDay: cfg.perDay,
    today,
    window: `${cfg.startHour}:00–${cfg.endHour}:00`,
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
