/*
 * What a run concludes when only some of it worked.
 *
 * This exists because of 2026-08-21. X's media upload failed at 99%, the
 * exception unwound past four platforms that had already published, the item
 * went back to 'queued' and the next tick posted the lot again. Three copies on
 * TikTok, Facebook and LinkedIn before it was stopped by hand — and TikTok has
 * no delete API, so two of them are still there.
 *
 * The rule, in one line: once anything is live, the item is never queued again.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { verdict } = require('../scripts/run-queue.js');

const live = (p) => ({ platform: p, status: 'published', url: `https://x/${p}` });
const dead = (p) => ({ platform: p, status: 'failed', url: null, error: 'media processing failed' });

test('a partial failure is posted, never queued again', () => {
  const v = verdict([live('facebook'), live('linkedin'), live('youtube'), dead('twitter')]);
  assert.equal(v.result.status, 'posted');
  assert.notEqual(v.result.status, 'queued');
  assert.equal(v.anyLive, true);
});

test('the failure is named, so a human can decide about it', () => {
  const v = verdict([live('facebook'), dead('twitter'), dead('tiktok')]);
  assert.match(v.result.note, /twitter, tiktok failed/);
  assert.match(v.result.note, /by hand/);
});

test('nothing live is a failure, and that one may be retried', () => {
  const v = verdict([dead('twitter')]);
  assert.equal(v.result.status, 'failed');
  assert.equal(v.anyLive, false);
});

// A platform that returns a URL but no 'published' status still counts as live.
// TikTok returns no URL at all and Zernio reports 'processing' for a while;
// treating either as "did not happen" is how a second copy gets posted.
test('a url with no published status still counts as live', () => {
  const v = verdict([{ platform: 'threads', status: 'processing', url: 'https://threads/1' }]);
  assert.equal(v.anyLive, true);
  assert.equal(v.result.status, 'posted');
});

test('a clean run says nothing rather than inventing a note', () => {
  assert.equal(verdict([live('facebook'), live('threads')]).result.note, null);
});

/*
 * UNKNOWN IS NOT FAILED (2026-09-14). A publish request that times out at our
 * end aborts the client while Zernio keeps working; a platform still
 * 'processing' when waitForResults gives up is the same shape. Both used to
 * read as 'failed', which is the one status the dashboard offers Re-queue on
 * — over content that may already be live and, on two platforms, undeletable.
 */
const unknown = (p) => ({ platform: p, status: 'unknown', url: null, error: 'timed out; Zernio may still publish it' });

test('a timed-out group is unknown, and unknown is never a failure', () => {
  const v = verdict([unknown('instagram'), unknown('threads')]);
  assert.equal(v.result.status, 'posted', 'never failed, so never re-queued by the box');
  assert.equal(v.anyLive, false);
  assert.match(v.result.note, /nothing confirmed/);
  assert.match(v.result.note, /instagram, threads unknown/);
  assert.match(v.result.note, /look on the platform/);
});

test('a platform still processing when we stopped waiting is unknown too', () => {
  const v = verdict([live('facebook'), { platform: 'threads', status: 'processing', url: null }]);
  assert.equal(v.result.status, 'posted');
  assert.match(v.result.note, /threads unknown/);
  assert.doesNotMatch(v.result.note, /threads failed/);
});

test('failed and unknown are named apart, so the note says what to do with each', () => {
  const v = verdict([live('facebook'), dead('twitter'), unknown('tiktok')]);
  assert.match(v.result.note, /twitter failed — re-queue by hand/);
  assert.match(v.result.note, /tiktok unknown/);
});

// Positive control: a platform that SAID failed, alone, is still a failure.
test('a platform that reported failure, alone, is still failed', () => {
  assert.equal(verdict([dead('twitter')]).result.status, 'failed');
});
