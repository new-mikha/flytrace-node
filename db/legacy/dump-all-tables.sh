#!/bin/bash
###############################################################################
#  Flytrace, online viewer for GPS trackers.
#  Copyright (C) 2011-2026 Mikhail Karmazin
#
#  This file is part of Flytrace.
#
#  Flytrace is free software: you can redistribute it and/or modify
#  it under the terms of the GNU Affero General Public License as
#  published by the Free Software Foundation, either version 3 of the
#  License, or (at your option) any later version.
#
#  Flytrace is distributed in the hope that it will be useful,
#  but WITHOUT ANY WARRANTY; without even the implied warranty of
#  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  GNU Affero General Public License for more details.
#
#  You should have received a copy of the GNU Affero General Public License
#  along with Flytrace.  If not, see <http://www.gnu.org/licenses/>.
###############################################################################

# Pulls a fresh CSV dump of every table from the old Flytrace site.
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
