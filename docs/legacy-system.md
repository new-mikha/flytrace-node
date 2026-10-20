# FlyTrace legacy system: how it works

Hand-over document for whoever continues the migration of FlyTrace from ASP.NET WebForms to Node + Postgres.
It describes the **existing production system** (https://www.flytrace.com/tracker, source in
`/Users/michael/dev-top/flytrace-upgrade/flytrace`) feature by feature and down to implementation details,
then maps it onto what already exists in this repo (`flytrace-node`) and what is still to be built.

Everything here was taken from reading the legacy source; where something could not be confirmed it is marked
**(verify)**. File paths are relative to the legacy repo root unless they start with `flytrace-node/`.

---

## 1. Orientation

### 1.1 Repositories and folders

| Path | What it is |
|---|---|
| `/Users/michael/dev-top/flytrace-upgrade/flytrace` | The legacy app. .NET Framework 4.7.1, ASP.NET WebForms, C#, Google Maps JS. Deployed on IIS/Windows. Git remote: bitbucket `michael-karmazin/flytrace`; public mirror github `new-mikha/flytrace`. AGPL-3.0. |
| `/Users/michael/dev-top/Flytrace4` | Abandoned .NET 10 + Angular 21 rewrite attempt (github `new-mikha/flytrace4`). Only useful for: `flytrace1-migration/orig-mssql-db-script.sql` (complete original MSSQL DDL incl. stored procedures), `flytrace1-migration/flytrace1-dump/` (production CSV dumps), `dump-all-tables.sh`. |
| `/Users/michael/dev-top/flytrace-upgrade/flytrace4`, `.../flytrace4-dotnet-upgrade` | Stale copies of early Flytrace4. Ignore. |
| `/Users/michael/dev-top/flytrace-upgrade/flytrace-node` | **This repo.** The Node/Postgres rewrite. Milestone 1 done (schema, legacy import, auth + roles skeleton). |

### 1.2 What FlyTrace does, in one paragraph

A group owner creates a *group* of *trackers* (SPOT satellite messengers and Garmin inReach devices, identified by
their public share-page / KML-feed IDs) and shares a link `map.aspx?group=N`. Anyone opening that link sees all
trackers of the group on one Google map, refreshed every 30 seconds, with the latest position, status (on track /
landed OK / custom / SOS), age, optional owner-defined message, optional altitude, a short "last leg" line and,
on demand, the full track of the last 12 hours. The server polls the SPOT and Garmin public feeds on behalf of all
currently-watched groups, caches tracker state in memory, and serves it with an incremental-update protocol designed
for weak mobile connections. Optional extras for competitions: *events* with uploaded waypoints and a daily *task*
drawn on the map, and a "hide points older than now" switch. Built for hang-/para-gliding ("pilots"), usable for
anything.

### 1.3 Legacy solution layout

```
Tracker.sln
├── Tracker/            WebForms site (pages, user controls, Web API controller, ASMX web service, scripts, themes)
├── Service/            Coordinates service: group definitions, tracker cache, scheduler, incremental-update logic
├── LocationLib/        Foreign feed access: SPOT + inReach HTTP clients and parsers, data model, TEST source
├── LocationLib.Test/   NUnit tests with real SPOT XML and inReach KML fixtures
├── Service.Test/       Scheduler tests
├── LocationRequestTest/ WinForms manual test harness
├── Screenshots/        Help-page screenshots project (irrelevant)
├── BuildTools/         ConfigHelper + ApplicationSettingsExtract.targets (generates Web.*.dll.config at build)
├── DB scripts/         Only a restore-from-backup template; schema lives in the .mdf / orig-mssql-db-script.sql
└── Site update scripts/ ps1/cmd deployment helpers (zip site, get update)
```

Dependency direction: `Tracker` → `Service` → `LocationLib`. `Service` is host-agnostic; `Tracker` hosts it via
`Global.asax` and exposes it via `Service/TrackerService.asmx`.

### 1.4 Request flow at a glance

```
Browser (map.aspx + main.js)
  │  every 30 s: TrackerService.GetCoordinates(group, seed, now)      ASMX JSON (ScriptService)
  │  on demand : TrackerService.GetTracks(group, {Items[≤10]}, now)
  ▼
Tracker/Service/TrackerService.asmx.cs  →  Service.ServiceFacade  →  Internals.TrackerFacade
  │                                                                      │
  │                                                 CoordinatesService / TracksService (one instance per call)
  │                                                      │ GroupFacade.GetGroupTrackerIds (DB, cached per group)
  │                                                      │ ForeignRequestsManager.Trackers (in-memory snapshots)
  │                                                      │ AddMissingTrackers → scheduler starts polling them
  ▼
ForeignRequestsManager "LocWorker" thread + Scheduler
  │  picks most-stale tracker per foreign system, respects pack/interval limits
  ▼
LocationLib: SpotLocationRequest / InReachLocationRequest → 1..n FeedRequest HTTP calls → TrackerState
  │  merged with previous snapshot (RevisedTrackerState.Merge) → new DataRevision
  ▼
api.findmespot.com (XML)        share.garmin.com (KML)
```

---

## 2. Data model and database

Source of truth: `/Users/michael/dev-top/Flytrace4/flytrace1-migration/orig-mssql-db-script.sql` (copy at
`flytrace-node/db/legacy/orig-mssql-db-script.sql`). Access in the legacy app is via a typed DataSet
(`Tracker/TrackerDataSet.xsd`, table adapters + `ProcsAdapter`), ad-hoc `SqlCommand`s in `Service/`, and inline SQL
in `Tracker/App_GlobalResources/Resources.resx` (`SelectPublicGroupsSql`, `SelectUserGroupsSql`). All datetimes are
stored as UTC `datetime` without zone.

### 2.1 Tables

**ASP.NET membership (`aspnet_*`)**: standard `SqlMembershipProvider`/`SqlRoleProvider` schema, application name
`Tracker`. Relevant columns: `aspnet_Users(UserId uniqueidentifier, UserName, LoweredUserName, LastActivityDate)`,
`aspnet_Membership(UserId, Password, PasswordFormat, PasswordSalt, Email, LoweredEmail, IsApproved, IsLockedOut,
CreateDate, LastLoginDate, LastPasswordChangedDate, FailedPasswordAttemptCount, ...)`, `aspnet_Roles(RoleId, RoleName)`,
`aspnet_UsersInRoles(UserId, RoleId)`. Password format in production is always `1` = hashed (see §3.2).

**Event** ("Event" is a short name for "waypoint set"; MS_Description in the DDL)
```
Id int identity PK, UserId uniqueidentifier NOT NULL FK aspnet_Users ON DELETE CASCADE,
Name nvarchar(256) NOT NULL, StartTs datetime NULL
UNIQUE (UserId, Name)                                  -- IX_Event_UserId_Name
```
`StartTs` is the "hide old points" threshold (§6.6). View `EventView` adds `IsDefault = (UserProfile.DefaultEventId = E.Id)`.

**Group**
```
Id int identity(33,1) PK, Name nvarchar(256) NOT NULL, UserId FK aspnet_Users CASCADE,
EventId int NULL FK Event (no cascade; DeleteEvent proc nulls it),
NewestCoordTs datetime NULL, NewestLat float NULL, NewestLon float NULL,     -- stats, updated by the service
ViewsNum int NOT NULL DEFAULT 0,          -- +1 per map.aspx page load
PageUpdatesNum bigint NOT NULL DEFAULT 0, -- +1 per GetCoordinates call
IsPublic bit NOT NULL DEFAULT 1,          -- listed on the home page
Version int NOT NULL,                     -- incremented on any change that affects clients (see §2.3)
DisplayUserMessages bit NOT NULL DEFAULT 0
UNIQUE (UserId, Name)                                  -- IX_Group_UserId_Name
```

**GroupTracker**
```
Id int identity PK, GroupId FK Group ON UPDATE/DELETE CASCADE, Name nvarchar(50) NOT NULL,
TrackerType char(1) NOT NULL CHECK IN ('S','G'),      -- S = SPOT, G = Garmin inReach
TrackerForeignId nvarchar(445) NOT NULL,              -- normalised id/URL used for polling (see §7.3, §7.4)
TrackerForeignIdAsEntered nvarchar(445) NULL,         -- raw user input, kept in case Garmin changes URL rules
IsOn bit NOT NULL DEFAULT 1                           -- false = "hidden" tracker (still polled, shown struck-through)
UNIQUE (GroupId, Name)                                 -- IX_GroupTracker_GroupId_Name  → "This group already has a pilot with such name"
UNIQUE (GroupId, TrackerType, TrackerForeignId)        -- IX_GroupTracker_GroupId_Tracker → "This tracker is already in the group"
```
Note the service also knows a third type `TEST` (ForeignId.TEST) that never hits the DB (§7.5).

**Waypoint**
```
Id int identity PK, EventId FK Event CASCADE, Name nvarchar(50) NOT NULL, Lat float, Lon float, Alt float NOT NULL,
Description nvarchar(500) NULL
UNIQUE (EventId, Name)                                 -- IX_Waypoint → "'X' has already been used as a waypoint name"
```

