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
 * The commentary is never generated. It is his sentence or there is no reshare:
 * words attributed to a person have to be that person's.
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
 * @param {string} postUrl  the company post to quote
 * @param {string} comment  his words, going out as him
 */
async function quoteReshare(postUrl, comment) {
  if (!postUrl) throw new Error('nothing to reshare — no company post url');
  if (!comment || !comment.trim()) return null;      // no words, no reshare

  const { personal } = linkedinAccounts();
  if (!personal) throw new Error('no personal LinkedIn account in accounts:list');

  // reshareUrl is not exposed as a posts:create flag, so this goes to REST.
  const { post } = await api('POST', '/posts', {
    body: {
      content: comment,
      platforms: [{
        platform: 'linkedin',
        accountId: personal._id || personal.id,
        platformSpecificData: { reshareUrl: postUrl },
      }],
      publishNow: true,
    },
    timeout: 120000,
  });
  return post;
}

module.exports = { quoteReshare, linkedinAccounts };
