#!/usr/bin/env bash
#
# Start a public tunnel to the local backend and point Lipila's callbacks at it.
#
#   ./tunnel.sh
#
# Why the flags are not optional here:
#   --protocol http2      this network blocks outbound UDP, so cloudflared's
#                         default QUIC transport never connects. It still PRINTS
#                         a trycloudflare URL when that happens, so a broken
#                         tunnel looks exactly like a working one. We wait for
#                         "Registered tunnel connection" before believing it.
#   --edge-ip-version 4   no working IPv6 path to the edge here.
#
# The quick-tunnel hostname is EPHEMERAL — a new one every run. That is the whole
# reason this script exists: it rewrites LIPILA_CALLBACK_URL in backend/.env and
# clears the config cache, so collections minted from now on call back to a live
# URL. Anything minted under a previous URL is recovered by `lipila:poll`.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUDFLARED="/c/Program Files (x86)/cloudflared/cloudflared"
PORT="${PORT:-8000}"
ENV_FILE="$ROOT/backend/.env"
LOG="$(mktemp -t tunnel-XXXXXX.log)"

command -v "$CLOUDFLARED" >/dev/null 2>&1 || [ -x "$CLOUDFLARED" ] || {
  echo "cloudflared not found at: $CLOUDFLARED" >&2
  exit 1
}

# Refuse to tunnel to nothing — a tunnel to a dead port returns 502 to Lipila
# and looks like a signature problem from the app side.
if ! curl -s -o /dev/null --max-time 5 "http://localhost:$PORT/api/landing"; then
  echo "Nothing answering on localhost:$PORT — start the backend first:" >&2
  echo "  cd backend && php artisan serve" >&2
  exit 1
fi

echo "Starting tunnel to localhost:$PORT ..."
"$CLOUDFLARED" tunnel \
  --url "http://localhost:$PORT" \
  --no-autoupdate \
  --protocol http2 \
  --edge-ip-version 4 \
  >"$LOG" 2>&1 &
PID=$!

cleanup() { echo; echo "Stopping tunnel (pid $PID)"; kill "$PID" 2>/dev/null; }
trap cleanup EXIT INT TERM

# Wait for a REGISTERED connection, not merely a printed URL.
URL=""
for _ in $(seq 1 60); do
  if grep -q "Registered tunnel connection" "$LOG" 2>/dev/null; then
    URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1)"
    [ -n "$URL" ] && break
  fi
  if grep -qE "failed to (dial|connect)|ERR .*Failed to dial" "$LOG" 2>/dev/null \
     && ! grep -q "Registered tunnel connection" "$LOG" 2>/dev/null; then
    : # keep waiting; cloudflared retries other edges
  fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "Tunnel did not register within 60s. cloudflared said:" >&2
  tail -20 "$LOG" >&2
  exit 1
fi

WEBHOOK="$URL/api/webhooks/lipila"

# Point the gateway at it. The URL is sent as the per-request `callbackUrl`
# header on every collection/disbursement, so this takes effect immediately for
# new transactions once the config cache is cleared.
if [ -f "$ENV_FILE" ]; then
  python - "$ENV_FILE" "$WEBHOOK" <<'PY'
import io, re, sys
path, url = sys.argv[1], sys.argv[2]
s = io.open(path, encoding='utf-8').read()
if re.search(r'^LIPILA_CALLBACK_URL=.*$', s, re.M):
    s = re.sub(r'^LIPILA_CALLBACK_URL=.*$', 'LIPILA_CALLBACK_URL=' + url, s, count=1, flags=re.M)
else:
    s = s.rstrip() + '\nLIPILA_CALLBACK_URL=' + url + '\n'
io.open(path, 'w', encoding='utf-8', newline='').write(s)
PY
  echo "  updated LIPILA_CALLBACK_URL in backend/.env"

  PHP=/c/Users/CICT-SD/.config/herd/bin/php84/php.exe
  [ -x "$PHP" ] && (cd "$ROOT/backend" && "$PHP" artisan config:clear >/dev/null 2>&1) \
    && echo "  cleared config cache"
fi

cat <<EOF

  Tunnel is live.

    Public URL : $URL
    Webhook    : $WEBHOOK

  Note: this machine cannot resolve trycloudflare.com (institutional DNS), so
  curling the URL from here fails even though the tunnel is fine. Lipila
  resolves it from its own network.

  Leave this window open — closing it drops the tunnel.
  Ctrl+C to stop.

EOF

wait "$PID"
