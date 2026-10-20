#!/bin/bash
# Pulls a fresh CSV dump of every table from the old FlyTrace site.
#   FLYTRACE_DUMP_API_KEY=... db/legacy/dump-all-tables.sh [output-dir]
# Default output dir: db/legacy/dump/<timestamp> (gitignored: the dump holds emails and password hashes).

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

[ -z "${FLYTRACE_DUMP_API_KEY:-}" ] && { echo "You must set FLYTRACE_DUMP_API_KEY"; exit 1; }

tables='aspnet_Applications aspnet_Membership aspnet_Roles aspnet_SchemaVersions aspnet_Users aspnet_UsersInRoles Event Group GroupTracker Task UserProfile Waypoint'

dump_dir="${1:-$SCRIPT_DIR/dump/$(date +%Y%m%d_%H%M%S)}"
mkdir -p "$dump_dir"

for table in $tables; do
  echo "Getting $table . . ."
  if ! curl -sSf "https://spot.flytrace.com/Tracker/migration.aspx?appKey=${FLYTRACE_DUMP_API_KEY}&table=$table" > "$dump_dir/$table.csv"; then
    echo "Can't get '$table'"
    exit 1
  fi
done

echo "Done: $dump_dir"
