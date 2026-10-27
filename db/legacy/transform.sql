-------------------------------------------------------------------------------
--  Flytrace, online viewer for GPS trackers.
--  Copyright (C) 2011-2026 Mikhail Karmazin
--
--  This file is part of Flytrace.
--
--  Flytrace is free software: you can redistribute it and/or modify
--  it under the terms of the GNU Affero General Public License as
--  published by the Free Software Foundation, either version 3 of the
--  License, or (at your option) any later version.
--
--  Flytrace is distributed in the hope that it will be useful,
--  but WITHOUT ANY WARRANTY; without even the implied warranty of
--  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
--  GNU Affero General Public License for more details.
--
--  You should have received a copy of the GNU Affero General Public License
--  along with Flytrace.  If not, see <http://www.gnu.org/licenses/>.
-------------------------------------------------------------------------------

-- Move staged legacy data into the real schema. Runs inside the import transaction.
--
-- The old schema allowed several events / groups / trackers / waypoints with the same name; the new one has
-- unique names (per owner, group or event). Duplicates keep their rows and ids and get " (2)", " (3)" ... added
-- to the name, in id order, so nothing is dropped.

INSERT INTO users (id, username, email, password_hash, is_approved, is_locked_out,
                   created_at, last_login_at, legacy_last_activity_at)
SELECT
  u.UserId,
  u.UserName,
  NULLIF(m.Email, ''),
  'flytrace1|' || m.Password || '|' || m.PasswordFormat || '|' || m.PasswordSalt,
  m.IsApproved,
  m.IsLockedOut,
  m.CreateDate,
  NULLIF(m.LastLoginDate, m.CreateDate),  -- old provider sets LastLoginDate = CreateDate for never-logged-in users
  u.LastActivityDate
FROM orig_aspnet_Users u
JOIN orig_aspnet_Membership m ON m.UserId = u.UserId AND m.ApplicationId = u.ApplicationId
WHERE u.UserName NOT IN (SELECT username FROM legacy_exclude);

-- Roles were seeded by the schema migration; remap legacy role ids by name.
INSERT INTO roles (id, name)
SELECT r.RoleId, r.RoleName FROM orig_aspnet_Roles r
ON CONFLICT (name) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT ur.UserId, ro.id
FROM orig_aspnet_UsersInRoles ur
JOIN orig_aspnet_Roles r ON r.RoleId = ur.RoleId
JOIN roles ro ON ro.name = r.RoleName
WHERE ur.UserId IN (SELECT id FROM users);

INSERT INTO events (id, user_id, name, start_ts)
SELECT e.Id, e.UserId,
       CASE WHEN n.rn = 1 THEN e.Name ELSE left(e.Name, 256 - length(' (' || n.rn || ')')) || ' (' || n.rn || ')' END,
       e.StartTs
FROM orig_Event e
JOIN (SELECT Id, row_number() OVER (PARTITION BY UserId, lower(Name) ORDER BY Id) AS rn FROM orig_Event) n ON n.Id = e.Id
WHERE e.UserId IN (SELECT id FROM users);

INSERT INTO user_profiles (user_id, default_event_id, is_simple_events_model, coord_format,
                           def_hemisphere_ns, def_hemisphere_ew, show_user_messages_by_default,
                           user_messages_setting_is_new, altitude_unit)
SELECT
  p.UserId,
  CASE WHEN p.DefaultEventId IN (SELECT id FROM events) THEN p.DefaultEventId END,
  p.IsSimpleEventsModel, p.CoordFormat, p.DefHemisphereNS, p.DefHemisphereEW,
  p.ShowUserMessagesByDefault, p.UserMessagesSettingIsNew,
  NULLIF(p.Altitude, '')
FROM orig_UserProfile p
WHERE p.UserId IN (SELECT id FROM users);

INSERT INTO groups (id, name, user_id, event_id, newest_coord_ts, newest_lat, newest_lon,
                    views_num, page_updates_num, is_public, version, display_user_messages)
