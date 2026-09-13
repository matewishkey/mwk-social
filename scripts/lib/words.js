/*
 * The box's copy of web/src/lib/words.js — the gate on his words. Two runtimes,
 * one rule; a test runs the same fixtures through both and fails on any
 * disagreement. The reasoning is on the Worker copy; do not let them drift.
 */
'use strict';

const EMOJI = /\p{Extended_Pictographic}/u;

function wordProblems(body) {
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

module.exports = { wordProblems, EMOJI };