**Task** (one task per event; rows are ordered waypoint references)
```
Id int identity PK, WaypointId FK Waypoint CASCADE, Radius int NOT NULL (metres), WptOrder int NOT NULL
```
Deleting a waypoint used in a task fails with FK 547 → "Cannot delete the waypoint 'X' because it's used in the task".

**UserProfile** (one row per user, created lazily by `GetUserProfile`)
```
UserId PK FK aspnet_Users CASCADE,
DefaultEventId int NULL FK Event,                      -- the "Today Task" event in single-event mode
IsSimpleEventsModel bit DEFAULT 1,                     -- 1 = single-event mode, 0 = multiple events
CoordFormat nvarchar(50) DEFAULT 'Deg' CHECK IN ('Deg','DegMin','DegMinSec'),
DefHemisphereNS char(1) DEFAULT 'N', DefHemisphereEW char(1) DEFAULT 'E',   -- prefilled on waypoint entry forms
ShowUserMessagesByDefault bit DEFAULT 0,
UserMessagesSettingIsNew bit DEFAULT 0,                -- shows a "New!" nag on manageGroup until user touches the setting
Altitude nvarchar(20) NULL DEFAULT 'ft' CHECK IN (NULL,'ft','m')             -- NULL = do not show altitude
```

### 2.2 Stored procedures (application ones; `aspnet_*` are standard)

| Proc | Semantics |
|---|---|
| `GetGroupTrackerIds(@GroupId, out Version, out DisplayUserMessages, out StartTs, out AltitudeDisplayFormat)` | **The** query the coordinates service runs per group. `REPEATABLE READ` transaction: reads `Group.Version` first (shared lock), then `Event.StartTs` via `Group.EventId`, owner's `UserProfile.Altitude`, then `GroupTracker (Name, TrackerType, TrackerForeignId, IsOn)`. Writers bump `Version` first in their transaction so reads and writes serialise. |
| `AddTrackerToGroup`, `UpdateTrackerInGroup(@TrackerId,@Name)`, `DeleteTrackerFromGroup(@TrackerId)` | Each does `UPDATE Group SET Version=Version+1` then the change, in one transaction. |
| `CreateTrackersGroup(@UserId, out NewGroupId)` | Finds free name `Group 01`, `Group 02`, ... (`ZeroPaddedString`). Reads profile; in single-event mode calls `EnsureDefaultTask` and assigns the default event. `DisplayUserMessages` = profile `ShowUserMessagesByDefault`. `Version=0`. |
| `CreateEvent(@UserId, out NewEventId)` | Free name `Event 01`, ... |
| `AssignEventToGroup(@EventId NULL-able, @GroupId)` | Only if the event belongs to the same user as the group; also calls `SetEventAsDefault`. |
| `SetEventAsDefault(@EventId)` / `SetEventAsNonDefault(@EventId)` | Writes/clears `UserProfile.DefaultEventId` (upsert). **Bug:** `SetEventAsNonDefault` runs `UPDATE UserProfile SET DefaultEventId = NULL` *without a WHERE*, clearing every user's default event. Do not replicate. |
| `EnsureDefaultTask(@UserId, out DefaultEventId)` | If profile has no default event, create one and set it default (transaction with UPDLOCK on the profile row). |
| `GetDefaultEventParams(@UserId, out DefaultEventId, out LoadedWptsCount, out TaskWptsCount)` | Counts for the "Today Task" panel. |
| `DeleteEvent(@EventId)` | Nulls `UserProfile.DefaultEventId` and `Group.EventId` referencing it, then deletes (waypoints/tasks cascade). |
| `GetUserProfile(@UserId, out ...)` | Upsert-read with `UPDLOCK`; inserts a default row if missing. |
| `SetEventsModel`, `SetCoordFormat`, `SetDefHemispheres`, `SetAltitudeDisplayMode`, `SetUserMessagesFlag`, `SetUserMessagesSettingIsNewFlag` | Profile upserts of single columns. |
| `ShowUserMessagesInAllGroupsForUser(@UserId)` | `UPDATE Group SET DisplayUserMessages=1 WHERE UserId=@UserId`. |
| `UpdateEventStartTs(@EventId, @StartTs)` | Bumps `Version` of **all groups assigned to the event**, then sets `Event.StartTs`. |

Typed-dataset ad-hoc SQL worth knowing (`TrackerDataSet.xsd`):
- Group adapter `Update` always does `Version = Version + 1` (so renaming/public/messages changes also invalidate client seeds).
- `GroupTrackerTableAdapter.ForeignTrackerIdCheck(@TrackerForeignId, @TrackerType)` = `COUNT(*)` of that tracker anywhere in the DB (used to skip live validation of already-known trackers).
- `UpdateGroupViewsNum`: `ViewsNum = ViewsNum + 1`.
- `TaskWaypointTableAdapter.GetDataByEventId`: `Waypoint.Name, Lat, Lon, Task.Radius ... ORDER BY WptOrder` (what the map draws).
- `UserStat` queries (admin): groups per user, distinct trackers per user, filtered by `UserName LIKE @filter`.

Home page lists (`Resources.resx`):
```sql
-- SelectPublicGroupsSql: "others' public groups"
SELECT * FROM (SELECT G.*, U.UserName, (SELECT COUNT(*) FROM GroupTracker GT WHERE GT.GroupId=G.Id) AS TrackersCount
               FROM [Group] G JOIN aspnet_Users U ON G.UserId=U.UserId
               WHERE G.IsPublic=1 OR @IsAdmin=1) rst
WHERE rst.TrackersCount > 1 AND (@UserId IS NULL OR UserId<>@UserId)
-- SelectUserGroupsSql: the logged-in user's own groups, with EventId shown only when it is relevant to the events model,
-- EventName, TaskWptCount, TrackersCount.
```
So a public group appears on the home page only with **2 or more trackers**, admins see unlisted groups too, and
your own groups are excluded from the "others" list. Default sort: `NewestCoordTs DESC`.

### 2.3 The `Group.Version` contract

`Version` exists for the incremental-update protocol (§8.4). It must increase whenever anything a map client has
cached about the group's tracker *set* can change: tracker added/renamed/deleted, IsOn toggled (via adapter Update),
group header edited, event `StartTs` changed. It is also bumped for all groups when the revision counter cannot be
restored on service start (§8.6). The client seed carries the version; a mismatch forces a full refresh.

### 2.4 Legacy → `flytrace-node` schema mapping (already implemented in `db/migrations/0001_schema.sql`)

| Legacy | New | Notes |
|---|---|---|
| `aspnet_Users` + `aspnet_Membership` | `users(id uuid, username citext UNIQUE, email citext, password_hash, is_approved, is_locked_out, created_at, last_login_at, legacy_last_activity_at)` | `password_hash = 'flytrace1|<Password>|<PasswordFormat>|<PasswordSalt>'`, upgraded to argon2id on first login. `LastLoginDate = CreateDate` → `NULL`. Email not unique (one duplicate pair in prod). |
| `aspnet_Roles`, `aspnet_UsersInRoles` | `roles(id, name citext)`, `user_roles` | Roles `Admins`, `SpotIdReaders`. Only 3 role rows in prod (2 admins). |
| `Event` | `events(id, user_id, name, start_ts timestamptz)` | ids preserved |
| `Group` | `groups(... same columns, snake_case ...)` | ids preserved; `is_public` default **false** in new schema vs **1** in legacy: decide (legacy UI defaulted new groups to public via DB default). |
| `GroupTracker` | `group_trackers(..., tracker_type char(1) CHECK IN ('S','G','T'), foreign_id, foreign_id_as_entered, is_on)` | 'T' reserved for the test source. Unique indexes `(group_id,name)` and `(group_id,tracker_type,foreign_id)` are **not yet created**; add them (error messages depend on them). |
| `Waypoint`, `Task` | `waypoints`, `tasks` | `(event_id,name)` unique index also still missing. |
| `UserProfile` | `user_profiles(..., altitude_unit)` | same checks. |
| — | `sessions` | connect-pg-simple session store. |

---

## 3. Authentication, authorisation, accounts

### 3.1 Mechanism
- Forms authentication, cookie `.ASPXFORMSAUTH`, timeout 10080 min (7 days), login page `~/login.aspx`
  (`Tracker/Web.config`). `machineKey` is AutoGenerate (so cookies are not portable anyway).
- `Web.config` default is `<deny users="?"/>`; explicitly anonymous: `default.aspx`, `map.aspx`, `register.aspx`,
  `restorePassword.aspx`, `verification.aspx`, `unauthorizedAccess.aspx`, `help/`, `Service/` (the ASMX),
  `Scripts/`, `App_Themes`. `administration/` (and `Service/administration`, `Service/test`) require role `Admins`.
- `Global.Application_PostAcquireRequestState` resolves the forms-auth user name to `UserId` once per session via
  `aspnet_Membership_GetUserByName` and keeps it in `Session["UserId"]`; `Global.IsAuthenticated/UserId/IsAdmin/IsSpotIdReader`
  are used everywhere in code-behind. Pages like manageGroup/manageEvent re-check ownership on every request
  ("to make sure that there is no hacking").
