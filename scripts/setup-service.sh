#!/usr/bin/env bash
# One-time setup of the Flytrace service on the server (the Raspberry Pi):
#   scripts/setup-service.sh user@host [remote-dir]      remote-dir is relative to the remote home, default "flytrace"
# Installs the systemd unit (starts at boot, restarts if it dies) and lets that user restart ONLY this service
# without a password, which scripts/deploy.sh needs. Asks for the sudo password on the server once.
# Stop any copy of the app that you started by hand first: it would hold the port.
set -euo pipefail

target="${1:?Usage: scripts/setup-service.sh user@host [remote-dir]}"
dir="${2:-flytrace}"

cd "$(dirname "$0")/.."

remote_user=$(ssh "$target" 'id -un')
remote_home=$(ssh "$target" 'echo "$HOME"')
node_bin=$(ssh "$target" "bash -lc 'command -v node'") || true
systemctl_bin=$(ssh "$target" 'command -v systemctl') || true
[ -n "$node_bin" ] || { echo "node was not found on $target (checked in a login shell)." >&2; exit 1; }
[ -n "$systemctl_bin" ] || { echo "systemctl was not found on $target." >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
sed -e "s#@USER@#$remote_user#g" -e "s#@DIR@#$remote_home/$dir#g" -e "s#@NODE@#$node_bin#g" deploy/flytrace.service > "$work/flytrace.service"
printf '%s ALL=(root) NOPASSWD: %s restart flytrace\n' "$remote_user" "$systemctl_bin" > "$work/flytrace-sudoers"

scp "$work/flytrace.service" "$work/flytrace-sudoers" "$target:/tmp/"
# The sudoers file is checked with visudo before it is installed: a broken one would lock sudo.
ssh -t "$target" "sudo install -m 644 /tmp/flytrace.service /etc/systemd/system/flytrace.service \
  && sudo visudo -cf /tmp/flytrace-sudoers \
  && sudo install -m 440 /tmp/flytrace-sudoers /etc/sudoers.d/flytrace \
  && rm -f /tmp/flytrace.service /tmp/flytrace-sudoers \
  && sudo systemctl daemon-reload && sudo systemctl enable --now flytrace \
  && systemctl --no-pager --lines=5 status flytrace || true"

echo "Service installed on $target. Logs: ssh $target journalctl -u flytrace -f"
