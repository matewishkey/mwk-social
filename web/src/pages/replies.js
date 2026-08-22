/*
 * X replies waiting on him.
 *
 * He posts these HIMSELF, and that is not a preference — it is the only way
 * left. On 23 February 2026 X restricted programmatic replies on every plan
 * below Enterprise: POST /2/tweets will only reply if the original author has
 * @mentioned or quoted you first. Zernio surfaced it as
 *
 *   "X (Twitter) cannot reply to this post. Since February 2026, X only allows
 *    API replies when the original author has @mentioned or quoted you.
 *    Self-replies (threads) are not affected."
 *
 * confirmed by @XDevelopers. Our own thread CTA still works, because that is a
 * self-reply. Answering a stranger is not.
 *
 * So the page drafts and he copies. Which is arguably where this should have
 * landed anyway: a reply under his name, in his voice, to a real person, sent
 * by the person whose name is on it.
 *
 * Two things on this page are deliberate and easy to get wrong:
 *
 *   - The draft shown IS the bytes that get posted. It carries deliberate
 *     typos from a seeded generator, so it must never be regenerated on send;
 *     a second render that differed would mean he approved one thing and we
 *     posted another. Edit puts his version in `edited` and that wins.
 *   - The link is absent on purpose. X deprioritises a post carrying an
 *     external url, and a reply is the worst possible place to spend that. The
 *     route to the show is the bio, which is why the bio link is tracked.
 *
 * The Sent table is the point of the month-long trial. `author replied` is the
 * column that matters: a reply the author answers back is worth roughly 150x a
 * like, and it is the only evidence any of this reached a person.
 */
import { esc, card, tile, layout, when, ago, pager } from '../lib/html.js';

const STATE = {
  proposed: ['p-warn', 'waiting on you'],
  approved: ['p-ok', 'approved'],
  sent:     ['p-ok', 'sent'],
  skipped:  ['p-plain', 'skipped'],
  failed:   ['p-bad', 'failed'],
};

export async function repliesAction(request, env, email) {
  const form = await request.formData();
  const doing = String(form.get('do') || '');
  const id = String(form.get('tweetId') || '');
  const now = new Date().toISOString();

  if (id && ['posted', 'skip'].includes(doing)) {
    // The edit box is always posted with the form, so a change he made and then
    // marked done in one press is not lost. Blank means "use the draft".
    //
    // 'posted' goes straight to sent, with no sent_id: he pasted it into X
    // himself, so there is no id to record and nothing for the box to do.
    const edited = String(form.get('text') || '').trim();
    await env.DB.prepare(
      `UPDATE reply_target SET state = ?, decided_at = ?, decided_by = ?,
         sent_at = CASE WHEN ?1 = 'sent' THEN ?2 ELSE NULL END,
         edited = CASE WHEN ?4 = '' THEN edited ELSE ?4 END
       WHERE tweet_id = ?5 AND state = 'proposed'`,
    ).bind(doing === 'posted' ? 'sent' : 'skipped', now, email, edited, id).run();
  }
  return Response.redirect(new URL('/replies', request.url).toString(), 303);
}