- `login.aspx`: an already-authenticated user arriving with `ReturnUrl` is sent to `unauthorizedAccess.aspx` (i.e. 403 page).
- Membership provider settings: `minRequiredPasswordLength=4`, `maxInvalidPasswordAttempts=20`,
  `requiresUniqueEmail=true`, `passwordFormat=Hashed`, `enablePasswordRetrieval=false`, `enablePasswordReset=true`,
  `userIsOnlineTimeWindow=15`.

### 3.2 Password hashing (reimplemented in `flytrace-node/server/src/auth/password.ts`)
`SqlMembershipProvider` format 1: `Base64( SHA1( saltBytes ‖ UTF16LE(password) ) )` where `saltBytes = Base64Decode(PasswordSalt)`
(16 bytes). Compared case-insensitively in the Flytrace4 port; base64 is case-sensitive so a plain compare is fine.
Format 0 would be clear text (not present in prod), format 2 encrypted with machineKey (cannot be verified; none in prod).

### 3.3 Roles
- `Admins`: admin pages, sees unlisted groups on home page, read-only access to any group's manage page, service
  diagnostics on the home page, cannot delete/demote own account.
- `SpotIdReaders`: read-only access to any group's `manageGroup.aspx` (i.e. can see tracker IDs). Rarely used.
- `register.aspx.cs`: the **first user ever created** becomes Admin and both roles are created if missing.

### 3.4 Registration / verification / recovery (`register.aspx`, `verification.aspx`, `restorePassword.aspx`, `profile.aspx`)
- `CreateUserWizard`; `Settings.DisableCreatedUsers` (false in prod) would create the user unapproved and email
  `EmailTemplates/accountNeedVerification.txt` with `verification.aspx?ID=<userGuid>`, which sets `IsApproved=true`.
  With it false, no email is sent and the account is active immediately.
- Recovery wizard: "forgot password" by **username** → tries `GetPassword()` (always fails for hashed) then
  `ResetPassword()` and emails the new random password (`resetPassword.txt`); "forgot username" by **email** →
  `Membership.GetUserNameByEmail` and `restoreUsername.txt`. Sender = `Settings.AdminEmail` (admin@flytrace.com),
  SMTP from `Web.smtp.config`.
- Profile: change password (`ChangePassword` control), change email (requires current password, regex-validated),
  "send test email" (`testEmail.txt`), events model, owner-messages default, altitude display (none/m/ft).
- Templates use placeholders `<%UserName%>`, `<%Password%>`, `<%VerificationUrl%>`, `<%AdminEmail%>`.

---

## 4. Pages and features (owner-facing)

All pages use `Site.Master` (login box for anonymous users; breadcrumb, Help, user name, Settings, Sign out for
logged-in; footer links to Leonardo, OpenGTS beta, privacy policy, GitHub source, `InfoEmail`). Culture is fixed
`en-AU`; dates rendered as `ddd d MMM H:mm UTC` (`Resources.AgeFormat`), ages as `N d N hr N min [N s] ago`
(`LocationLib.Tools.GetAgeStr`).

### 4.1 Home page `Default.aspx`
- Anonymous (`defaultAnonymous.ascx`): marketing text (watch others' groups without registering; create groups
  after registering; mobile-friendly; made for flying sports), expandable sample-map screenshot, links to help,
  log in, register, and the public groups grid.
- Logged in (`defaultLoggedIn.ascx`): `UserGroupsGrid.ascx` (own groups: name → `manageGroup.aspx?group=`,
  public map link `map.aspx?group=`, trackers count, last update time + age (only when < 1 day), task column when
  relevant, "Create group" → `CreateTrackersGroup` then redirect to manageGroup), then either
  `UserTodayTask.ascx` (single-event mode: default event waypoints loaded? task set? buttons to edit waypoints/task,
  switch to advanced mode) or `UserEventsGrid.ascx` (multiple-events mode: list events, default marker, create event,
  switch to single mode). "Show/Hide Others' Public Groups" toggles the public list. Admins additionally see the
  service status table (`ServiceFacade.GetAdminStatBrief`: per-foreign-system "last successful request N ago",
  admin alert messages, current revision, GetCoords call count, start time, uptime).
- Public groups grid: columns Owner, Group, Pilots (count), Updated (time + age if <1 day), Views, Public map link.
  Sortable, default `NewestCoordTs DESC`. Rule: public (or admin) AND ≥2 trackers AND not mine.

### 4.2 Manage group `manageGroup.aspx?group=N` (1000 lines of code-behind; `Tracker/manageGroup.aspx(.cs)`)
Access: owner (read-write), Admin or SpotIdReader (read-only; any mutation throws "You don't have permissions").

Group header block:
- Name (unique per user → "You already have a group named 'X'"), **Public / Unlisted** radio
  (public = "ON THE HOMEPAGE: anyone can see its Public Map link (when the group contains 2 or more pilots)";
  unlisted = share the link only; admins see it anyway), **owner-defined messages** tri-state radio:
  `hide`, `show`, and (only if the user's profile default is "hide") `setForAll` = show for this group **and all
  my groups and make it my default** (`ShowUserMessagesInAllGroupsForUser` + profile flag). While
  `UserMessagesSettingIsNew` is true a red "New! Change this setting..." nag is shown; it clears when the user enables messages.
- Delete group (JS confirm from `Resources.GroupDeleteConfirmationFunc`).
- Event/task assignment: single-event mode → checkbox "show today task on this map" (`EnsureDefaultTask` +
  `AssignEventToGroup`); multiple-events mode → dropdown of own events (0 = none, negative = "create new event and assign").
- Altitude display mode of the owner is shown (HIDDEN / METERS / FEET) as information.

Trackers block:
- Grid of trackers: name (editable → `UpdateTrackerInGroup`), type badge (orange "S" / blue "G"), foreign id
  (SPOT id, or for inReach the short `<id>#<imei>` with a tooltip and a link to the Garmin URL
  (`GetInReachUrl`)), delete (`DeleteTrackerFromGroup`). Hidden trackers (`IsOn=false`) render struck-through grey.
  Sortable by name (header gets " *").
- "On/off selection mode" toggle: shows checkboxes per tracker, Select all / none, Save → updates `IsOn`,
  resets the group-def cache. Hidden trackers are **still polled** and still appear in the pilot list as "hidden";
  they are not drawn on the map unless their status is SOS/HELP (§6.3).
- Add tracker form: name + one text box for "SPOT Shared Page link or ID / inReach KML feed link" + type radio
  (SPOT / inReach). JS (`setInterval(selectTrackerType,100)`) auto-selects/disables the type radios by testing the
  input against both regexes. Server side (`formView_ItemInserting`):
  - Name trimmed. `TrackerForeignIdAsEntered` = raw input.
  - **SPOT**: regex
    `^\s*?(?:(?:(?:http|https)://)??share\.findmespot\.com/shared/faces/viewspots.jsp\?glId=)??([^\s\\/?=&#]{20,50})\s*?$`
    captures the glId (20–50 chars, e.g. `0IkTi311YC6crmpNWFBxhrqIDojfU9JO6`). If that id is not already anywhere
    in `GroupTracker` (`ForeignTrackerIdCheck`), a **synchronous live fetch** of the SPOT feed is made; `BadTrackerId`
    → rejected with "We cannot recognize the SPOT Shared Page ID you've passed. Our best guess for the Shared Page
    was <link>, but it didn't work." Stored: `TrackerType='S'`, `TrackerForeignId=<glId>`.
  - **inReach**: regex
    `^\s*?(?:(?:[^\s#?&]+\.)?garmin\.com/(?:[^\s#?&]+/)*)??(?<id>[^\s#?&/]+)(?:\?[^#]*?)?\s*?(?:#\s*?(?<imei>\d*?))?\s*?$`
    extracts `id` (feed/map name) and optional `imei` after `#`. Builds the canonical link
    `https://share.garmin.com/Feed/Share/<id>#<imei>`; if an IMEI was supplied and that exact link exists in the DB
    it is accepted without a fetch, otherwise the feed is fetched in **CountImeis mode** (§7.4) to enumerate IMEIs:
    0 IMEIs → long error with the URLs tried and a link to Garmin's KML-feed FAQ; exactly 1 → accepted (IMEI from the
    feed is appended, must match a supplied one); >1 → user must append `#<imei>` (list offered, most recent first).
    If the canonical link fails but the input contained `garmin.com/`, the raw URL is tried as-is (and a warning logged).
    Stored: `TrackerType='G'`, `TrackerForeignId = 'share.garmin.com/Feed/Share/<id>#<imei>'` (**scheme stripped**,
    always with `#imei`; all 295 prod rows have an IMEI). `AsEntered` keeps e.g. `aus.inreach.garmin.com/Feed/Share/<name>#<imei>`.
  - Duplicate errors mapped by index name (§2.1). After insert the new row is selected in the grid.
