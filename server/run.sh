#!/bin/sh
# Launcher for the Concierge proxy.
#
# The subscription credential lives in the shared file the diagnostic bot and
# the radar already use. It is sourced here rather than declared in the unit
# because systemd's EnvironmentFile accepts only bare KEY=value lines, and
# this way the file's format is its own business — and nothing has to read it
# to deploy.
set -e

ENV_FILE="${WESPACE_PROXY_ENV_FILE:-$HOME/.config/claude/claude.env}"
if [ -r "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
else
  echo "warning: no credential file at $ENV_FILE — calls will fail auth" >&2
fi

# Where to send a warning when the stand has eaten most of its weekly budget.
# Optional and sourced the same way, so the bot token is never in this repo,
# never in the unit file and never on a command line. Two lines:
#   WESPACE_ALERT_BOT_TOKEN=...
#   WESPACE_ALERT_CHAT_ID=...
ALERT_FILE="${WESPACE_ALERT_ENV_FILE:-$HOME/.config/claude/alerts.env}"
if [ -r "$ALERT_FILE" ]; then
  set -a
  . "$ALERT_FILE"
  set +a
fi

NODE="${WESPACE_PROXY_NODE:-$(command -v node || true)}"
if [ -z "$NODE" ]; then
  NODE="$(ls -1d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"
fi
if [ -z "$NODE" ]; then
  echo "fatal: node not found" >&2
  exit 1
fi

exec "$NODE" "$(dirname "$0")/proxy.js"
