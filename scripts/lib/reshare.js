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

/**
 * @param {string} postUrl  the company post to repost
 * @param {string} [comment] his words. Omitted or blank gives a plain repost.
 * @param {object} [account] which account reposts; defaults to the personal one.
 */
async function quoteReshare(postUrl, comment, account = null) {
  if (!postUrl) throw new Error('nothing to reshare — no post url');

  const who = account || linkedinAccounts().personal[0];
  if (!who) throw new Error('no personal LinkedIn account in accounts:list');

  // reshareUrl is not exposed as a posts:create flag, so this goes to REST.
  const body = {
    platforms: [{
      platform: 'linkedin',
      accountId: who._id || who.id,
      platformSpecificData: { reshareUrl: postUrl },
    }],
    publishNow: true,
  };
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
async function reshareAll(postUrl, comment) {
  const { personal } = linkedinAccounts();
  const results = [];
  for (const who of personal) {
    const name = who.displayName || who.username || who._id || who.id;
    try {
      const post = await quoteReshare(postUrl, comment, who);
      results.push({ account: name, ok: true, id: post && post._id });
    } catch (err) {
      results.push({ account: name, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = { quoteReshare, reshareAll, linkedinAccounts };
