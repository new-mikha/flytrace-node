-- Post-import checks. Each row: check name, expected, actual, ok.
-- "expected" for row counts = staged rows minus rows belonging to excluded users.
-- import-legacy.ts fails (and rolls back) when any row has ok = false.

WITH excluded_users AS (
  SELECT u.UserId FROM orig_aspnet_Users u WHERE u.UserName IN (SELECT username FROM legacy_exclude)
),
excluded_events AS (SELECT Id FROM orig_Event WHERE UserId IN (SELECT UserId FROM excluded_users)),
excluded_groups AS (SELECT Id FROM orig_Group WHERE UserId IN (SELECT UserId FROM excluded_users)),
excluded_waypoints AS (SELECT Id FROM orig_Waypoint WHERE EventId IN (SELECT Id FROM excluded_events)),
checks (check_name, expected, actual) AS (
  VALUES
  ('users',
    (SELECT count(*) FROM orig_aspnet_Users) - (SELECT count(*) FROM excluded_users),
    (SELECT count(*) FROM users)),
  ('user_roles',
    (SELECT count(*) FROM orig_aspnet_UsersInRoles WHERE UserId NOT IN (SELECT UserId FROM excluded_users)),
    (SELECT count(*) FROM user_roles)),
  ('events',
    (SELECT count(*) FROM orig_Event) - (SELECT count(*) FROM excluded_events),
    (SELECT count(*) FROM events)),
  ('user_profiles',
    (SELECT count(*) FROM orig_UserProfile WHERE UserId NOT IN (SELECT UserId FROM excluded_users)),
    (SELECT count(*) FROM user_profiles)),
  ('groups',
    (SELECT count(*) FROM orig_Group) - (SELECT count(*) FROM excluded_groups),
    (SELECT count(*) FROM groups)),
  ('group_trackers',
    (SELECT count(*) FROM orig_GroupTracker WHERE GroupId NOT IN (SELECT Id FROM excluded_groups)),
    (SELECT count(*) FROM group_trackers)),
  ('waypoints',
    (SELECT count(*) FROM orig_Waypoint) - (SELECT count(*) FROM excluded_waypoints),
    (SELECT count(*) FROM waypoints)),
  ('tasks',
    (SELECT count(*) FROM orig_Task WHERE WaypointId NOT IN (SELECT Id FROM excluded_waypoints)),
    (SELECT count(*) FROM tasks)),
  -- Referential sanity against the staged data (FKs make these impossible, but a dropped row would show up above)
  ('groups with event not in events (staged)',
    0, (SELECT count(*) FROM orig_Group g WHERE g.EventId IS NOT NULL AND g.EventId NOT IN (SELECT Id FROM orig_Event))),
  ('users without a legacy password hash',
    0, (SELECT count(*) FROM users WHERE password_hash NOT LIKE 'flytrace1|%|1|%')),
  ('admins present',
    1, (SELECT LEAST(count(*), 1) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name = 'Admins')),
  ('groups id sequence past max id',
    1, (SELECT CASE WHEN (SELECT last_value FROM groups_id_seq) >= COALESCE((SELECT max(id) FROM groups), 0) THEN 1 ELSE 0 END))
)
SELECT check_name, expected, actual, expected = actual AS ok FROM checks
UNION ALL
-- informational only (always ok)
SELECT 'excluded users (info)', 0, (SELECT count(*) FROM excluded_users), true;
