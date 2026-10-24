#!/usr/bin/env bash
# Builds the app and copies it to the server (the Raspberry Pi).
#   scripts/deploy.sh user@host [remote-dir]      remote-dir is relative to the remote home, default "flytrace"
# The server keeps its own .env and node_modules, and the database stays as it is; restart the app afterwards.
set -euo pipefail

target="${1:?Usage: scripts/deploy.sh user@host [remote-dir]}"
dir="${2:-flytrace}"

cd "$(dirname "$0")/.."

npm run build

# Start from clean copies, so that files deleted here do not linger there.
ssh "$target" "mkdir -p '$dir' && rm -rf '$dir/dist' '$dir/public'"
scp -r dist public package.json package-lock.json "$target:$dir/"

echo "Deployed to $target:$dir. Restart the app there (and run 'npm ci --omit=dev' if package-lock.json changed)."
