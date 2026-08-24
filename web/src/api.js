/*
 * Everything the box talks to, on the ingest hostname behind a bearer token.
 *
 *   POST /events        the event log and its snapshots  (every 2 min)
 *   POST /metrics       daily analytics + follower counts (hourly)
 *   POST /queue/claim   "give me one thing to post, if there is one"
 *   POST /queue/result  what happened to it
 *   POST /links         mint (or re-use) a short code for a CTA
 *   POST /youtube/propose   file drafted descriptions for approval
 *   POST /youtube/pending   "which ones did he say yes to?"
 *   POST /youtube/applied   mark them written
 *   POST /actions       file a your-turn item
 *
 * The queue is a to-do list, not a scheduler. The box decides WHEN — it already
 * owns the daily cap and the minimum gap, and two things deciding that would
 * eventually disagree.
 */

import { tokenOk, ulid, shortCode } from './lib/access.js';

const json = (o, status = 200) => Response.json(o, { status });

export async function api(request, env, url) {
  if (request.method !== 'POST') return new Response('not found', { status: 404 });
  const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tokenOk(bearer, env.INGEST_TOKEN)) return new Response('unauthorized', { status: 401 });

  const body = await request.json().catch(() => ({}));
  switch (url.pathname) {
    case '/events':       return events(body, env);
    case '/metrics':      return metrics(body, env);
    case '/queue/claim':  return claim(body, env);
    case '/queue/result': return result(body, env);
    case '/links':        return mintLink(body, env);
    case '/youtube/propose': return propose(body, env);
    case '/youtube/pending': return pending(body, env);
    case '/youtube/applied': return applied(body, env);
    case '/actions':      return fileAction(body, env);
    default:              return new Response('not found', { status: 404 });
  }
}

/* ----------------------------------------------------------------- events -- */

async function events(body, env) {
  const list = Array.isArray(body.events) ? body.events : [];
  const snapshots = body.snapshots && typeof body.snapshots === 'object' ? body.snapshots : {};
  const now = new Date().toISOString();

  const statements = [];
  for (const e of list) {
    if (!e || !e.id || !e.kind || !e.ts) continue;
    statements.push(env.DB.prepare(
      // INSERT OR IGNORE, so a batch replayed after a network failure costs
      // nothing: the ULID is stable per event and dedupe_key is unique.
      `INSERT OR IGNORE INTO event
        (id, dedupe_key, ts, run_id, source, kind, level, clip_id, platform,
         account_id, post_key, url, message, data, received_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      e.id, e.dedupe_key || null, e.ts, e.run_id || null, e.source || null,
      e.kind, e.level || 'info', e.clip_id || null, e.platform || null,
      e.account_id || null, e.post_key || null, e.url || null,
      (e.message || '').slice(0, 500), e.data == null ? null : JSON.stringify(e.data), now,
    ));
  }
  for (const [name, value] of Object.entries(snapshots)) {
    statements.push(env.DB.prepare(
      `INSERT INTO snapshot (name, body, updated_at) VALUES (?,?,?)
       ON CONFLICT(name) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    ).bind(name, JSON.stringify(value), now));
  }
  // Always recorded, even for an empty batch: without a heartbeat "nothing
  // happened" and "the box is off" are the same picture.
  statements.push(env.DB.prepare(
    'INSERT INTO ingest_batch (at, count, source) VALUES (?,?,?)',
  ).bind(now, list.length, body.source || null));

  await env.DB.batch(statements);
  return json({ ok: true, events: list.length, snapshots: Object.keys(snapshots).length });
}

/* ---------------------------------------------------------------- metrics -- */

const M = ['post_count', 'impressions', 'reach', 'views', 'likes', 'comments', 'shares', 'saves', 'clicks'];

async function metrics(body, env) {
  const now = new Date().toISOString();
  const days = Array.isArray(body.daily) ? body.daily : [];
  const followers = Array.isArray(body.followers) ? body.followers : [];
  const statements = [];

  // Upsert rather than ignore: a day's numbers keep moving for a while after it
  // ends, so the newest read of a date wins.
  for (const d of days) {
    if (!d || !d.date || !d.platform) continue;
    statements.push(env.DB.prepare(
      `INSERT INTO daily_metric (date, platform, ${M.join(', ')}, updated_at)
       VALUES (?,?,${M.map(() => '?').join(',')},?)
       ON CONFLICT(date, platform) DO UPDATE SET
         ${M.map((k) => `${k} = excluded.${k}`).join(', ')}, updated_at = excluded.updated_at`,
    ).bind(d.date, d.platform, ...M.map((k) => d[k] ?? 0), now));
  }
  // One point per account per DAY. Zernio refreshes these a few times a day and
  // we only ever draw a trend from them, so finer resolution is just noise.
  for (const f of followers) {
    if (!f || !f.accountId) continue;
    statements.push(env.DB.prepare(
      `INSERT INTO follower_point (day, account_id, platform, username, followers)
       VALUES (?,?,?,?,?)
       ON CONFLICT(day, account_id) DO UPDATE SET followers = excluded.followers`,
    ).bind((f.day || now).slice(0, 10), f.accountId, f.platform || null,
      f.username || null, f.followers ?? null));
  }
  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true, days: days.length, followers: followers.length });
}

