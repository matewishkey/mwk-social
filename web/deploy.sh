#!/usr/bin/env bash
# Deploy the dashboard Worker. Locally, never on push — same as every other
# Cloudflare project on this box.
#
#   web/deploy.sh              deploy
#   web/deploy.sh --secrets    push INGEST_TOKEN from td-sops, then deploy
#   web/deploy.sh --schema     (re)apply schema.sql to the remote D1, then deploy
set -euo pipefail
cd "$(dirname "$0")"

secrets=false; schema=false
for arg in "$@"; do
  case "$arg" in
    --secrets) secrets=true ;;
    --schema)  schema=true ;;
    *) echo "unknown flag: $arg" >&2; exit 64 ;;
  esac
done

# The Cloudflare token lives in ~/.secrets; the app's own ingest token lives in
# td-sops, which is the project secret manager. Neither is ever an argument.
[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || { echo "source ~/.secrets first" >&2; exit 1; }

if $schema; then
  npx wrangler d1 execute mwk-social --remote --file=schema.sql -y
fi

if $secrets; then
  sops -d "$HOME/projects/td-sops/apps/mwk-social.enc.env" \
    | sed -n 's/^MWK_LOG_TOKEN=//p' \
    | npx wrangler secret put INGEST_TOKEN
fi

npx wrangler deploy
