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

/** The two LinkedIn accounts, told apart by which profile owns them. */
function linkedinAccounts() {
  const all = (cli(['accounts:list']).accounts || []).filter((a) => a.platform === 'linkedin' && a.isActive !== false);
  // The company page and the personal profile sit on different Zernio profiles.
  // Rather than hard-code either id, match on the display name we post under.
  const company = all.find((a) => /wish\s*key/i.test(a.displayName || a.username || ''));
  const personal = all.find((a) => a !== company);
  return { company, personal, all };
}

/**
 * @param {string} postUrl  the company post to repost
 * @param {string} [comment] his words. Omitted or blank gives a plain repost.
 * @param {object} [account] which account reposts; defaults to the personal one.
 */
async function quoteReshare(postUrl, comment, account = null) {
  if (!postUrl) throw new Error('nothing to reshare — no post url');

  const who = account || linkedinAccounts().personal;
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

module.exports = { quoteReshare, linkedinAccounts };
