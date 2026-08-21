/*
 * The queue: things waiting for a good moment to go out.
 *
 * Writing here does NOT decide when anything publishes. The box owns the pace —
 * the daily cap, counted in the audience's timezone, and the minimum gap between
 * posts — and it claims from this list one at a time when its own rules say it
 * may. There is no time-of-day window: a post reaches each timezone whenever it
 * reaches it. Two things deciding "is now a good time" would eventually
 * disagree, and the one on the box is the one that already knows what else went
 * out today.
 */
import { esc, card, layout, when, ago, tile, pager } from '../lib/html.js';
import { ulid } from '../lib/access.js';

const POSTABLE = ['facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'threads', 'twitter'];

/**
 * The platforms on this row that did NOT go live, read off what run-queue
 * recorded. A platform counts as live if it said `published` OR came back with
 * a url — TikTok returns no url and Threads sits at `processing` for a while,
 * and treating either as a failure would repost to somewhere that has it.
 */
export function failedPlatforms(row) {
  let outcome;
  try { outcome = JSON.parse(row.result || '[]'); } catch { return []; }
  if (!Array.isArray(outcome)) return [];
  const live = new Set(outcome.filter((o) => o.status === 'published' || o.url).map((o) => o.platform));
  return [...new Set(outcome.map((o) => o.platform))].filter((p) => p && !live.has(p));
}

const STATUS = {
  queued:    ['p-plain', 'waiting'],
  claimed:   ['p-warn',  'going out'],
  posted:    ['p-ok',    'posted'],
  failed:    ['p-bad',   'failed'],
  cancelled: ['p-plain', 'cancelled'],
};

/** Create / cancel / bump. Always answered with a redirect so a refresh is safe. */
export async function queueAction(request, env, email) {
  const form = await request.formData();
  const doing = form.get('do');
  const back = Response.redirect(new URL('/queue', request.url).toString(), 303);

  if (doing === 'cancel' || doing === 'requeue') {
    const id = String(form.get('id') || '');
    const to = doing === 'cancel' ? 'cancelled' : 'queued';
    await env.DB.prepare(
      `UPDATE queue_item SET status = ?, claimed_at = NULL WHERE id = ? AND status IN ('queued','claimed','failed','cancelled')`,
    ).bind(to, id).run();
    return back;
  }

  if (doing === 'bump') {
    await env.DB.prepare('UPDATE queue_item SET priority = priority + 1 WHERE id = ?')
      .bind(String(form.get('id') || '')).run();
    return back;
  }

  // Retry ONLY the platforms that failed. The whole reason this exists: since
  // 34db048 a partially-published item is marked `posted` and never re-queued,
  // because re-queueing would post again to the platforms that already have it.
  // That left the failed half with no route back except retyping the post,
  // which loses the short code and therefore splits the click history.
  if (doing === 'retry') {
    const id = String(form.get('id') || '');
    const row = await env.DB.prepare('SELECT * FROM queue_item WHERE id = ?').bind(id).first();
    if (!row) return back;
    const failed = failedPlatforms(row);
    if (!failed.length) return back;
    await env.DB.prepare(
      `INSERT INTO queue_item (id, created_at, created_by, status, body, platforms,
         media_key, media_url, media_type, first_comment, priority,
         reshare, reshare_text, comment_text, topics, media_wide_key, media_wide_url, retry_of)
       VALUES (?,?,?,'queued',?,?,?,?,?,?,0,?,?,?,?,?,?,?)`,
    ).bind(ulid(), new Date().toISOString(), email, row.body, JSON.stringify(failed),
      row.media_key, row.media_url, row.media_type, row.first_comment,
      // Never repost from the personal account a second time — that half
      // succeeded, and LinkedIn 422s a duplicate anyway.
      0, null,
      row.comment_text, row.topics, row.media_wide_key, row.media_wide_url,
      row.retry_of || row.id).run();
    return back;
  }

  if (doing !== 'add') return back;

  const text = String(form.get('body') || '').trim();
  if (!text) return back;
  const platforms = POSTABLE.filter((p) => form.get(`p_${p}`));
  const mediaUrl = String(form.get('mediaUrl') || '').trim() || null;

  // An uploaded file goes to R2 and the box pulls it back through /media/<key>
  // when it claims the item. Pasting a URL is still supported and is the cheap
  // path for something already hosted.
  const put = async (f) => {
    if (!f || typeof f !== 'object' || !f.size || !env.MEDIA) return [null, null];
    const key = `queue/${ulid()}-${f.name.replace(/[^\w.-]+/g, '_')}`.slice(0, 180);
    await env.MEDIA.put(key, f.stream(), { httpMetadata: { contentType: f.type || undefined } });
    return [key, f.type || null];
  };
  const [mediaKey, mediaType] = await put(form.get('media'));
  const [mediaWideKey] = await put(form.get('mediaWide'));

  // Every column the form can fill has to be NAMED here. Five of them were not
  // (2026-08-21): the bindings for reshare, reshare_text, comment_text, topics
  // and media_wide_key were passed but the column list stopped at first_comment,
  // so fourteen values met nine placeholders. Whatever D1 does with the excess,
  // those five were never stored — the same "declared and never read" shape as
  // hashtagsInCaption. The test below counts the two and fails if they diverge.
  await env.DB.prepare(
    `INSERT INTO queue_item (id, created_at, created_by, status, body, platforms,
       media_key, media_url, media_type, first_comment, priority,
       reshare, reshare_text, comment_text, topics, media_wide_key)
     VALUES (?,?,?,'queued',?,?,?,?,?,?,0,?,?,?,?,?)`,
  ).bind(ulid(), new Date().toISOString(), email, text, JSON.stringify(platforms),
    mediaKey, mediaUrl, mediaType, form.get('firstComment') ? 1 : 0,
    form.get('reshare') ? 1 : 0,
    String(form.get('reshareText') || '').trim() || null,
    String(form.get('commentText') || '').trim() || null,
    JSON.stringify(String(form.get('topics') || '').split(',')
      .map((t) => t.trim().replace(/^#/, '')).filter(Boolean)),
    mediaWideKey).run();
  return back;
}

export function queuePage({ email, tz, waiting, done, pace,
  page = 1, size = 25, total = 0, params = '' }) {

  // What is actually going out, not the words "has media". A queued clip is the
  // one thing he cannot check anywhere else before it publishes — it is not on a
  // platform yet and it is not on his machine.
  const preview = (i) => {
    const src = (key, url) => (key ? `/media/${encodeURIComponent(key)}` : url);
    const one = (key, url, label) => {
      const href = src(key, url);
      if (!href) return '';
      const video = (i.media_type || '').startsWith('video') || /\.(mp4|mov|webm)(\?|$)/i.test(href);
      return `<figure class="prev">${video
        ? `<video src="${esc(href)}" controls preload="metadata" playsinline></video>`
        : `<img src="${esc(href)}" alt="">`}<figcaption>${esc(label)}</figcaption></figure>`;
    };
    const shots = one(i.media_key, i.media_url, 'vertical')
      + one(i.media_wide_key, i.media_wide_url, 'landscape');
    return shots ? `<div class="prevs">${shots}</div>` : '';
  };

  const row = (i, showActions) => {
    const [cls, label] = STATUS[i.status] || ['p-plain', i.status];
    const platforms = JSON.parse(i.platforms || '[]');
    return `<tr>
      <td><span class="pill ${cls}">${esc(label)}</span></td>
      <td>${preview(i)}<div class="body">${esc(i.body)}</div>
        <div class="faint meta">${platforms.length ? esc(platforms.join(' · ')) : 'wherever it fits'}
          ${i.media_key || i.media_url ? ' · has media' : ''}
          ${i.media_wide_key || i.media_wide_url ? ' + landscape cut' : ''}
          ${i.first_comment ? ' · first comment' : ' · no first comment'}
          ${i.reshare === 0 ? '' : i.reshare_text
            ? ' · reposted from your personal account, with your words'
            : ' · reposted from your personal account'}
          ${i.comment_text ? ' · custom first comment' : ''}
          ${i.priority > 0 ? ` · bumped ×${i.priority}` : ''}
          ${i.retry_of ? ' · retry, same short code' : ''}
          ${failedPlatforms(i).length ? ` · <b>${esc(failedPlatforms(i).join(', '))} did not go</b>` : ''}</div>
        ${i.note ? `<div class="faint meta">${esc(i.note)}</div>` : ''}</td>
      <td class="nowrap faint">${esc(when(i.created_at, tz))}<br><span style="font-size:.72rem">${esc(ago(i.created_at))}</span></td>
      <td class="nowrap">${showActions ? `
        <form method="post" class="inline-form"><input type="hidden" name="do" value="bump">
          <input type="hidden" name="id" value="${esc(i.id)}"><button title="Move it up the queue">↑</button></form>
        <form method="post" class="inline-form"><input type="hidden" name="do" value="cancel">
          <input type="hidden" name="id" value="${esc(i.id)}"><button class="danger">Cancel</button></form>`
      : i.status === 'failed' || i.status === 'cancelled' ? `
        <form method="post" class="inline-form"><input type="hidden" name="do" value="requeue">
          <input type="hidden" name="id" value="${esc(i.id)}"><button>Re-queue</button></form>`
      : failedPlatforms(i).length ? `
        <form method="post" class="inline-form"><input type="hidden" name="do" value="retry">
          <input type="hidden" name="id" value="${esc(i.id)}"><button
            title="Queue it again for ${esc(failedPlatforms(i).join(', '))} only">Retry ${failedPlatforms(i).length}</button></form>` : ''}</td>
    </tr>`;
  };

  const body = `
<h1>Queue</h1>
<p class="lede">Add as many as you like. They go out one at a time, spaced apart —
so five things queued at once do not land as five posts in a minute.</p>

<div class="tiles">
  ${tile(waiting.length, 'waiting')}
  ${tile(pace.today, `of ${pace.perDay} sent today`, pace.today >= pace.perDay ? 'warn' : 'plain')}
  ${tile(pace.minGapMinutes ? `${pace.minGapMinutes} min` : '—', 'minimum gap', 'plain', pace.tz)}
  ${tile(pace.nextAt || '—', 'next slot', 'plain', pace.why || '')}
</div>

${card('Queue something', `
<form method="post" enctype="multipart/form-data">
  <input type="hidden" name="do" value="add">
  <div class="field">
    <label for="qbody">What it says</label>
    <textarea id="qbody" name="body" required placeholder="Your words. This is the post — it does not get rewritten."></textarea>
  </div>
  <div class="row">
    <div class="field"><label for="qmedia">Video or image (optional)</label>
      <input type="file" id="qmedia" name="media" accept="video/*,image/*"></div>
    <div class="field"><label for="qurl">…or paste a media URL</label>
      <input type="url" id="qurl" name="mediaUrl" placeholder="https://…"></div>
  </div>
  <div class="field">
    <label for="qmediawide">Landscape cut of the same clip (optional)</label>
    <input type="file" id="qmediawide" name="mediaWide" accept="video/*">
    <p class="note">Every platform allows only one video per post, so the two cuts cannot ride
      together. Give both and the vertical one goes to Instagram, TikTok and Threads while this one
      goes to Facebook, YouTube, LinkedIn and X — as separate posts.</p>
  </div>
  <div class="field">
    <label>Where</label>
    <div class="checks">
      ${POSTABLE.map((p) => `<label><input type="checkbox" name="p_${p}"> ${esc(p)}</label>`).join('')}
    </div>
    <p class="note">Leave them all unticked for "wherever it fits" — Instagram needs media,
      and the box skips anything a post cannot satisfy.</p>
  </div>
  <div class="field">
    <div class="checks"><label><input type="checkbox" name="firstComment" checked> Add the standard first comment</label></div>
  </div>
  <div class="field">
    <label for="qtopics">Hashtags describing the clip (optional, comma separated)</label>
    <input type="text" id="qtopics" name="topics" placeholder="Branding, SocialMedia, CreatingImages">
    <p class="note">Everyday words only — what an ordinary person would call it. #MWKShow and #PIY
      are always added. Instagram takes three more, X takes none.</p>
  </div>
  <div class="field">
    <label for="qcomment">First comment — override the standard one (optional)</label>
    <textarea id="qcomment" name="commentText" style="min-height:5rem"
      placeholder="Left empty, the rotating sign-up comment is used. Any link you put here is shortened and tracked."></textarea>
    <p class="note">Use this to point at something specific — a repo, an episode. Every URL is
      replaced with its own <code>mwkshow.com</code> code, so you can see which one people click.</p>
  </div>
  <div class="field">
    <div class="checks"><label><input type="checkbox" name="reshare" checked>
      Repost it from your personal LinkedIn account</label></div>
    <label for="qreshare" style="margin-top:.7rem">…with a thought on top (optional)</label>
    <textarea id="qreshare" name="reshareText" style="min-height:5rem"
      placeholder="Leave empty for a plain repost, no text. Anything here goes out as you."></textarea>
    <p class="note">The company page posts it, then your personal account reposts that — which is
      where the audience is. Empty means a plain repost, which is the usual case. LinkedIn is the
      only platform where reposting works through the API at all.</p>
  </div>
  <button class="primary" type="submit">Queue it</button>
</form>`)}

${card(`Waiting (${waiting.length})`, waiting.length ? `<div class="wrap"><table>
  <thead><tr><th>status</th><th>post</th><th>queued</th><th></th></tr></thead>
  <tbody>${waiting.map((i) => row(i, true)).join('')}</tbody></table></div>`
  : '<p class="empty">Nothing waiting.</p>', '')}

${total ? card(`Been and gone (${total})`, `<div class="wrap"><table>
  <thead><tr><th>status</th><th>post</th><th>queued</th><th></th></tr></thead>
  <tbody>${done.map((i) => row(i, false)).join('')}</tbody></table></div>
${pager({ path: '/queue', params, page, size, total, noun: 'posts' })}`) : ''}

<style>
.body { white-space:pre-wrap; max-width:60ch; font-size:.87rem; }
.prevs { display:flex; gap:.5rem; margin:0 0 .5rem; flex-wrap:wrap; }
.prev { margin:0; }
.prev video, .prev img { width:120px; max-height:200px; border-radius:8px; background:#000;
  border:1px solid var(--line); display:block; }
.prev figcaption { font-size:.7rem; color:var(--faint); text-align:center; margin-top:.15rem; }
.meta { font-size:.75rem; margin-top:.2rem; }
input[type=file] { font-size:.85rem; padding:.45rem 0; }
td form + form { margin-left:.25rem; }
</style>`;

  return layout({ title: 'Queue', path: '/queue', email, tz, body });
}
