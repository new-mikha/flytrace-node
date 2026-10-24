#!/usr/bin/env bash
# Builds the app, copies it to the server (the Raspberry Pi), restarts the service and checks that it answers.
#   scripts/deploy.sh user@host [remote-dir]      remote-dir is relative to the remote home, default "flytrace"
# The server keeps its own .env and node_modules, and the database stays as it is. The service is installed once with
# scripts/setup-service.sh. When package-lock.json changed, the dependencies are installed on the server first.
set -euo pipefail

target="${1:?Usage: scripts/deploy.sh user@host [remote-dir]}"
dir="${2:-flytrace}"

cd "$(dirname "$0")/.."

npm run build

local_lock=$(shasum -a 256 package-lock.json | cut -d' ' -f1)
remote_lock=$(ssh "$target" "sha256sum '$dir/package-lock.json' 2>/dev/null | cut -d' ' -f1" || true)

# Start from clean copies, so that files deleted here do not linger there.
ssh "$target" "mkdir -p '$dir' && rm -rf '$dir/dist' '$dir/public'"
scp -r dist public package.json package-lock.json "$target:$dir/"

if [ "$local_lock" != "$remote_lock" ]; then
  echo "package-lock.json changed: installing dependencies on the server..."
  ssh "$target" "bash -lc 'cd \"$dir\" && npm ci --omit=dev'"
fi

echo "Restarting the service..."
ssh "$target" "sudo -n systemctl restart flytrace" \
  || { echo "Restart failed. Is the service installed? Run: scripts/setup-service.sh $target" >&2; exit 1; }

# The restart is only worth anything when the app answers afterwards: wait for the home page (uses the PORT of the server's .env).
echo "Waiting for the app to answer..."
ssh "$target" "cd '$dir'; port=\$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2 | tr -d '\"\\r '); port=\${port:-3000}
  for i in \$(seq 1 30); do
    [ \"\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:\$port/)\" = 200 ] && exit 0
    sleep 1
  done
  echo 'The app did not answer in 30 seconds. Last log lines:' >&2
  journalctl -u flytrace -n 30 --no-pager >&2
  exit 1"

echo "Deployed to $target:$dir and running."
