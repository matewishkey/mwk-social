/*
 * The dashboard's markup. The Worker's other paths need Access headers or a D1
 * binding to exercise; the rendering does not, and it is the part where a
 * mistake is silent — a wrong status colour or an unescaped caption.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'web', 'src', 'index.js'));

const ENV = { TZ_DISPLAY: 'Australia/Brisbane' };
const LEDGER = {
  updatedAt: new Date().toISOString(),
  body: { clips: { 'facebook:123': {
    publishedAt: '2026-08-18T21:33:00.000Z',
    caption: 'Ever wondered why prompts beat websites?',
    targets: {
      threads: { status: 'posted', url: 'https://www.threads.com/x', note: 'mirrored' },
      twitter: { status: 'posted', url: 'https://twitter.com/x' },
      tiktok: { status: 'pending' },
      instagram: { status: 'blocked', note: 'held' },
    },
  } } },
};

const base = (over = {}) => ({
  env: ENV, email: 'mate@matewishkey.com', beat: { at: new Date().toISOString(), count: 3 },
  snapshots: { 'mirror-ledger': LEDGER }, events: [], counts: [], kind: '', level: '', ...over,
});

test('the page renders the ledger as a matrix', async () => {
  const { render } = await load();
  const html = render(base());
  assert.match(html, /Ever wondered why prompts beat websites\?/);
  assert.match(html, /s-posted/);
  assert.match(html, /s-pending/);
  assert.match(html, /s-blocked/);
  assert.match(html, /https:\/\/www\.threads\.com\/x/);
  assert.match(html, /<b>2<\/b>/, 'two posted');
});

// "Nothing happened" and "the box is off" must never look the same. The
// heartbeat tile is the only thing separating them.
test('a stale heartbeat is called out, a fresh one is not', async () => {
  const { render } = await load();
  assert.match(render(base()), /tile ok/);
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  assert.match(render(base({ beat: { at: old, count: 0 } })), /tile bad/);
  assert.match(render(base({ beat: null })), /never/);
});

test('an empty database renders rather than throwing', async () => {
  const { render } = await load();
  const html = render(base({ snapshots: {}, beat: null }));
  assert.match(html, /No mirror ledger has been shipped yet/);
  assert.match(html, /nothing yet/);
});

// Captions and messages come from the platforms, not from us.
test('text from a post cannot inject markup', async () => {
  const { render } = await load();
  const nasty = '<script>alert(1)</script>';
  const html = render(base({
    events: [{ ts: new Date().toISOString(), kind: 'comment.posted', level: 'info',
      platform: 'instagram', message: nasty, url: null }],
  }));
  assert.ok(!html.includes(nasty), 'the raw script tag must not survive');
  assert.match(html, /&lt;script&gt;/);
});

test('a url in an event becomes a link, and one without stays text', async () => {
  const { render } = await load();
  const withUrl = render(base({ events: [{ ts: new Date().toISOString(), kind: 'mirror.posted',
    level: 'info', platform: 'threads', message: 'mirrored', url: 'https://example.com/p' }] }));
  assert.match(withUrl, /<a href="https:\/\/example\.com\/p"/);
  const without = render(base({ events: [{ ts: new Date().toISOString(), kind: 'run.started',
    level: 'info', platform: null, message: 'started', url: null }] }));
  assert.ok(!/<a href="https/.test(without.split('<h2>Events')[1]));
});
