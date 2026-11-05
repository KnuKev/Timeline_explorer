#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
url='http://127.0.0.1:5173/'

fail() {
  printf '%s\n' "$1" >&2
  if command -v xmessage >/dev/null 2>&1; then
    xmessage -center -title 'Timeline Explorer' -buttons OK:0 "$1" || true
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send --urgency=critical 'Timeline Explorer' "$1" || true
  fi
  exit 1
}

for program in node curl flock; do
  command -v "$program" >/dev/null 2>&1 || fail "Mangler $program. Installer programmet og prøv igjen."
done
browser="$(command -v chromium || command -v chromium-browser || true)"
[[ -n "$browser" ]] || fail 'Chromium ble ikke funnet. Installer Chromium og prøv igjen.'
[[ -f "$project_dir/node_modules/vite/bin/vite.js" ]] || fail "Prosjektpakkene mangler. Kjør npm install i $project_dir først."

cd -- "$project_dir"
log_dir="$project_dir/node_modules/.cache/timeline-launcher"
mkdir -p -- "$log_dir"

server_ready() {
  curl --noproxy '*' --fail --silent --max-time 1 "$url" | grep -Fq '<title>Timeline Explorer</title>'
}

# Serialize simultaneous double-clicks. The detached server must not inherit this lock.
exec 9>"$log_dir/launch.lock"
flock -w 20 9 || fail 'En annen oppstart pågår. Prøv igjen om et øyeblikk.'
if ! server_ready; then
  nohup node "$project_dir/node_modules/vite/bin/vite.js" --host 127.0.0.1 --port 5173 --strictPort \
    >"$log_dir/server.log" 2>&1 </dev/null 9>&- &
  server_pid=$!
  for ((attempt = 0; attempt < 60; attempt++)); do
    if server_ready; then break; fi
    if ! kill -0 "$server_pid" 2>/dev/null; then
      fail "Timeline Explorer kunne ikke starte. Port 5173 kan være i bruk. Detaljer: $log_dir/server.log"
    fi
    sleep 0.25
  done
  server_ready || fail "Serveren ble ikke klar i tide. Detaljer: $log_dir/server.log"
fi
flock -u 9
exec 9>&-

# A normal Chromium window uses the user's existing profile and saved language.
nohup "$browser" --new-window "$url" >"$log_dir/chromium.log" 2>&1 </dev/null &
