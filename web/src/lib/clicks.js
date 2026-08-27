/*
 * WHAT COUNTS AS A CLICK.
 *
 * `bot = 0` was the whole test until 2026-08-27, and it was wrong by a factor
 * of about four. The User-Agent regex in links.js catches the fetchers that
 * announce themselves — facebookexternalhit, Twitterbot, LinkedInBot — and
 * misses the ones that present as an ordinary browser. Those land in the
 * database indistinguishable from a person, one row at a time.
 *
 * Except they do not arrive like a person. Measured over the whole click table
 * (809 hits, 182 of them counted as human):
 *
 *   gap to the previous hit on the same code, for counted hits
 *   0s: 47   1s: 27   2s: 2   3s: 4   4s: 4   5s: 5   10s: 1   12s: 1
 *   15s: 1   34s: 1   35s: 1   44s: 1   45s: 1   46s: 1   then 94s, 118s, ...
 *
 * A dense cluster inside five seconds, a thin tail to 46 seconds, then nothing
 * until 94. That is not two kinds of people, it is people and fetch waves — and
 * the gap between 46s and 94s is where the line goes. It was not chosen round.
 *
 * The shape is unmistakable once you look at one code. `s8`, a Short's code,
 * took five hits between 05:40:45.457 and 05:40:50.935 on 26 Aug and FOUR of
 * them counted as human. Four people cannot click the same brand-new link
 * inside five and a half seconds. Better still, those bursts land at the minute
 * we WROTE the description — yt_proposal.applied_at for that batch is
 * 2026-08-26T05:41:48 — so they are YouTube resolving the links in a
 * description nobody had watched yet.
 *
 * THE REFERER IS NOT A POSITIVE CONTROL, and this is the trap that nearly got
 * the fix wrong. Facebook's scraper sends `Referer: www.facebook.com`. Code
 * `m7cqf` took 17 hits in six seconds on 21 Aug, two of them referred from
 * www.facebook.com and m.facebook.com and both flagged human. A facebook
 * referer proves the hit came from Facebook's infrastructure, never that a
 * person was holding the phone.
 *
 * So the rule is about SHAPE, and nothing else:
 *
 *   A CLICK COUNTS WHEN IT ARRIVES ALONE. A person's click has no other hit on
 *   the same code within a minute either side of it. A fetch wave arrives in a
 *   crowd.
 *
 * Symmetric, deliberately. The backward-looking version — "not within 60s AFTER
 * a previous hit" — is the obvious way to write a de-duplication and it keeps
 * the FIRST hit of every wave, which is still a crawler: it left the YouTube
 * description on 30 clicks where the symmetric rule leaves 2. Collapsing a wave
 * to one still counts the wave.
 *
 * What it costs: a real person who clicks within a minute of a preview fetch is
 * dropped. That is the safe direction and the same one links.js already chose —
 * understating a real number beats inventing one. If a code ever shows many
 * spread-out sub-minute hits carrying real referers, this is the line to
 * revisit; at 49 counted clicks in 24 days we are nowhere near two people
 * clicking the same link in the same minute.
 */

/* The gap in the measured distribution: past the 46s tail, short of the 94s. */
export const BURST_SECONDS = 60;

/**
 * SQL for "this hit arrived alone".
 *
 * @param {string} alias the alias the `click` row is bound to in the caller.
 *   Every call site passes its own, because the correlated subquery needs a
 *   name that is not the outer one — `b` is reserved here for that.
 */
export const alone = (alias = 'c') => `NOT EXISTS (
  SELECT 1 FROM click b
   WHERE b.code = ${alias}.code AND b.id <> ${alias}.id
     AND ABS((julianday(${alias}.at) - julianday(b.at)) * 86400) < ${BURST_SECONDS})`;

/**
 * SQL for "count this hit as a person": flagged human AND arrived alone.
 *
 * Every query that counts clicks for display goes through this. A raw
 * `bot = 0` anywhere else is the bug this module exists to stop coming back.
 */
export const counted = (alias = 'c') => `${alias}.bot = 0 AND ${alone(alias)}`;

/**
 * The other side of the same split, so a page can show the honest denominator:
 * everything that was NOT a person, whether it announced itself or not.
 */
export const automated = (alias = 'c') => `NOT (${counted(alias)})`;