- Every mutation calls `ServiceFacade.ResetGroupsDefCache()` so the service re-reads the group on the next poll.

### 4.3 Events, waypoints, tasks (`manageEvent.aspx`, `manageWaypoints.aspx`, `jsx/manageEvent.jsx`, `Controllers/WaypointsController.cs`)
Concepts (`help/eventshelp.htm`): optional; an *event* is a competition/fly-in; it owns a waypoint list (the same
list pilots load into their varios); the event's waypoints define the *Today Task*; a group with an event assigned
shows the task on its map. **Single Task Mode** = one default event for everything; **Multiple Events Mode** = many events.

`manageEvent.aspx?event=N` (owner only; in single mode only the default event is reachable):
- Rename (unique per user), delete (confirm), "default event" checkbox (`SetEventAsDefault/NonDefault`), assign
  groups (checkbox list of own groups; saving sets `Group.EventId` and marks the event default), warning when
  waypoints exist but no group is assigned.
- Waypoints upload when none exist yet (`WaypointsLoader`, replace=true). Otherwise the **task editor** (React 15,
  built from `jsx/manageEvent.jsx` with browserify/babel into `Scripts/manageEvent.js`, which is empty in the checkout
  and must be rebuilt): rows "Start", 1..n, "Add new ->"; each row = waypoint `<select>` + radius input (digits only,
  default 400 m) + Remove; bulk controls "Clear task", "Use all waypoints sorted by name / by order added" with a
  default radius; Save → `PUT api/Waypoints/{eventId}` with `[{id, radius}]` which **deletes all task rows and
  re-inserts** with `WptOrder` 0..n.