/* ------------------------------------------------------------------ queue -- */

/**
 * Hand the box the next thing to post. Claiming is a conditional UPDATE, so two
 * runs overlapping cannot both get the same row.
 */
async function claim(body, env) {
  const now = new Date().toISOString();
  const platforms = Array.isArray(body.platforms) ? body.platforms : null;

  const rows = await env.DB.prepare(
    `SELECT * FROM queue_item WHERE status = 'queued'
      ORDER BY priority DESC, created_at LIMIT 20`,
  ).all();

  for (const row of rows.results || []) {
    // A queue item may name platforms; the caller may also restrict what it is
    // willing to take. Empty on either side means "no opinion".
    const want = JSON.parse(row.platforms || '[]');
    if (platforms && want.length && !want.some((p) => platforms.includes(p))) continue;

    const upd = await env.DB.prepare(
      `UPDATE queue_item SET status = 'claimed', claimed_at = ?
        WHERE id = ? AND status = 'queued'`,
    ).bind(now, row.id).run();
    if (!upd.meta.changes) continue;              // someone else got it first

    let mediaWideUrl = row.media_wide_url;
    if (row.media_wide_key && env.MEDIA) {
      mediaWideUrl = `https://${env.INGEST_HOST}/media/${encodeURIComponent(row.media_wide_key)}`;
    }
    let mediaUrl = row.media_url;
    if (row.media_key && env.MEDIA) {
      // A short-lived readable URL is not a thing R2 bindings hand out, so the
      // box fetches the object back through this Worker with the same token.
      mediaUrl = `https://${env.INGEST_HOST}/media/${encodeURIComponent(row.media_key)}`;
    }
    return json({
      ok: true,
      item: {
        id: row.id, body: row.body, platforms: want, mediaUrl,
        mediaType: row.media_type, firstComment: !!row.first_comment,
        reshareText: row.reshare_text || null,
        reshare: row.reshare !== 0,
        commentText: row.comment_text || null,
        topics: JSON.parse(row.topics || '[]'),
        mediaWideUrl,
        retryOf: row.retry_of || null,
        createdAt: row.created_at, createdBy: row.created_by,
      },
    });
  }
  return json({ ok: true, item: null });
}

async function result(body, env) {
  const { id, status, result: outcome, note } = body;
  if (!id || !status) return json({ ok: false, error: 'id and status required' }, 400);
  const now = new Date().toISOString();
  // 'queued' is allowed back in deliberately: the box releases a claim it could
  // not act on (bad media, a platform down) rather than burning the item.
  const allowed = ['queued', 'posted', 'failed', 'cancelled'];
  if (!allowed.includes(status)) return json({ ok: false, error: 'bad status' }, 400);

  await env.DB.prepare(
    `UPDATE queue_item SET status = ?, posted_at = ?, result = ?, note = ?,
       claimed_at = CASE WHEN ? = 'queued' THEN NULL ELSE claimed_at END
     WHERE id = ?`,
  ).bind(status, status === 'posted' ? now : null,
    outcome == null ? null : JSON.stringify(outcome), note || null, status, id).run();
  return json({ ok: true });
}

/* ------------------------------------------------------------------ links -- */

/**
 * Mint a code for one CTA, or return the one this (target, platform, clip)
 * already has. Idempotent on purpose: the comment watcher re-composes a comment
 * on a re-run and must render the identical URL, or the dedupe guard breaks.
 */
