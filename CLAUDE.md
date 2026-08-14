# mwk-social — Zernio social-media integration

Zernio (zernio.com) is the social API layer: one REST API + CLI for posting/scheduling,
inbox, analytics and ads across the matewishkey social accounts.

## Setup on this box

- CLI: `./node_modules/.bin/zernio` (`@zernio/cli`, local dev dependency; node pinned via `mise.toml`).
- Auth: the CLI reads `~/.zernio/config.json` (created by `zernio auth:login`, device flow).
  Durable backup of the API key: `td-sops/apps/mwk-social.enc.env` (`ZERNIO_API_KEY`) —
  restore recipe is in the comment above its rule in td-sops/.sops.yaml.
- `zernio auth:check` verifies auth; `zernio accounts:health` verifies connections.

## Connected accounts (Zernio profile "Default", 6a7f217c643243f9674de5f5)

| Platform | Account ID | Connected as |
|----------|------------|--------------|
| facebook | `6a7f237977555aae01bcf08f` | Page "Mate Wish Key" (can switch to Anzscofinder / My Poker Fantasy / Tasman Visa via `connect:update-facebook-page`) |
| linkedin | `6a7f23c577555aae01bd07b4` | personal profile "Mate Visky" |

Free tier covers exactly these 2 accounts; adding Instagram/X starts billing ($6/account/mo tier).

## Platform gotchas (verified against docs.zernio.com)

- **Facebook posts to Pages only** — personal timelines are impossible via API (Meta restriction).
  Tokens expire (~60 days); watch `accounts:health` / the `account.disconnected` webhook.
- **LinkedIn**: 3,000-char limit; duplicate content → 422; external links suppress reach.
- Safe pipeline test pattern (never publishes): `posts:create --scheduledAt <far future>` →
  verify with `posts:get` → `posts:delete`.