- **Hide old points** (`OldTaskCleanUpControls`): buttons "Hide points older than now" and (collapsed) "…minus 1/2/3/5/24 hours"
  → `POST api/Waypoints/HideOldPoints/{eventId}/{hours}` sets `Event.StartTs = UTC now − hours` (bumping assigned
  groups' versions) and returns epoch ms; "Restore old points" → `POST api/Waypoints/RestoreOldPoints/{eventId}`
  sets `StartTs = NULL`. Status text explains the threshold in "ago", local and UTC. Purpose: at the start of a comp
  day hide yesterday's positions/tracks until new ones arrive.
- Page data is injected as JS arrays (`_eventWaypoints`, `_taskWaypoints`, `_startTsMilliseconds`) and **also**
  available via `GET api/Waypoints/{eventId}` (`WaypointsBundle {eventWaypoints[{id,name}], taskWaypoints[{id,radius}], startTsMilliseconds}`);
  a cookie trick `flytrace_event_cache_track_<id>` (server sets 0, page sets 1) detects a browser-cached page and then
  re-fetches via AJAX. Web API JSON is camelCase.

`manageWaypoints.aspx?event=N`:
- Grid of waypoints (name, lat, lon, alt, description) with inline edit/delete, add form, "delete all", upload with
  rule "replace existing (matched by name) / skip existing". Coordinates shown/entered in the user's `CoordFormat`
  (dropdown at top and bottom changes the profile setting): `Deg` (F5), `DegMin` (`N 33° 18.830'`), `DegMinSec`.
  Entry controls `CoordControls/Deg|DegMin|DegMinSec.ascx` prefill hemisphere from `DefHemisphereNS/EW`; after a
  successful add `SetDefHemispheres(lat, lon)` updates the defaults.
- `Tools/WaypointsLoader.cs` parsers:
  - **GPX**: `<wpt lat lon><name><desc><ele>`; name falls back to desc; `ele` empty → 0; waypoints whose
    `name#desc` matches `^(CIVLID\s\d+#CIV|COMPID\s\d+#COM)` are ignored; same name twice with different values → error.
  - **KML**: `<Placemark><name><description><Point><coordinates>lon,lat,alt</coordinates>`; all of name/lat/lon/alt required.
  - **CUP** (SeeYou): CSV lines `"Title",CODE,,3318.830S,14750.088E,227.0m,1,,,,"desc"`; ≥11 fields; first line
    may be a header (parse failure of line 1 is tolerated); coords `DDMM.mmm[NS]`/`DDDMM.mmm[EW]` → decimal degrees
    with range checks; elevation suffix `m` or `f` (feet ×0.3048); `---` ends the waypoint section.
  - Merge by **name** (case-sensitive key via `SetNameKeyOnly`), replace or skip.

### 4.4 Profile `profile.aspx`
Wizards for: change password; change email (password required); events model (single/multiple); owner messages
default (show/hide); altitude display (hide / metres / feet); send test email. Settings are cached per user in
`Global.UserProfiles` (process memory) and written through the `Set*` procs. Changing altitude mode resets the
service group-def cache (altitude units are part of `GroupDef`).

### 4.5 Admin pages (`Tracker/Administration/`, role Admins)
- `manageUsers.aspx`: paged, sortable user grid (username, email, created, last activity, locked, online,
  groups count, distinct trackers count), A–Z and custom `LIKE` filter, page size cookie `UsersListPageSize`,
  delete selected (not self). Links to `userInformation.aspx?user=`.
- `userInformation.aspx`: membership details, make/revoke Admin (not self), unlock.
- `currentTrackers.aspx`: live dump of the service cache: per tracker foreign id, iteration tag, current/prev point
  + age, error, access/create/refresh times, revision; sortable; plus the call-statistics DataSet tables
  (`ServiceFacade.GetAdminCallStatistics`).
- `LogConfig.aspx` + `LogConfigControl.ascx`: edit log4net config.
- `TestControl.aspx` (namespace `FlyTrace.Service.Test`): drives the TEST source (§7.5): auto-update flag,
  position number (reset / +1 / +10 / set) and `ResetTrackersCache`.

### 4.6 Help pages (`Tracker/help/`)
`commonhelp.aspx` (screenshot + marker legend: Track = letter marker, OK = "LANDED (Ok)", Custom = "LANDED (Custom)",
Help/SOS; caveat that SOS is not well tested), `usermessageshelp.aspx` (owner-defined messages), `eventshelp.htm`,
`spotidhelp.htm`. Static `privacy-policy.htm`.

---

## 5. Public API consumed by the browser

### 5.1 `Service/TrackerService.asmx` (ASMX `[ScriptService]`, namespace `http://flytrace.com/`, JSON via ScriptManager proxy `FlyTrace.Service.TrackerService.*`)

`GetCoordinates(int group, string srcSeed, DateTime scrTime) → GroupData`
`GetTracks(int group, TrackRequest trackRequest, DateTime scriptCurrTime) → List<TrackResponseItem>`
`TestCheck(string msg) → void` (client-side error/diagnostic logging into the `IncrErrors` logger)

`scrTime`/`scriptCurrTime` are only cache busters. DTOs (`Service/ServiceApiStructs.cs`):

```
GroupData {
  Trackers: CoordResponseItem[] | null   // null when empty (no trackers, or incremental "no change")
  Src: string | null                     // echo of the client seed (null on full responses)
  Res: string | null                     // next seed "<groupVersion>;<maxRevision>", or "NIL" (= nothing changed), or null (full)
  AltitudeUnits: "m" | "ft" | null       // owner's profile setting; null = don't show altitude
  StartTs: DateTime | null               // event StartTs (hide-older-than), sent only on full responses
  Ver: int                               // Settings.Version (18): client reloads the page when it changes
  IncrSurr: bool                         // debug mode flag (see §8.4)
  CallId: long
}
CoordResponseItem (serialised as "Tracker") {
  Name, Lat, Lon (omitted when 0 = no coordinates), Alt: int?, 
  Type: null | "wait" | "" | "TRACK" | "OK" | "TEST" | "CUSTOM" | "SOS" | <anything else>,
  UsrMsg: string | null, Ts (UTC, omitted when no coords), Age: seconds (server-computed),
  Error: string | null, PrevLat, PrevLon, PrevTs, PrevAge (omitted when no previous point or it is older than StartTs),
  IsHidden: bool (omitted when false), IncrTest: bool, IsOfficial (obsolete), DebugLines (debug only)
}
TrackRequest { Items: [{ TrackerName, LaterThan?: DateTime }] }   // ≤ 10 items, names case-insensitive
TrackResponseItem { TrackerName, Track: [{ Lat, Lon, Ts, Age, Type (only on the newest point) }] }  // newest first
```
The ASMX JSON serialiser emits dates as `"\/Date(ms)\/"` which the MS AJAX proxy turns into JS `Date`s; `main.js`
relies on `Ts`, `PrevTs`, `StartTs`, `LaterThan` being `Date`. Fields with `ShouldSerializeX()` returning false are omitted
and `main.js` defaults `Lat/Lon` to 0 and `IsHidden` to false when `undefined`.

### 5.2 Web API 2 (`Controllers/WaypointsController.cs`, camelCase JSON, authenticated)
- `GET api/Waypoints/{eventId}` → `WaypointsBundle`
- `PUT api/Waypoints/{eventId}` body `[{id, radius}]` → replaces the task
- `POST api/Waypoints/HideOldPoints/{eventId}/{hours}` → epoch ms of the new threshold
- `POST api/Waypoints/RestoreOldPoints/{eventId}`
**Note:** the controller does not check that the event belongs to the current user (**verify**: `WebApiConfig` may add an auth filter; none seen).

### 5.3 Data export endpoint used for the migration
`https://spot.flytrace.com/Tracker/migration.aspx?appKey=<FLYTRACE_DUMP_API_KEY>&table=<TableName>` returns a CSV of
the table (`Flytrace4/flytrace1-migration/dump-all-tables.sh`; now `flytrace-node/db/legacy/dump-all-tables.sh`).
`migration.aspx` is **not** in the local legacy checkout; it exists only in the deployed site (**verify** before relying on it).

---

## 6. The map page and client (`map.aspx`, `Scripts/main.js` v81, `labelMapControl.js`, `buttonMapControl.js`, `date.format.js`, jQuery 1.11.3)

### 6.1 Server side (`map.aspx(.cs)`)
- `?group=N`; `N=1` is the built-in demo/test group and skips the DB. Otherwise loads the group (404 → redirect to
  default.aspx), sets title "<GroupName> - Multi Tracker View", `UpdateGroupViewsNum`, injects JS globals:
  `_groupId`, `_shouldLog` (from `?log=true`), `_task` (array `[name, lat, lon, radius, ...]` of the assigned event's
  task, 4 elements per waypoint, or `null`), `_mapCenterLat/_mapCenterLon` from `NewestLat/Lon` (**unused by main.js**),
  `_logoSource/_smallLogoSource` (an advertiser logo shown bottom-right only for groups owned by user
  `4CC933D2-5974-4593-9C1C-6027839456FF` and only if `add/logo1.png` exists; link to advridermag.com.au),
  `_mapId` (appSettings `mapId`), hidden-field client IDs for reload lat/lon/zoom.
- Google Maps JS loaded with `key=<mapsApiKey>&libraries=marker` (AdvancedMarkerElement). Google Analytics `G-BE4R8T8DDL`.
- Layout: header with `#sosList`, `#helpList` (unused placeholders), status bar (`#statusLabel`, `#errorLabel`,
  `#horSplitter` turns green when OK); `#mapPanel`; `#listPanel` (pilot list) toggled with "Show Pilot List / Show Map":
  coordinate-format select (`deg` / `degmin` (default) / `degminsec`), "same map with this format pre-selected" link,
  table Tracker / Status / Coordinates / Time / Status Age (+ hidden error cell), Show/Hide All Tracks, and a hidden
  log div with "Send log to site admin" (`TestCheck`).
- Query params: `group`, `log`, `useautoupdate=0|false` (disables the 30 s timer), `defcoordformat=deg|degmin|degminsec`.

### 6.2 Boot (`initialize()`)
Map options: zoom/center from the hidden reload fields if present (set before a `Ver`-triggered postback reload),
else default `(-33.361073, 147.9303)` zoom 12 (NSW, Australia), roadmap, scale control, no street view.
Buttons (custom `buttonMapControl`): "Update Now", "Show Pilot List" (TOP_LEFT), "Show tracks", "Fit All Pilots",
later "My Position" (LEFT_TOP). Coordinate format from `?defcoordformat` else cookie `flytrace_coord_format`.
`setInterval(clock, 1000)`. Geolocation `watchPosition` draws a blue accuracy circle + `current_position.png` marker.
`showTask()` draws the task. Tracks are **disabled for hard-coded groups** 132, 138–143 (`_tracksEnabled=false`).

### 6.3 Polling loop and status
- `clock()` runs every second: computes seconds since last call; when `≥ _requiredSecondsBetweenCalls` (30) and not
  already on a call and auto-update enabled → `onLookup()` = `GetCoordinates(_groupId, _currentSeed, now)`.
  Status text: "Positions refreshed N ago." / ", there are no pilots assigned to the group." / ", no coordinates
  received yet for pilots in the group." / "Positions haven't been retrieved yet, N sec before the next attempt
  (or press 'Update Now')." Errors: "Failed to connect N ago, try to fix it by 'Update Now' or wait for auto-update
  that should happen in N sec". Also refreshes all ages (`checkTrackers`), shows queued alerts, and does the
  one-time auto-fit (fit all trackers with coordinates, else fit the task).
- `onLookupComplete(result)`:
  1. If `result.Ver` differs from the last seen → store center/zoom in hidden fields and `__doPostBack` (full page reload
     to pick up new scripts).
  2. `isIncremental = result.Src != null && != ""`. Process only if `Res != "NIL"` and (`!isIncremental` or
     `Src == _currentSeed`) (an incremental answer for a stale seed is ignored). In debug mode (`IncrSurr`) the full
     list is processed anyway and `Res == "NIL"` is treated as incremental.
  3. `processResult`: for each tracker: `Lat/Lon` default 0, `IsHidden` default false; find holder by **Name**
     (names are the client-side key); ignore `"wait"` for a tracker that already has data; new holder → create
     row in the list table, assign a track colour from `['#CC0099','#382512','#0000CC','#FF6600','#006600']` by index,
     create marker if displayable; existing → hide marker if no longer displayable, else `updateMarkerPosition`
     (moves marker + label, bounces for 10 s via CSS class `marker-bounce`, swaps icon if type changed). If a full
     track is cached and a newer point arrived: prepend it; if `PrevTs == track[0].Ts` the track is simply extended,
     otherwise also insert the prev point and mark `needGetTrack` (gap). `removeOldPoints` trims to 12 h behind the
     newest point. `syncTrackLine`. On full (or debug) responses, trackers missing from the response are removed from
     map and table. Debug anomalies (new tracker in incremental, wrong timestamps, etc.) are sent to the server via
     `TestCheck`. Then `_currentSeed = Res` unless `NIL` (keep) or null (reset).
  4. `checkFullTracks(false)`, `syncAllTracksButton()`.
- Type helpers (the whole visual semantics of a position):
  - `isWaitType`: `Type === "wait"` (registered, not fetched yet) → table status "Waiting for the data...".
  - `Type == null` → "None" (no data, e.g. error only).
  - `isTrackType`: `""` or `"TRACK"` → icon `named-markers/marker<FirstLetterOfName>.png` (A–Z) else `red-dot.png`; status "ON TRACK".
  - `isOkType`: `"OK"` or `"TEST"` → `finish.png`; status "LANDED (Ok)" or "OK" when a user message is present.
  - `isCustomType`: `"CUSTOM"` → `finish-custom.png`; "LANDED (custom)" / "CUSTOM".
  - anything else (inReach `"SOS"`, SPOT `"HELP"`, ...) → **SOS**: `redarrow.png`, status = raw type, info icon `help.png`.
  - `isMarkerDisplayble` = has coordinates AND (is SOS OR not `IsHidden`) — SOS always shows, even for hidden trackers / old points.
- Info window (click marker): icon, "D Mon H:MM (age ago)", **Name: STATUS** (link zooms to 17), user message in
  quotes, coordinates in the selected format with "Copy coords" (uses `window.prompt`), error text, "Show/Hide full
  track" (or "Getting full track... (cancel)"), "Google map" link to `maps.google.com.au/maps?q=lat,lon`.
- Marker label (`LabelMapControl`, custom overlay): line 1 `Name: age ago`; line 2 altitude only for TRACK type and
  when `AltitudeUnits` is set: `m` → `alt X.X km` (rounded to 0.1 km); `ft` → `alt N,N00 ft` (×3.28084, rounded to 100).
- Pilot list rows: name (+ "– hidden" grey for `IsHidden`), status (+ ": "message"), coordinates, time (`dateFormat(Ts)`)
  + track link, age, error. Sorted by name.
- Coordinate formats (`getDegrees`): `deg` → `lat<br/>lon` raw; `degmin` → `N 33°18.830′`; `degminsec` → `N 33°18′49.8"`.
  Changing the select stores cookie (120 days) and updates the "pre-selected format" link.

### 6.4 Previous-point line and full tracks
- `fixLineToPrev`: a green 2 px polyline from current to previous point when `PrevLat != 0` and `PrevTs ≥ StartTs`
  and the marker is displayable; identical points get a 0.000003° nudge so the leg is visible; removed when the
  full track is shown.
- Full track per tracker: `showTrack(name)` sets `shouldDisplayTrack`, `needGetTrack` (unless cached track's newest
  point == current point), `isFirstPriority`. `checkFullTracks(firstPriorityOnly)` batches up to **10** tracker names
  (oldest request first) into one `GetTracks` call, at most one call per 30 s, with `LaterThan = latestReceivedTs`
  for incremental track fetches. `onGetTracksComplete` merges: replaces the overlapping newer part
  (`removeNewTrackPoints`), concatenates, trims to 12 h, reconciles with the marker (track newer than marker →
  synthesise a tracker update; track older → leave `needGetTrack` so it retries). Polyline: tracker colour,
  opacity 0.5, weight 4, points older than `StartTs` excluded. "Show tracks" button toggles all; a one-time alert
  explains individual toggling (cookie `numAllTracksAlertShown`).

### 6.5 Task drawing (`showTask`)
Requires ≥2 task waypoints. Each: green circle (`#008800`, 1 px, fill 5%) of `radius` metres, red label `"<i>: <name>"`;
all centres joined by a red polyline (`#FF0000`, opacity 0.8, 2 px). Used by `tryFitTask()` when no tracker has coordinates.

### 6.6 "StartTs" (hide old points) on the client
Received only on full responses. Server already sets `IsHidden` for points older than `StartTs` and omits `Prev*`
older than it; the client additionally cuts track polylines and the prev-leg at `StartTs`, and a change of `StartTs`
forces full polyline redraws (`trackPointsToAdd = -1`).

### 6.7 Error handling and logging
All handlers wrap in try/catch → `showError`, `console.error`, sometimes `alert`. With `?log=true` a log div collects
messages and "Send log to site admin" / automatic sends (10 s and 30 s after pressing "Show tracks") post it via `TestCheck`.

---

## 7. LocationLib: talking to SPOT and Garmin

### 7.1 Data model (`LocationLib/Data/*`, `TrackerState.cs`, `ForeignId.cs`)
- `ForeignId { Type: "SPOT" | "InReach" | "TEST", Id }` — dictionary key of the tracker cache. DB `S`→`SPOT`, `G`→`InReach` (`GroupFacade`).
- `TrackPointData { Id, LocationType, Latitude, Longitude, Altitude: int?, ForeignTime (UTC), UserMessage }` immutable, structural equality.
- `Position { FullTrack: TrackPointData[] (newest first, ≥1), CurrPoint = [0], PreviousPoint = [1] or null, Type = CurrPoint.LocationType, UserMessage }`.
- `Error { Type: ResponseHasNoData | ResponseHasBadSchema | ResponseIsTooBig | BadTrackerId | AuxError, AuxMessage }` with user-facing
  `Message`: "No coordinates found for the tracker." / "Inconsistent SPOT server response schema." / "Location data was not
  recognised for the tracker." / "The tracker ID is not recognized by the SPOT server." / "Cannot retrieve location data for the tracker: <aux>".
- `TrackerState { Position?, Error?, Iteration, CreateTime }`: at least one of Position/Error; both allowed (stale position + fresh error).
  `Utils.EqualityExpressionCheck` is a startup self-test that every field participates in equality (equality drives revision bumps).
- `TimeService.Now` = `DateTime.UtcNow` (replaceable only in tests).

### 7.2 Request pipeline (`ForeignAccess/LocationRequest.cs`, `WebFeedRequest.cs`, `XmlFeedRequest.cs`, `LocationRequestFactory.cs`)
- `LocationRequestFactory.CreateRequest(RequestParams { Id, ExistingState })` → `LocationRequest`. `ExistingState` is
  the tracker's current snapshot so the request can avoid re-fetching old pages.
- `LocationRequest.BeginReadLocation`: iteration 0 `FeedRequest`; on completion `MergeWithExistingData(result, out needContinue)`;
  if `needContinue` start the next iteration (SPOT: next page; inReach: second request with `d1`); abort flag honoured.
  `ReadLocation()` is the synchronous wrapper used by manageGroup validation.
- `WebFeedRequest`: `HttpWebRequest` async, reads the body in 512-byte chunks into a `MemoryStream` until EOF, then
  `AnalyzeCurrentBuffer()`: `XmlReader` over the buffer, `ParseNextMessage` repeatedly; stops at a point older than
  **48 h** (`FullTrackPointAgeToIgnoreInHours`) relative to the newest one (the newest is always kept regardless of age);
  result distinct-by-time, ordered newest first. HTTP 404 → `BadTrackerId`; empty body → `BadTrackerId`; XML error →
  AuxError with the parser message; no `<message>` tags → `ResponseHasNoData`; tags but no parsable point → `ResponseHasBadSchema`.
  Timeout = `max(20 s, DefaultEndWaitTimeout − 5 s)` = 55 s. `Accept: text/html,application/xhtml+xml,application/xml`
  (needed, otherwise SPOT returns JSON).
- `SanitiseFreshPointsOverOlderTrack` (used by inReach): drops fresh points whose `Id` matches an old point but whose
  time changed (Garmin sometimes shifts timestamps); reports once per feed.
- Error accounting: `ConsequentErrorsCounter` with three `ThresholdCounter`s (request errors threshold 5, timeouts 1,
  unexpected foreign errors 5): below threshold failures are logged Info, at/above Error (feeds SMTP alerts).
  `ResponseHasNoData`/`BadTrackerId` are neutral. **One counter instance is shared by SPOT and inReach.**
- `WeirdThingsReporter`: persists reported ids to `App_Data/<file>.txt` (`inreach-feeds-with-reused-timestamps.txt`,
  `inreach-many-points-in-first-request.txt`) so each anomaly is logged as Warn once per 7 days (or once ever), then Info.

### 7.3 SPOT (`ForeignAccess/Spot/*`)
- URL: `https://api.findmespot.com/spot-main-web/consumer/rest-api/2.0/public/feed/{glId}/message.xml`; page n>0:
  `...message.xml?start={n*50+1}` (50 messages per page).
- Parsing per `<message>`: `id`, `messageType`, `latitude`, `longitude`, `altitude` (double → int; `0` → null; `<0` → 0),
  `dateTime` (`2013-01-10T11:03:36+0000` → colon inserted in the zone → `XmlConvert`) or `unixTime` (POSIX seconds) —
  whichever comes first, `messageContent` (user message; blank → null). Type normalisation: `TEST|STOP|HELP-CANCEL → OK`;
  `EXTREME-TRACK|UNLIMITED-TRACK|NEWMOVEMENT|POI → TRACK`; everything else passed through (`TRACK`, `OK`, `CUSTOM`,
  `HELP`, `SOS`...; the client shows unknowns as SOS).
- `<error><text>`: contains "No Messages to display" → no data (normal); "Feed Not Found" / "Feed Currently Not Active" /
  "Feed Password required" → `BadTrackerId`; anything else → logged, treated as no data.
- Paging logic (`SpotLocationRequest.MergeWithExistingData`): merge pages (union, newest first, distinct). Continue to
  the next page only if: this page had exactly 50 points, the merged span is < 48 h, iteration < 5, and either there is
  no existing track or the oldest fetched point is still newer than the newest existing point (i.e. a gap). Otherwise
  union with the existing track. Final track trimmed to 48 h behind the newest point.

### 7.4 Garmin inReach (`ForeignAccess/InReach/*`)
- Id = a MapShare/KML feed URL without scheme, `host/Feed/Share/<name>#<imei>`. `CreateUriBuilder` forces `https`;
  the `#imei` fragment is removed from the URL and sent as `?imei=<imei>`. Query strings in the stored id are rejected.
- Request URL: `BaseFeedUrl[?d1=yyyy-MM-ddTHH:mm:ssz][&imei=...]`. `d1` = oldest point of the previous iteration or
  existing track **minus (48 h / 24 + 2) = 4 days**, to be safe against Garmin timezone quirks.
- Two-step strategy (`InReachLocationRequest.MergeWithExistingData`): iteration 0 is sent **without `d1`** and
  normally returns only the latest point. If its `Id` equals the existing track's newest point id → nothing new,
  return the existing track (clearing any old error). Otherwise iteration 1 with `d1` fetches the recent history,
  which is sanitised, unioned with the existing track, trimmed to 48 h behind the newest existing point. An error on
  iteration ≥1 after a successful iteration keeps the previous iteration's track and attaches the error. If iteration 0
  unexpectedly returns many points spanning > 48 h, that result is used as is (reported once).
- KML parsing (`InReachFeedRequest.ParseNextMessage`): per `<Placemark>`: `<TimeStamp><when>` (→ UTC; **duplicate
  timestamps get +1 s each**, reported), `<Point><coordinates>lon,lat[,alt]</coordinates>`, `<ExtendedData><Data name=...><value>`
  for `IMEI`, `In Emergency` (`true` → type `SOS`), `Text` (user message → type `OK` when non-blank, else `TRACK`), `Id`.
  A placemark is accepted once lat/lon/time are present (other fields may be missing at `</Placemark>`).
- IMEI handling: `SingleImei` mode filters to the configured IMEI (points of other IMEIs are skipped and
  `PointsForOtherImeiFound` set); if no IMEI configured and the feed contains two different IMEIs → `InvalidDataException`
  "The feed contains more than one IMEI... Specify IMEI in the feed URL after the hash sign '#'". `CountImeis` mode
  (used only by manageGroup validation) collects `ImeiTimes {imei → newest time}` and returns no points.
- Factory parameters: shares SPOT's pack settings but `SameFeedHitInterval` = 30 s (SPOT 150 s).

### 7.5 TEST source (`LocationLib/TestSource.cs`, `ForeignAccess/Test/*`, `App_Data/test/`)
Group **1** is a synthetic group: one tracker per `App_Data/test/<Name>.xml` (shipped: `Anna`, `Maria`; files starting
with `_` are excluded; `_empty.xml` is a SPOT "No Messages to display" response). Tracker ids are
`FlyTraceTestId_<Name>`, type TEST, `ShowUserMessages=true`, altitude `ft`. `TestSource.PositionNumber` (admin
`TestControl.aspx`) controls how many messages from the files are revealed, round-robin across sources, so an admin can
replay a flight step by step. Useful to port as a dev fixture mechanism.

---

## 8. The coordinates service (`Service/`)

### 8.1 Lifecycle (`ServiceFacade`, `ForeignRequestsManager`)
`Global.Application_Start` → `ServiceFacade.Init(App_Data path)`: initialises `TestSource`, `ForeignAccessCentral`
(factories SPOT/InReach/TEST + shared error counters), sets `AsyncResultNoResult.DefaultEndWaitTimeout = 60000`,
creates the singleton `ForeignRequestsManager`: restores the revision counter from `App_Data/revision.bin`, creates the
`Scheduler`, starts background thread **LocWorker**. `Deinit` on app end. A WinForms message pump thread
(`Tools/SystemEventsHiddenForm`) listens for **system time changes** and calls `ResetTrackersCache()` (all tracker
state dropped) because all scheduling is wall-clock based; on failure it unloads the app domain after 60 s.
Every 30 min buffered log4net appenders (SMTP) are flushed.

### 8.2 Group definitions (`GroupFacade`)
`GroupDef { TrackerDefs: [{Name, IsOn, ForeignId}], VersionInDb, ShowUserMessages, StartTs (UTC), AltitudeUnits }`
from `GetGroupTrackerIds` (async ADO.NET), cached per group id in a static dictionary (`GroupDefCacheEnabled`),
invalidated **only** by `ServiceFacade.ResetGroupsDefCache()` which the web pages call after any mutation (whole cache
cleared). Unknown `TrackerType` rows are skipped with an error log. Group 1 → test group.

### 8.3 Tracker cache and polling (`Scheduler`, `TrackerStateHolder`, `RevisedTrackerState`)
- `Trackers: Dictionary<ForeignId, TrackerStateHolder>` guarded by a `ReaderWriterLockSlimEx` (1 s acquisition
  timeout → logged error). `TrackerStateHolder { ForeignId, Snapshot: RevisedTrackerState (immutable, swapped
  atomically), CurrentRequest, AddedTime, ScheduledTime, RequestStartTime, RefreshTime, ThreadDesynchronizedAccessTimestamp }`.
- Trackers enter the cache **lazily**: when a client asks for a group whose trackers are not all cached,
  `TrackerServiceBase.GetSnapshots` returns `null` snapshots for them (→ `Type:"wait"`) and queues
  `AddMissingTrackers` on the thread pool; the worker is woken. Trackers not read by any client for
  `TrackerLifetimeWithoutAccess` = **20 min** are "boring" and removed (polling stops). Thus only watched groups are polled.
- Scheduler loop (`ScheduleCleanupWait`), per foreign type: count in-flight calls; find the **most stale** tracker
  (no `RefreshTime` beats any refreshed; then earliest `RefreshTime`; trackers with `ScheduledTime` set but not started
  are deprioritised; ties by `AddedTime`); compute wait = max of `PrevStartTime + MinTimeFromPrevStart`,
  (`PrevEndTime + MinCallsGap` if `MaxCallsInPack == 1`), `tracker.RequestStartTime + SameFeedHitInterval`; if in-flight
  ≥ `MaxCallsInPack` wait indefinitely (woken when a call ends). Sleep at most 3 s, or until woken (new trackers,
  request finished, cache cleared). Then start requests for all trackers sharing the minimum wait (±50 ms).
  Parameter sanity limits: `MaxCallsInPack` 1..20, intervals ≤ 60 s / 60 s / 1800 s.
- Defaults (`LocationLib/Properties/Settings.settings`): SPOT `MaxCallsInPack=10`, `MinTimeFromPrevStart=2000 ms`,
  `MinCallsGap=0`, `SameFeedHitInterval=150 s`; inReach same pack limits, `SameFeedHitInterval=30 s`. Effective
  behaviour with the defaults: at most 10 concurrent requests per system, a new request at most every 2 s, each SPOT
  feed polled at most every 150 s, each inReach feed every 30 s.
- Timeouts: a request older than 60 s is considered timed out → `CurrentRequest` cleared, `SafelyAbortRequest` on the
  thread pool (aborts hanging for > 5 min are logged), statistics `TimedOut`/`Error` events, factory `RequestFinished(timedOut=true)`.
- Request completion (`OnEndReadLocation`): ignore if no longer the current request; `RevisedTrackerState.Merge(old, new, nextRevision)`:
  keeps the newer `Position` by `CurrPoint.ForeignTime` (old wins ties? no: equal → new), takes the **new** `Error`
  (null clears an old error), returns the *old instance* when both Position and Error are structurally equal → no
  revision consumed; otherwise a new snapshot with `DataRevision = ++revision` and `UpdatedPart = BrandNew|NewPos|NewErr`.
  `RefreshTime` set; a "full round trip" (no error or non-Aux error) counts as success in statistics.
- `Statistics` (`RequestsSchedule/Statistics.cs`, `StatQueue`, `StatTimer`): rolling counters of request start/end/error/timeout
  and call-pack sizes per foreign type, reported as a DataSet on `currentTrackers.aspx`. Not needed functionally.

### 8.4 `GetCoordinates` and the incremental-update protocol (`Subservices/CoordinatesService.cs`)
Per call: get `GroupDef` → snapshots (under read lock, atomically) → build response.

- Seed = `"<VersionInDb>;<maxDataRevisionReturned>"`. `TryParseThresholdRevision`: null (full) unless the seed has
  two non-negative ints and the first equals the current `VersionInDb`.
- A tracker is included if: snapshot is null (→ `"wait"`), or its `DataRevision` is null (emergency mode), or no
  threshold (full), or `DataRevision > threshold`. `nextThresholdRevision = max(DataRevision)` over **all** trackers.
- Full response (`isFullGroup` = `IsAlwaysFullGroup` or any null snapshot): `Res = Src = null`, `StartTs` included.
  Incremental: `Res = "<version>;<next>"`, `Src = clientSeed`; if nothing changed (`incrLogicIncludeCount == 0` or
  `Src == Res`) → `Src = null`, `Res = "NIL"`, `Trackers = null`. Inconsistent "no change" state → logged Fatal,
  `AdminAlerts["Incremental Logic Error"]`, `IsAlwaysFullGroup = true` for the process lifetime (fail-safe), exception to client.
- `TrackerFromTrackerSnapshot`: `IsHidden = !IsOn`; `Type="wait"` if no snapshot; else Lat/Lon/Type/Ts/Age from
  `CurrPoint`, `Alt` only if the group has `AltitudeUnits`, `UsrMsg` only if `ShowUserMessages`, `Prev*` only if the
  previous point is newer than `StartTs`, `IsHidden = true` if `CurrPoint.ForeignTime < StartTs`, `Error = Error.Message`.
  (Debug: if `c:\temp\debuglines.txt` exists its lines are attached.)
- **Debug/"surrogate" mode**: `IncrDebugRatio` (default **1.0** in `Service/Properties/Settings.settings`) makes
  `isDebugFullGroup` true for that fraction of calls: all trackers are returned with `IncrTest` = whether normal logic
  would have included them, and `IncrSurr = true`, so the client can self-check the incremental logic and report
  anomalies via `TestCheck`. With the default 1.0 the bandwidth saving is effectively **off** in production unless
  `Web.Service.dll.config` overrides it (**verify** on the server). `AllowIncrementalUpdates=false` forces full mode.
- Side effect per call (thread pool, async SQL): `Group.PageUpdatesNum += 1` and, if any returned tracker has
  coordinates, `NewestCoordTs/NewestLat/NewestLon` = the newest returned point. `AdminAlerts.CoordAccessCount++`.
- Call timeout 60 s → Fatal log, default (empty) `GroupData`.

### 8.5 `GetTracks` (`Subservices/TracksService.cs`)
≤10 names (else exception "Number of requested full tracks can't exceed 10"), matched case-insensitively against the
group's tracker names; for each snapshot with a Position returns `FullTrack` points newer than `LaterThan` (if given),
`Type` set only on the newest point, `Age` computed server-side; empty tracks omitted. No incremental seed; the
48 h server-side trim and the 12 h client-side trim apply.

### 8.6 Revision persistence (`RevisionPersister`)
Monotonic int persisted to `App_Data/revision.bin` every 100 increments; on start the stored value is rounded **up**
to the next multiple of 100 so revisions never repeat after a crash. If the file is missing/unparsable the counter
restarts from 0 **and every `Group.Version` is incremented** so all client seeds become invalid. If that fails too →
`IsAlwaysFullGroup`. Alerts are visible on the admin home panel (`Revgen initialised at`, warnings, errors).

---

## 9. Configuration (all values as shipped)

`Tracker/Web.config` + `local.config` (appSettings, assume-unchanged in git): `log_folder` (`.\logs`), `mapsApiKey`,
`mapId` (`DEMO_MAP_ID`), `LogConfig`=`log4net.config`. `Web.connectionStrings.config`: `TrackerConnectionString`.
`Web.smtp.config`: SMTP host/credentials (placeholders in git). `applicationSettings`:

| Setting | Default | Used for |
|---|---|---|
| `FlyTrace.Properties.Settings.AdminEmail` | admin@flytrace.com | sender of system emails |
| `InfoEmail` | info@flytrace.com | contact link, error messages |
| `DisableCreatedUsers` | False | email verification on registration |
| `LocationLib: SPOT_MaxCallsInPack` | 10 | scheduler |
| `SPOT_MinTimeFromPrevStart_Ms` | 2000 | scheduler |
| `SPOT_MinCallsGap_Ms` | 0 | scheduler (only when pack=1) |
| `SPOT_SameFeedHitInterval_Seconds` | 150 | min interval per SPOT feed |
| `InReachSPOT_SameFeedHitInterval_Seconds` | 30 | min interval per inReach feed |
| `SPOT_RequestUrlTemplate[WithPage]` | api.findmespot.com … `message.xml[?start={1}]` | |
| `Service: Version` | 18 | `GroupData.Ver`; bump to force clients to reload |
| `AllowIncrementalUpdates` | True | |
| `IncrDebugRatio` | 1 | fraction of calls answered in debug-full mode (see §8.4) |
| `GroupDefCacheEnabled` | True | |
| `TrackerLifetimeWithoutAccess` | 20 (min) | drop unwatched trackers |
| `SpotConsequentRequestsErrorCountThresold` / `TimedOut...` / `UnexpectedForeignErrors...` | 5 / 1 / 5 | log-level escalation |
| `AdminTimezone` | AUS Eastern Standard Time | log timestamps for the admin |
| `AvgAllowedMsBetweenCalls`, `RefreshChunk`, `IsNewScheduler` | 1800, 10, True | appear unused (**verify**) |

Logging: log4net (`Tracker/log4net.config`): rolling file, errors file, `SmtpAppender` (WARN+, buffered; flushed every
30 min) → this is how the admin gets alerted. Logger names worth keeping as concepts: `TDM` (service), `TDM.IncrUpd`,
`TDM.Sched`, `TDM.LocReq`, `TDM.LocReq.ErrorHandling`, `IncrErrors` (client reports), `InfoLog`, `RevGen`, `TimeChange`,
`TimedOutAborts`, `GrpFcde`, per-group `TDM.<groupId>`.

Deployment: IIS, `Site update scripts/*.ps1|cmd` zip the site and apply updates; `App_Data` holds `revision.bin`,
`test/`, weird-things reports, logs. The build step `ApplicationSettingsExtract.targets` generates
`Web.LocationLib.dll.config` and `Web.Service.dll.config` from the `Settings.settings` files.

---

## 10. Quirks, hard-coded things and known bugs (do not port blindly)

- `SetEventAsNonDefault` clears **all users'** default events (missing WHERE). 
- Tracks disabled for groups 132, 138–143 (hard-coded in `main.js`).
- Advertiser logo for owner GUID `4CC933D2-…` (`map.aspx`).
- `_mapCenterLat/_mapCenterLon` are emitted but never used; initial view is the Australian default until the first auto-fit.
- `IncrDebugRatio = 1` likely leaves the incremental protocol in self-test mode (full payloads every time).
- `WaypointsController` has no ownership check (**verify**).
- `requiresUniqueEmail=true` yet production data contains one duplicated email (pre-dates the setting).
- `Group.IsPublic` defaults to 1 in the DB; new groups are public unless changed.
- Hidden (`IsOn=false`) trackers are still polled and still listed; only the marker is suppressed (except SOS).
- Both foreign systems share one `ConsequentErrorsCounter`; a SPOT outage silences inReach error escalation and vice versa.
- `Scripts/manageEvent.js` is not built in the checkout (0 bytes); the React task editor source is `jsx/manageEvent.jsx`.
- Old-browser code paths (`_ie8_or_less`) and `escape/unescape` in cookies.
- `GetCoordinates` writes stats to the DB on every poll of every client (`PageUpdatesNum`, `Newest*`) — a write per 30 s per viewer.
- `copyToClipboard` uses `window.prompt`.
- Timezone handling relies on the server clock being UTC-correct; a clock change wipes the cache.
- The whole service is **single-process, in-memory** (group-def cache, tracker cache, revision counter). Any multi-instance
  deployment of the rewrite needs a shared store or sticky single worker for the poller.

---

## 11. Where the migration stands (this repo) and what remains

### 11.1 Done (milestone 1, Oct 2026)
- `db/migrations/0001_schema.sql`: clean snake_case schema (§2.4). `db/migrate.ts`, `db/reset.ts` (dev only, `_dev` guard).
- `db/legacy/`: CSV dump import (`staging.sql` → `transform.sql` → `verify.sql`, one transaction, counts verified;
  `README.md` documents the CSV contract). Production dump `20251101_181031` imported locally: 1375 users (zawad20
  excluded), 1300 groups, 3386 trackers, 1110 events, 1258 profiles, 10393 waypoints, 2139 task rows.
- `server/src/auth/`: legacy SHA1 hash verification + argon2id upgrade, Postgres-backed sessions (7-day rolling,
  cookie `flytrace.sid`), `requireLogin` / `requireRole('Admins')`, login rate limit, `POST /api/login|logout`, `GET /api/me`.
- Bare server-rendered pages `/`, `/login`, `/groups` (own groups), `/admin` (users + roles), `/403`. Tests in `server/test/`.
- Dev CLI `npm run user:create -- <name> <password> [role]`.

### 11.2 Not yet done, in a sensible order
1. **Schema gaps**: unique indexes `(user_id,name)` on groups/events, `(group_id,name)` and `(group_id,tracker_type,foreign_id)`
   on group_trackers, `(event_id,name)` on waypoints; decide `is_public` default; `version` semantics (§2.3) must be
   implemented in every write path (trigger or application code).
2. **Feed clients** (port of §7): SPOT XML (paging, type normalisation, error texts), inReach KML (two-step, IMEI,
   duplicate timestamps, `d1`), 48 h trim, structural equality. Reuse the fixtures in `flytrace/LocationLib.Test/`
   (`BasicRequest.xml`, `Combinations.xml`, `InReach/*.kml`) as test inputs.
3. **Poller / tracker cache** (§8.3): lazy registration on demand, per-system pack/interval limits, staleness ordering,
   20-min eviction, timeouts, revision counter (persist in Postgres instead of `revision.bin`), merge semantics.
   Single worker process; expose state for an admin page.
4. **Coordinates API** (§5.1, §8.4, §8.5): `GET /api/groups/:id/coordinates?seed=` and `POST /api/groups/:id/tracks`
   (JSON, ISO dates); keep seed semantics (`version;revision`, `NIL`), `StartTs`, `Alt`/`UsrMsg` gating, `IsHidden`, `wait`.
   Consider dropping the debug-surrogate mode or making it opt-in. Keep the `Ver` reload hook or replace with asset hashing.
5. **Map page** (§6): port `main.js` behaviour (status bar, pilot list, marker types/icons from `Tracker/App_Themes/Default/`,
   labels, prev-leg, tracks with 10-per-call batching, task drawing, StartTs cut, geolocation, coord formats, cookies,
   query params). Keep numeric group ids and the `/tracker/map.aspx?group=N` redirect (nginx) in mind. Google Maps key/mapId from env.
6. **Group management** (§4.2) incl. the SPOT/inReach id validation flows (regexes + live validation + IMEI counting),
   on/off, public/unlisted, messages tri-state, event assignment, cache invalidation → version bump.
7. **Home page lists** (§4.1): public groups rule (≥2 trackers, not mine, admins see all), own groups with task info,
   last-update ages; stats updates (`views_num`, `page_updates_num`, `newest_*`).
8. **Events / waypoints / tasks** (§4.3): uploads (GPX/KML/CUP parsers), task editor, hide/restore old points.
9. **Profile** (§4.4), **registration / recovery emails** (§3.4; use password reset links instead of emailing passwords),
   **admin pages** (§4.5), **help pages**, TEST source / demo group 1 as a dev fixture.
10. Ops: logging with alerting equivalent to the SMTP appender, deployment, nginx redirects for old `.aspx` URLs.

### 11.3 Behaviours worth preserving verbatim (users depend on them)
- Share links `?group=N` with the same ids; public listing only for ≥2 trackers.
- 30 s client refresh, "Update Now", pilot list, coordinate formats, "Fit All Pilots", per-tracker and all-tracks toggles.
- Marker semantics: letter markers for TRACK, finish flags for OK/CUSTOM, red arrow for anything else; SOS always visible.
- Owner-defined messages opt-in per group; altitude display per owner; hidden trackers; hide-old-points for comps.
- inReach ids with `#imei`; SPOT ids as the 20–50 char glId; tolerant pasting of full share URLs.
