#!/usr/bin/env bash
# Run a command with this project's secrets in its environment.
#
#   scripts/with-secrets.sh scripts/ship-events.js
#
# Two sources, because they hold different things: ~/.secrets is machine/shell
# env (shell syntax, which systemd's EnvironmentFile cannot parse), and
# td-sops/apps/mwk-social.enc.env is the project's own keys. Values land in the
# process environment — the intended consumer — and never in an argument, a log
# line or a temp file.
set -euo pipefail

app_secrets="$HOME/projects/td-sops/apps/mwk-social.enc.env"

set -a
# shellcheck disable=SC1090,SC1091
[[ -f "$HOME/.secrets" ]] && source "$HOME/.secrets"
if [[ -f "$app_secrets" ]] && command -v sops >/dev/null; then
  eval "$(sops -d "$app_secrets")"
fi
set +a

exec "$@"
