/*
 * THE GATE ON HIS WORDS. Everything else in this pipeline is checked byte for
 * byte — the CTA marker, the link slot, the aspect ratio — and the body of the
 * post was checked by nobody. On 2026-09-13 that let Restream's auto-caption
 * ("Ever thought about how much a customer really costs? 🤔💰") go out under
 * his name on five platforms, two of which cannot delete: a question hook with
 * emoji, the exact register he rejected two rounds of drafts over.
 *
 * Two rules, both his: no emoji anywhere the show speaks, and a headline that
 * asks is a hook — "a question headline invites; an instruction orders" is
 * the CLAUDE.md line, and a hook is the named failure mode. The first line is
 * the headline. Everything else about voice is judgement and stays with the
 * person typing; these two are mechanical and were the ones that got through.
 *
 * scripts/lib/words.js is the CommonJS twin for the box. A test runs the same
 * fixtures through both and fails if they ever disagree.
 */
export const EMOJI = /\p{Extended_Pictographic}/u;

/** @returns {string[]} empty when the words may go; every reason when not. */
export function wordProblems(body) {
  const text = String(body || '');
  const problems = [];
  if (EMOJI.test(text)) problems.push('emoji — nothing the show says out loud carries one');
  // The first non-blank line, with any trailing emoji stripped first — the
  // caption this exists for ends "...costs? 🤔💰", and the question mark is
  // what makes it a hook, not what happens to follow it.
  const first = (text.split('\n').map((l) => l.trim()).find(Boolean) || '')
    .replace(/[\p{Extended_Pictographic}\uFE0F\s]+$/u, '');
  if (/\?$/.test(first)) problems.push('the first line asks a question — that is a hook, and a hook reads as marketing');
  return problems;
}
