/*
 * LinkedIn quote-reshare: the company page posts it, the personal account
 * shares it with a thought on top.
 *
 * This is the one platform where resharing is possible through an API at all —
 * Facebook personal timelines are impossible by Meta's rules, and nothing else
 * exposes it. It matters here because the personal account is the only one with
 * a real audience (thousands against the company page's handful), and the goal
 * is to move that engagement onto the page.
 *
 * Two shapes, and the difference matters:
 *
 *   - a PLAIN repost, no text at all. `content` omitted entirely — the docs are
 *     explicit that commentary is optional and an empty one gives a one-click
 *     repost. This is the default.
 *   - a QUOTE repost, with a thought on top. Only ever HIS thought: words
 *     published under a person's name have to be that person's, so commentary
 *     is never generated — it is supplied or there is none.
 */
'use strict';

const { api, cli } = require('./api');
const voice = require('./voice');
const shortlink = require('./shortlink');

/*
 * The LinkedIn accounts: one company page, and EVERY personal profile behind it.
 *
 * `personal` is a LIST, and that is not future-proofing — it is a bug fix. It
 * used to be `all.find(a => a !== company)`, which returns the first one and
 * silently ignores the rest. A second personal account was connected on
 * 2026-08-22 and was invisible to the whole pipeline from the moment it was
 * added: no error, no warning, just one fewer repost than anybody expected.
 *
 * The company page is matched on the display name we post under rather than a
 * hard-coded id, so reconnecting it does not break this.
 */
function linkedinAccounts() {
  const all = (cli(['accounts:list']).accounts || []).filter((a) => a.platform === 'linkedin' && a.isActive !== false);
  const company = all.find((a) => /wish\s*key/i.test(a.displayName || a.username || ''));
  const personal = all.filter((a) => a !== company);
  return { company, personal, all };
}

/*
 * How far apart two personal accounts repost the same company post.
 *
 * Mate's call, 2026-08-22: "keep them out of sync, so can we make lag between
 * them... we do not have to repost news, just let's have some wait time." Two
 * reposts of the same thing landing in the same minute reads as one person
 * running two accounts, which is what it is — spaced out, each one is somebody
 * sharing something they saw, and each gets its own pass at the feed.
 *
 * Four hours: far enough apart that nobody sees them together, close enough
 * that both land the same day. Zernio holds the later one (`scheduledFor`), so
 * nothing has to stay running on this box to make it happen.
 */
const RESHARE_LAG_MINUTES = Number(process.env.MWK_RESHARE_LAG_MINUTES || 240);

/*
 * The CTA comment for ONE repost, with its own tracked code.
 *
 * Its own, per account, and that is the whole point. Until 2026-08-24 a repost
 * carried no comment and no code at all: the company page — two followers — got
 * the tracked call to action, and the two personal profiles holding 7,192
 * between them got a bare repost with no route to the sign-up page except
 * clicking through to the company post and finding its comment there. That is
 * essentially the entire LinkedIn audience with nothing to follow and nothing
 * to measure.
 *
 * Keyed on the reposting ACCOUNT, so "which of the three earned this click" has
 * an answer. Never fatal, same rule as everywhere else: no dashboard means the
 * plain sign-up url, never a repost that does not happen.
 */
async function reshareComment(account, { clipId = null, topics = [], postKey = null } = {}) {
  const accountId = account._id || account.id;
  const key = postKey || `reshare:${accountId}`;
  const showUrl = await shortlink.mint({
    platform: 'linkedin', postKey: key, clipId,
    campaign: 'reshare', medium: 'comment',
    label: `LinkedIn repost — ${account.displayName || account.username || accountId}`,
  });
  return voice.firstComment(key, {
    platform: 'linkedin',
    topicTags: topics,
    showUrl,
    // LinkedIn takes its hashtags in the body, and a repost has no body of its
    // own — so unlike a native post, the comment IS where they belong.
    noTags: false,
  }).text;
}

/**
 * @param {string} postUrl  the company post to repost
 * @param {string} [comment] his words. Omitted or blank gives a plain repost.
 * @param {object} [account] which account reposts; defaults to the personal one.
 * @param {number} [delayMinutes] 0 posts now; anything else schedules it.
 * @param {string} [firstComment] the CTA comment Zernio posts under the repost.
 */
async function quoteReshare(postUrl, comment, account = null, delayMinutes = 0, firstComment = null) {
  if (!postUrl) throw new Error('nothing to reshare — no post url');

  const who = account || linkedinAccounts().personal[0];
  if (!who) throw new Error('no personal LinkedIn account in accounts:list');

  // reshareUrl is not exposed as a posts:create flag, so this goes to REST.
  const platformData = { reshareUrl: postUrl };
  // Same field and the same place as a native post's — on the PlatformTarget,
  // not the top level. LinkedIn is one of the four platforms Zernio posts it
  // for, seconds after the repost goes live.
  if (firstComment) platformData.firstComment = firstComment;
  const body = {
    platforms: [{
      platform: 'linkedin',
      accountId: who._id || who.id,
      platformSpecificData: platformData,
    }],
  };
  if (delayMinutes > 0) {
    body.scheduledFor = new Date(Date.now() + delayMinutes * 60000).toISOString();
  } else {
    body.publishNow = true;
  }
  // Omitted, not empty: the docs say leave content out for a plain repost.
  if (comment && comment.trim()) body.content = comment.trim();

  const { post } = await api('POST', '/posts', { body, timeout: 120000 });
  return post;
}

/*
 * Repost one company post from every personal account there is.
 *
 * Each is caught where it happens: one account failing — a token that needs
 * reconnecting, LinkedIn's duplicate-content 422 — must not cost the reposts
 * from the others, and must never cost the post itself, which is already live.
 * Same rule as the publish groups in run-queue.js, learned the same way.
 */
async function reshareAll(postUrl, comment, { lagMinutes = RESHARE_LAG_MINUTES,
  clipId = null, topics = [], firstComment = true } = {}) {
  const { personal } = linkedinAccounts();
  const results = [];
  for (let i = 0; i < personal.length; i++) {
    const who = personal[i];
    const name = who.displayName || who.username || who._id || who.id;
    // The first goes now; each one after it is staggered so two accounts never
    // repost the same post in the same minute.
    const delay = i * lagMinutes;
    try {
      // Composed per account so each repost carries its own code. A failure to
      // compose one must not cost the repost — the same rule the comment on a
      // native post follows, for the same reason.
      let cta = null;
      if (firstComment) {
        try {
          cta = await reshareComment(who, { clipId, topics,
            postKey: `reshare:${clipId || postUrl}:${who._id || who.id}` });
        } catch (err) {
          console.error(`could not compose the CTA for ${name}, reposting without it: ${err.message}`);
        }
      }
      const post = await quoteReshare(postUrl, comment, who, delay, cta);
      results.push({ account: name, ok: true, id: post && post._id, delayMinutes: delay,
        cta: Boolean(cta),
        at: delay ? new Date(Date.now() + delay * 60000).toISOString() : null });
    } catch (err) {
      results.push({ account: name, ok: false, error: err.message, delayMinutes: delay });
    }
  }
  return results;
}

module.exports = { quoteReshare, reshareAll, reshareComment, linkedinAccounts, RESHARE_LAG_MINUTES };
