-- Move staged legacy data into the real schema. Runs inside the import transaction.

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
SELECT e.Id, e.UserId, e.Name, e.StartTs
FROM orig_Event e
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
  g.Id, g.Name, g.UserId,
  CASE WHEN g.EventId IN (SELECT id FROM events) THEN g.EventId END,
  g.NewestCoordTs, g.NewestLat, g.NewestLon,
  g.ViewsNum, g.PageUpdatesNum, g.IsPublic, g.Version, g.DisplayUserMessages
FROM orig_Group g
WHERE g.UserId IN (SELECT id FROM users);

INSERT INTO group_trackers (id, group_id, name, tracker_type, foreign_id, foreign_id_as_entered, is_on)
SELECT t.Id, t.GroupId, t.Name, t.TrackerType, t.TrackerForeignId, t.TrackerForeignIdAsEntered, t.IsOn
FROM orig_GroupTracker t
WHERE t.GroupId IN (SELECT id FROM groups);

INSERT INTO waypoints (id, event_id, name, lat, lon, alt, description)
SELECT w.Id, w.EventId, w.Name, w.Lat, w.Lon, w.Alt, NULLIF(w.Description, '')
FROM orig_Waypoint w
WHERE w.EventId IN (SELECT id FROM events);

INSERT INTO tasks (id, waypoint_id, radius, wpt_order)
SELECT k.Id, k.WaypointId, k.Radius, k.WptOrder
FROM orig_Task k
WHERE k.WaypointId IN (SELECT id FROM waypoints);

-- Imported rows kept their original ids; move the identity sequences past them.
SELECT setval(pg_get_serial_sequence('events', 'id'),         COALESCE(MAX(id), 1)) FROM events;
SELECT setval(pg_get_serial_sequence('groups', 'id'),         COALESCE(MAX(id), 1)) FROM groups;
SELECT setval(pg_get_serial_sequence('group_trackers', 'id'), COALESCE(MAX(id), 1)) FROM group_trackers;
SELECT setval(pg_get_serial_sequence('waypoints', 'id'),      COALESCE(MAX(id), 1)) FROM waypoints;
SELECT setval(pg_get_serial_sequence('tasks', 'id'),          COALESCE(MAX(id), 1)) FROM tasks;