export async function mint(env, {
  target, platform = null, clipId = null, postKey = null, label = null,
  campaign = null, medium = null, createdBy = null, note = null,
}) {
  // Campaign and medium are part of the KEY, not decoration. The same sign-up
  // page linked from the bio and from a reply has to be two codes or the
  // question "which one earned this" has no answer — which is exactly the state
  // every link minted before 2026-08-22 was in.
  const existing = await env.DB.prepare(
    `SELECT code FROM link
      WHERE target = ? AND platform IS ? AND clip_id IS ? AND post_key IS ?
        AND campaign IS ? AND medium IS ?`,
  ).bind(target, platform, clipId, postKey, campaign, medium).first();
  if (existing) return { code: existing.code, url: linkUrl(env, existing.code), reused: true };

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = shortCode(5);
    try {
      await env.DB.prepare(
        `INSERT INTO link (code, target, platform, clip_id, post_key, label, created_at,
           campaign, medium, created_by, note)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(code, target, platform, clipId, postKey, label, new Date().toISOString(),
        campaign, medium, createdBy, note).run();
      return { code, url: linkUrl(env, code), reused: false };
    } catch { /* collision on the primary key — try another */ }
  }
  throw new Error('could not mint a code');
}

async function mintLink(body, env) {
  if (!body.target) return json({ ok: false, error: 'target required' }, 400);
  try {
    return json({ ok: true, ...await mint(env, body) });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

export const linkUrl = (env, code) => `https://${env.LINK_HOST}/${code}`;

/* ---------------------------------------------------------------- actions -- */

async function fileAction(body, env) {
  const { kind, platform = null, clipId = null, url = null, label = null, dedupeKey = null } = body;
  if (!kind) return json({ ok: false, error: 'kind required' }, 400);
  const id = dedupeKey || ulid();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO manual_action (id, created_at, kind, platform, clip_id, url, label)
     VALUES (?,?,?,?,?,?,?)`,
  ).bind(id, new Date().toISOString(), kind, platform, clipId, url, label).run();
  return json({ ok: true, id });
}

/* ---------------------------------------------------------------- youtube -- */

/*
 * File drafted descriptions. A proposal that has already been decided is left
 * exactly as it is: re-drafting must never quietly un-approve something, or
 * reset a "keep what's there" back into the queue on the next run.
 */
/*
 * File drafted descriptions for a decision.
 *
 * The WHERE clause is the whole story. It used to be `state = 'proposed'` alone,
 * which stopped the churn it was written for — build() regenerates the opening
 * with a model every run, so an applied description never matches byte for byte
 * and re-proposed itself for ever — and then quietly stopped something else:
 * a description that was genuinely OUT OF DATE could never be re-proposed
 * either. On 2026-08-24 that was 19 of 22, dropped silently while the response
 * still said "filed: 22". Twelve of them were Shorts holding a link YouTube
 * renders as plain text, so the fix computed the right change and the database
 * threw it away.
 *
 * Comparing the TEXT is the better guard anyway: an identical re-proposal is a
 * no-op whatever state the row is in, so the churn cannot come back, while a
 * real change reopens the row for a decision. An APPROVED row is reopened too —
 * one approved before a voice change carries the old words, and writing it
 * would publish exactly what was just fixed. A REJECTED row is left alone: he
 * said no, and asking again is not what "no" means.
 */
async function propose(body, env) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return json({ ok: true, filed: 0 });
  const now = new Date().toISOString();
  const res = await env.DB.batch(items.map((i) => env.DB.prepare(
    `INSERT INTO yt_proposal (video_id, title, current_text, proposed, state, proposed_at, kind)
     VALUES (?,?,?,?,'proposed',?,?)
     ON CONFLICT(video_id) DO UPDATE SET
       title = excluded.title, current_text = excluded.current_text,
       proposed = excluded.proposed, proposed_at = excluded.proposed_at, kind = excluded.kind,
       state = 'proposed', decided_at = NULL, decided_by = NULL, applied_at = NULL
     WHERE yt_proposal.state = 'proposed'
        OR (yt_proposal.state IN ('approved', 'applied')
            AND yt_proposal.proposed <> excluded.proposed)`,
  ).bind(i.videoId, i.title || null, i.currentText || '', i.proposed || '', now,
    i.kind === 'swap' || i.kind === 'rebuild' ? i.kind : null)));
  // What actually landed, not what was sent — "filed: 22" when nineteen were
  // dropped is the kind of number somebody believes.
  const filed = res.reduce((n, r) => n + ((r.meta && r.meta.changes) || 0), 0);
  return json({ ok: true, filed, sent: items.length });
}

const pending = async (_body, env) => json({
  ok: true,
  items: (await env.DB.prepare(
    `SELECT video_id, title, proposed FROM yt_proposal WHERE state = 'approved' ORDER BY decided_at`,
  ).all()).results || [],
  // What we last wrote, so a re-draft can tell "unchanged" from "never done".
  // Without this the loop never converges: the opening paragraph is generated
  // and never matches byte for byte, so every applied description immediately
  // proposes itself again — 17 fresh proposals a day, for ever.
  applied: (await env.DB.prepare(
    `SELECT video_id, proposed FROM yt_proposal WHERE state = 'applied'`,
  ).all()).results || [],
});

async function applied(body, env) {
  const ids = Array.isArray(body.videoIds) ? body.videoIds : [];
  if (!ids.length) return json({ ok: true, applied: 0 });
  const now = new Date().toISOString();
  await env.DB.batch(ids.map((id) => env.DB.prepare(
    `UPDATE yt_proposal SET state = 'applied', applied_at = ? WHERE video_id = ?`,
  ).bind(now, id)));
  return json({ ok: true, applied: ids.length });
}


