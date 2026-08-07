#!/usr/bin/env bash
# Ships the Concierge proxy to the VPS and brings it up.
#
#   bash server/deploy.sh            # copy, restart, health-check
#   bash server/deploy.sh --caddy    # also install the Caddy site block (sudo)
#
# Everything happens over ONE ssh connection per invocation: this host bans an
# address for dense SSH, and a six-connection deploy is exactly that pattern.
#
# The service runs as a user unit so it stays inside the account that owns the
# subscription credential. Lingering is already on, so it survives logout.
set -euo pipefail

HOST="${WESPACE_VPS:-vps}"
REMOTE_DIR="${WESPACE_REMOTE_DIR:-wespace-proxy}"
PORT="${WESPACE_PROXY_PORT:-8791}"
DOMAIN="${WESPACE_PROXY_DOMAIN:-wespace.201-51-22-106.sslip.io}"
ORIGINS="${WESPACE_PROXY_ORIGINS:-https://denkaush-svg.github.io}"
MODEL="${WESPACE_PROXY_MODEL:-claude-opus-5}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WITH_CADDY="${1:-}"

REMOTE_SCRIPT=$(cat <<REMOTE
set -e
cd "\$HOME"
mkdir -p "$REMOTE_DIR"
tar -xz -C "$REMOTE_DIR"
chmod +x "$REMOTE_DIR/run.sh"

mkdir -p "\$HOME/.config/systemd/user"
cat > "\$HOME/.config/systemd/user/wespace-proxy.service" <<'UNIT'
[Unit]
Description=WESPACE demo stand — Concierge proxy (subscription CLI)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/$REMOTE_DIR
Environment=WESPACE_PROXY_HOST=127.0.0.1
Environment=WESPACE_PROXY_PORT=$PORT
Environment=WESPACE_PROXY_MODEL=$MODEL
Environment=WESPACE_PROXY_ORIGINS=$ORIGINS
Environment=CLAUDE_CLI_EXECUTABLE=%h/.npm-global/bin/claude
ExecStart=/bin/sh %h/$REMOTE_DIR/run.sh
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now wespace-proxy.service
systemctl --user restart wespace-proxy.service
sleep 2
echo "== unit =="
systemctl --user is-active wespace-proxy.service || systemctl --user status wespace-proxy.service --no-pager | tail -20
echo "== health =="
curl -sS --max-time 5 "http://127.0.0.1:$PORT/health" || echo "(no health response)"
echo
echo "== dns for $DOMAIN =="
getent hosts "$DOMAIN" || echo "(does not resolve — a certificate cannot be issued)"

if [ "$WITH_CADDY" = "--caddy" ]; then
  echo "== caddy =="
  sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.\$(date +%s)"
  if grep -q "$DOMAIN" /etc/caddy/Caddyfile; then
    echo "site block already present"
  else
    # Its own site, never a handle inside the cockpit's block: a mis-ordered
    # handle there would quietly leave the cockpit unauthenticated.
    printf '\n%s {\n\treverse_proxy 127.0.0.1:%s {\n\t\tflush_interval -1\n\t}\n}\n' "$DOMAIN" "$PORT" | sudo tee -a /etc/caddy/Caddyfile > /dev/null
    echo "site block appended"
  fi
  sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  sudo systemctl reload caddy
  echo "caddy reloaded"
fi
REMOTE
)

tar -cz -C "$HERE" proxy.js run.sh | ssh "$HOST" "$REMOTE_SCRIPT"

echo
echo "==> local:  http://127.0.0.1:$PORT/health  (on the VPS)"
[ "$WITH_CADDY" = "--caddy" ] && echo "==> public: https://$DOMAIN/health"
exit 0