export function repliesPage({ email, tz, waiting, settled, byState = {}, stats = {},
  page = 1, size = 25, total = 0, params = '' }) {
  const tweetUrl = (r) => `https://x.com/${encodeURIComponent(r.author)}/status/${encodeURIComponent(r.tweet_id)}`;

  const item = (r) => {
    const [cls, label] = STATE[r.state] || ['p-plain', r.state];
    const text = r.edited || r.draft;
    const mins = r.tweet_at ? Math.round((Date.now() - new Date(r.tweet_at).getTime()) / 60000) : null;
    // Best practice is a reply inside the first half hour, while the post is
    // still gaining. Past a few hours it is a much quieter room.
    const fresh = mins === null ? '' : mins < 30 ? 'fresh' : mins < 180 ? 'warm' : 'cold';
    return `<article class="rep">
      <header>
        <div><b><a href="https://x.com/${esc(r.author)}" target="_blank" rel="noopener">@${esc(r.author)}</a></b>
          <span class="faint">${esc(r.author_name || '')}${r.reply_count != null ? ` · ${r.reply_count} replies` : ''}
          ${mins !== null ? `· <span class="age ${fresh}">${mins < 90 ? `${mins} min old` : ago(r.tweet_at)}</span>` : ''}</span></div>
        <span class="pill ${cls}">${esc(label)}</span>
      </header>
      <blockquote>${esc(r.tweet_text)}</blockquote>
      ${r.why ? `<p class="why">${esc(r.why)}</p>` : ''}
      ${r.state === 'proposed' ? `
      <form method="post" class="rf">
        <input type="hidden" name="tweetId" value="${esc(r.tweet_id)}">
        <textarea name="text" id="t-${esc(r.tweet_id)}" rows="3" maxlength="270">${esc(text)}</textarea>
        <div class="rfoot">
          <span class="faint">${text.length} chars${r.invite ? ' · mentions the show' : ''}</span>
          <span class="acts">
            <button type="button" class="primary copy" data-t="t-${esc(r.tweet_id)}">Copy</button>
            <a class="btn" href="${esc(tweetUrl(r))}" target="_blank" rel="noopener">Open on X</a>
            <button name="do" value="posted">Posted it</button>
            <button name="do" value="skip">Skip</button>
          </span>
        </div>
      </form>` : `
      <div class="said">${esc(text)}</div>
      <p class="note">
        ${esc(r.decided_by || '')} ${r.decided_at ? esc(when(r.decided_at, tz)) : ''}
        ${r.sent_url ? ` · <a href="${esc(r.sent_url)}" target="_blank" rel="noopener">see the reply</a>` : ''}
        ${r.error ? ` · <span class="bad">${esc(r.error)}</span>` : ''}
        ${r.outcome_at ? ` · ${r.got_likes || 0} likes, ${r.got_replies || 0} replies${
          r.author_replied ? ' · <b class="good">they replied back</b>' : ''}` : ''}
      </p>`}
    </article>`;
  };

  const body = `
<h1>Replies</h1>
<p class="lede">Posts from people you follow that are worth adding something specific to, with a
draft underneath. <b>Copy</b>, <b>Open on X</b>, paste, then <b>Posted it</b>. No links, ever —
X buries a post that carries one, and the route to the show is your bio.</p>

<div class="card whybox"><div class="card-body">
<b>Why you paste it rather than the box sending it.</b> On 23 February 2026 X restricted
programmatic replies on every plan below Enterprise — the API will only reply to someone who has
already @mentioned or quoted you. Our own thread CTA still works because that is a self-reply;
answering a stranger is not. So this page writes and you post.
</div></div>

<div class="tiles">
  ${tile(waiting.length, 'waiting on you', waiting.length ? 'warn' : 'ok')}
  ${tile(byState.sent || 0, 'posted by you')}
  ${tile(stats.authorReplied || 0, 'they replied back', stats.authorReplied ? 'ok' : 'plain',
    'read it in the X app')}
  ${tile(byState.skipped || 0, 'skipped', 'plain')}
</div>

${card(`Waiting on you (${waiting.length})`, waiting.length
  ? waiting.map(item).join('')
  : `<p class="empty">Nothing to review. The box looks every twenty minutes and only files a post
     it can say something specific about — some days that is none.</p>`)}

${total ? card(`Settled (${total})`, settled.map(item).join('')
  + pager({ path: '/replies', params, page, size, total, noun: 'replies' })) : ''}

<style>
.whybox { border-color:var(--warn); background:var(--warn-soft); }
.rep { border-bottom:1px solid var(--line2); padding:0 0 1.1rem; margin:0 0 1.1rem; }
.rep:last-child { border-bottom:0; margin-bottom:0; padding-bottom:0; }
.rep > header { display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; margin:0 0 .5rem; }
.rep b { font-size:.92rem; } .rep b a { color:inherit; text-decoration:none; }
.rep b a:hover { text-decoration:underline; }
.rep .faint { font-size:.76rem; display:block; font-weight:400; }
.age.fresh { color:var(--ok); font-weight:600; }
.age.cold { color:var(--faint); }
blockquote { margin:0 0 .6rem; padding:.6rem .8rem; background:var(--bg); border:1px solid var(--line);
  border-left:3px solid var(--line); border-radius:8px; font-size:.88rem; white-space:pre-wrap; }
.why { margin:0 0 .6rem; font-size:.78rem; color:var(--faint); font-style:italic; }
.rf textarea { width:100%; font:inherit; font-size:.9rem; padding:.55rem .65rem; border-radius:8px;
  border:1px solid var(--accent); background:var(--panel); color:var(--fg); resize:vertical; }
.rfoot { display:flex; justify-content:space-between; align-items:center; gap:1rem;
  margin-top:.45rem; flex-wrap:wrap; }
.acts { display:flex; gap:.4rem; }
.said { padding:.55rem .8rem; background:var(--bg); border:1px solid var(--line2); border-radius:8px;
  font-size:.88rem; white-space:pre-wrap; }
.good { color:var(--ok); } .bad { color:var(--bad); }
</style>
<script>
document.querySelectorAll('button.copy').forEach(function (b) {
  b.addEventListener('click', function () {
    var el = document.getElementById(b.dataset.t);
    var t = el.value;
    function ok() { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1600); }
    if (navigator.clipboard) { navigator.clipboard.writeText(t).then(ok, fb); } else { fb(); }
    function fb() { el.select(); try { document.execCommand('copy'); ok(); } catch (e) { b.textContent = 'select and copy'; } }
  });
});
</script>`;

  return layout({ title: 'Replies', path: '/replies', email, tz, body, wide: true });
}
