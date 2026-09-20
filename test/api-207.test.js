/*
 * A 207 THAT CARRIES THE POST IS THE POST.
 *
 * The first Pinterest pin (2026-09-20): Zernio answered 207 "Post created but
 * publishing failed" with `error: true` and the created post inside, its
 * platform `pending` and "will retry with backoff". api() threw on the error
 * flag, run-queue recorded the item as failed, and the queue page offered a
 * Re-queue over a post Zernio was still publishing. The control is a 207
 * WITHOUT a post, and a plain 400, both of which must still throw.
 */
const test = require('node:test');
const assert = require('node:assert');

const { api } = require('../scripts/lib/api.js');

const withFetch = async (status, body, fn) => {
  const realFetch = global.fetch;
  const realKey = process.env.ZERNIO_API_KEY;
  process.env.ZERNIO_API_KEY = 'test-key';
  global.fetch = async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
  try { return await fn(); } finally {
    global.fetch = realFetch;
    if (realKey === undefined) delete process.env.ZERNIO_API_KEY; else process.env.ZERNIO_API_KEY = realKey;
  }
};

test('a 207 with the created post inside is returned, not thrown', async () => {
  const body = { error: true, message: 'Post created but publishing failed',
    post: { _id: 'p1', status: 'publishing', platforms: [{ platform: 'pinterest', status: 'pending',
      errorMessage: 'Pinterest video processing timeout after 60s. Will retry with backoff.' }] } };
  const json = await withFetch(207, body, () => api('POST', '/posts', { body: {} }));
  assert.equal(json.post._id, 'p1');
  assert.equal(json.post.platforms[0].status, 'pending', 'the caller sees pending and waits, never failed');
});

test('a 207 with no post in it still throws — the exception is the post, not the status', async () => {
  await assert.rejects(
    () => withFetch(207, { error: true, message: 'Post created but publishing failed' }, () => api('POST', '/posts', { body: {} })),
    /207: Post created but publishing failed/);
});

test('an ordinary error still throws', async () => {
  await assert.rejects(
    () => withFetch(400, { error: true, message: 'bad' }, () => api('POST', '/posts', { body: {} })),
    /400: bad/);
  await assert.rejects(
    () => withFetch(200, { error: true, message: 'soft error', post: { _id: 'x' } }, () => api('POST', '/posts', { body: {} })),
    /200: soft error/, 'a 200 carrying error:true is still an error — only the 207 shape is the exception');
});
