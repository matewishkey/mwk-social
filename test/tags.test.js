/*
 * The hashtag rule, stated by mate on 2026-08-21 and absolute:
 *
 *   "IT ALWAYS HAS TO BE everyday people focus NEVER EVER tech specific.
 *    #xero is well known, #cloudflare is not at all. #AIHallucination is
 *    borderline. We need to use tag for normal humans not for tech people."
 *
 * The model is prompted for this, but a prompt is a request, not a guarantee —
 * so the blocklist is the hard stop underneath it. These tests are the record
 * of which words are on which side of the line, using his own examples.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { clean, BLOCKED } = require('../scripts/lib/topic-tags');

const survives = (tag) => clean([tag]).length === 1;

test('the words he named land on the right side of the line', () => {
  assert.ok(survives('Xero'), '#Xero is well known to the people we want — it must survive');
  assert.ok(!survives('Cloudflare'), '#Cloudflare means nothing outside tech — it must be dropped');
});

// Every one of these came out of a real video and went out on a real post
// before the rule existed. They are the concrete thing being fixed.
test('the tech tags we actually published are now blocked', () => {
  for (const tag of ['Cloudflare', 'DomainTransfer', 'WebDevelopment', 'Observability',
    'GenerativeEngineOptimization', 'ErrorReporting', 'Debugging', 'Troubleshooting',
    'TechSupport',
    'Prompting', 'UserInterfaces', 'UserExperience', 'UXDesign', 'SEO',
    'ProductDifferentiation', 'NicheStrategy', 'WorkflowAutomation', 'SoftwareInteraction']) {
    assert.ok(!survives(tag), `${tag} is developer vocabulary and must not go out`);
  }
});

test('everyday words a shop owner would use still get through', () => {
  for (const tag of ['Xero', 'Invoicing', 'Bookkeeping', 'Spreadsheets', 'Scheduling',
    'LatePayments', 'Paperwork', 'Budgeting', 'Website', 'Gaming', 'Trading']) {
    assert.ok(survives(tag), `${tag} is an ordinary word and should survive`);
  }
});

// These describe HOW everything here is made, so they would ride on every
// single post and distinguish nothing.
test('the method is never the subject', () => {
  for (const tag of ['AI', 'ChatGPT', 'Claude', 'Prompt', 'PromptEngineering', 'Coding',
    'Programming', 'Software', 'Developer', 'MachineLearning', 'NoCode']) {
    assert.ok(!survives(tag), `${tag} describes the method, not what the video is about`);
  }
});

test('engagement bait is still blocked', () => {
  for (const tag of ['fyp', 'viral', 'trending', 'motivation', 'hustle', 'entrepreneur']) {
    assert.ok(!survives(tag), `${tag} is bait`);
  }
});

test('the blocklist is matched case-insensitively', () => {
  assert.ok(!survives('CLOUDFLARE'));
  assert.ok(!survives('cloudflare'));
  assert.ok(!survives('CloudFlare'));
});

test('the always-on pair is never subject to this — it is brand, not topic', () => {
  const voice = require('../scripts/lib/voice');
  for (const t of voice.alwaysTags()) {
    assert.ok(!BLOCKED.has(t.replace('#', '').toLowerCase()),
      `${t} is an always-on brand tag and must not be blocklisted`);
  }
});
