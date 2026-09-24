/*
 * BY FORMAT (2026-09-24): a Short, a live stream and a Reel were one number per
 * platform. The box names the format; the page shows it per post.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { latestPosts, formatOf, ytId } = require('../scripts/ship-stats');

test('Reels are read off the url, YouTube off the probe cache, the rest off mediaType', () => {
  const yt = { abc123: 'short', live99: 'live' };
  assert.strictEqual(formatOf('facebook', 'https://www.facebook.com/reel/123/', 'video', yt), 'reel');
  assert.strictEqual(formatOf('facebook', 'https://www.facebook.com/x/posts/9', 'image', yt), 'image');
  assert.strictEqual(formatOf('instagram', 'https://www.instagram.com/reel/Ab/', 'video', yt), 'reel');
  assert.strictEqual(formatOf('youtube', 'https://www.youtube.com/watch?v=abc123', 'video', yt), 'short');
  assert.strictEqual(formatOf('youtube', 'https://www.youtube.com/watch?v=live99', 'video', yt), 'live');
  assert.strictEqual(formatOf('youtube', 'https://www.youtube.com/watch?v=nope', 'video', yt), 'unknown',
    'a video not probed yet is unknown, never guessed');
  assert.strictEqual(formatOf('tiktok', 'https://www.tiktok.com/@m/video/1', 'video', yt), 'video');
  assert.strictEqual(ytId('https://www.youtube.com/watch?v=-Lf97N091NI'), '-Lf97N091NI', 'a leading hyphen survives');
});

test('one post is one row, even when TikTok hands its caption back as one line', () => {
  const posts = latestPosts({ posts: [
    { content: 'Fastest Job Interview Ever\n\n#a', publishedAt: '2026-09-21T22:30:00Z', platforms: [{ platform: 'youtube', analytics: { views: 3 } }] },
    { content: 'Fastest Job Interview Ever #mwkshow #piy @someone', publishedAt: '2026-09-21T22:31:00Z', platforms: [{ platform: 'tiktok', analytics: { views: 7 } }] },
    { content: '', publishedAt: '2026-09-22T03:00:00Z', platforms: [{ platform: 'linkedin', analytics: { impressions: 9 } }] },
  ] });
  assert.strictEqual(posts.length, 1, 'the repost with no content is left out');
  assert.deepStrictEqual(posts[0].platforms.map((p) => p.platform).sort(), ['tiktok', 'youtube']);
  assert.strictEqual(posts[0].title, 'Fastest Job Interview Ever');
});

test('the format card is per post, and takes our own actions off', async () => {
  const { formatCard } = await import(path.join(__dirname, '..', 'web', 'src', 'pages', 'stats.js'));
  const html = formatCard({ formats: { days: 30, rows: [
    { platform: 'youtube', format: 'short', posts: 2, views: 1200, impressions: 0, likes: 6, comments: 2, shares: 4, saves: 0,
      best: { seen: 1117, title: 'Chris website' } },
    { platform: 'youtube', format: 'live', posts: 4, views: 20, impressions: 0, likes: 0, comments: 4, shares: 0, saves: 0, best: { seen: 9, title: 'One machine' } },
  ] } });
  assert.match(html, /Shorts<\/td>\s*<td class="num">2<\/td>\s*<td class="num"><b>600<\/b>/, '1,200 over 2 Shorts is 600 a post');
  // 6 likes - 2x2 own, 2 comments - 2 ours, 4 shares - 2x2 own = 2 over 2 posts
  assert.match(html, /<b>600<\/b><\/td>\s*<td class="num">1\.0<\/td>/);
  assert.match(html, /Live streams/);
  assert.match(html, /1,117|1\.1k/);
});