SELECT
  g.Id,
  CASE WHEN n.rn = 1 THEN g.Name ELSE left(g.Name, 256 - length(' (' || n.rn || ')')) || ' (' || n.rn || ')' END,
  g.UserId,
  CASE WHEN g.EventId IN (SELECT id FROM events) THEN g.EventId END,
  g.NewestCoordTs, g.NewestLat, g.NewestLon,
  g.ViewsNum, g.PageUpdatesNum, g.IsPublic, g.Version, g.DisplayUserMessages
FROM orig_Group g
JOIN (SELECT Id, row_number() OVER (PARTITION BY UserId, lower(Name) ORDER BY Id) AS rn FROM orig_Group) n ON n.Id = g.Id
WHERE g.UserId IN (SELECT id FROM users);

INSERT INTO group_trackers (id, group_id, name, tracker_type, foreign_id, foreign_id_as_entered, is_on)
SELECT t.Id, t.GroupId,
       CASE WHEN n.rn = 1 THEN t.Name ELSE left(t.Name, 50 - length(' (' || n.rn || ')')) || ' (' || n.rn || ')' END,
       t.TrackerType, t.TrackerForeignId, t.TrackerForeignIdAsEntered, t.IsOn
FROM orig_GroupTracker t
JOIN (SELECT Id, row_number() OVER (PARTITION BY GroupId, lower(Name) ORDER BY Id) AS rn FROM orig_GroupTracker) n ON n.Id = t.Id
WHERE t.GroupId IN (SELECT id FROM groups);

INSERT INTO waypoints (id, event_id, name, lat, lon, alt, description)
SELECT w.Id, w.EventId,
       CASE WHEN n.rn = 1 THEN w.Name ELSE left(w.Name, 50 - length(' (' || n.rn || ')')) || ' (' || n.rn || ')' END,
       w.Lat, w.Lon, w.Alt, NULLIF(w.Description, '')
FROM orig_Waypoint w
JOIN (SELECT Id, row_number() OVER (PARTITION BY EventId, lower(Name) ORDER BY Id) AS rn FROM orig_Waypoint) n ON n.Id = w.Id
WHERE w.EventId IN (SELECT id FROM events);

INSERT INTO tasks (id, waypoint_id, radius, wpt_order)
SELECT k.Id, k.WaypointId, k.Radius, k.WptOrder
FROM orig_Task k
WHERE k.WaypointId IN (SELECT id FROM waypoints);

-- Renamed duplicates, for import-legacy.ts to report (compare the staged name with the name that was stored).
CREATE TEMP TABLE legacy_renames ON COMMIT DROP AS
SELECT 'event' AS entity, e.id, 'owner ' || u.username AS context, o.Name AS old_name, e.name AS new_name
  FROM events e JOIN orig_Event o ON o.Id = e.id JOIN users u ON u.id = e.user_id WHERE o.Name <> e.name
UNION ALL
SELECT 'group', g.id, 'owner ' || u.username, o.Name, g.name
  FROM groups g JOIN orig_Group o ON o.Id = g.id JOIN users u ON u.id = g.user_id WHERE o.Name <> g.name
UNION ALL
SELECT 'tracker', t.id, 'group ' || t.group_id, o.Name, t.name
  FROM group_trackers t JOIN orig_GroupTracker o ON o.Id = t.id WHERE o.Name <> t.name
UNION ALL
SELECT 'waypoint', w.id, 'event ' || w.event_id, o.Name, w.name
  FROM waypoints w JOIN orig_Waypoint o ON o.Id = w.id WHERE o.Name <> w.name;

-- Imported rows kept their original ids; move the identity sequences past them.
SELECT setval(pg_get_serial_sequence('events', 'id'),         COALESCE(MAX(id), 1)) FROM events;
SELECT setval(pg_get_serial_sequence('groups', 'id'),         COALESCE(MAX(id), 1)) FROM groups;
SELECT setval(pg_get_serial_sequence('group_trackers', 'id'), COALESCE(MAX(id), 1)) FROM group_trackers;
SELECT setval(pg_get_serial_sequence('waypoints', 'id'),      COALESCE(MAX(id), 1)) FROM waypoints;
SELECT setval(pg_get_serial_sequence('tasks', 'id'),          COALESCE(MAX(id), 1)) FROM tasks;
