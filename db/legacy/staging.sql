-- Staging tables mirroring the CSV dump of the original MSSQL database (one per CSV file).
-- Column order matches the CSV headers exactly; \COPY ... CSV HEADER relies on that.
-- Dropped again by transform.sql once the data has been moved into the real tables.

CREATE TABLE orig_aspnet_Applications (
  ApplicationName varchar(256) NOT NULL,
  LoweredApplicationName varchar(256) NOT NULL,
  ApplicationId uuid NOT NULL,
  Description varchar(256)
);

CREATE TABLE orig_aspnet_Membership (
  ApplicationId uuid NOT NULL,
  UserId uuid NOT NULL,
  Password varchar(128) NOT NULL,
  PasswordFormat int NOT NULL,
  PasswordSalt varchar(128) NOT NULL,
  MobilePIN varchar(16),
  Email varchar(256),
  LoweredEmail varchar(256),
  PasswordQuestion varchar(256),
  PasswordAnswer varchar(128),
  IsApproved boolean NOT NULL,
  IsLockedOut boolean NOT NULL,
  CreateDate timestamptz NOT NULL,
  LastLoginDate timestamptz NOT NULL,
  LastPasswordChangedDate timestamptz NOT NULL,
  LastLockoutDate timestamptz NOT NULL,
  FailedPasswordAttemptCount int NOT NULL,
  FailedPasswordAttemptWindowStart timestamptz NOT NULL,
  FailedPasswordAnswerAttemptCount int NOT NULL,
  FailedPasswordAnswerAttemptWindowStart timestamptz NOT NULL,
  Comment text
);

CREATE TABLE orig_aspnet_Roles (
  ApplicationId uuid NOT NULL,
  RoleId uuid NOT NULL,
  RoleName varchar(256) NOT NULL,
  LoweredRoleName varchar(256) NOT NULL,
  Description varchar(256)
);

CREATE TABLE orig_aspnet_SchemaVersions (
  Feature varchar(128) NOT NULL,
  CompatibleSchemaVersion varchar(128) NOT NULL,
  IsCurrentVersion boolean NOT NULL
);

CREATE TABLE orig_aspnet_Users (
  ApplicationId uuid NOT NULL,
  UserId uuid NOT NULL,
  UserName varchar(256) NOT NULL,
  LoweredUserName varchar(256) NOT NULL,
  MobileAlias varchar(16),
  IsAnonymous boolean NOT NULL,
  LastActivityDate timestamptz NOT NULL
);

CREATE TABLE orig_aspnet_UsersInRoles (
  UserId uuid NOT NULL,
  RoleId uuid NOT NULL
);

CREATE TABLE orig_Event (
  Id int NOT NULL,
  UserId uuid NOT NULL,
  Name varchar(256) NOT NULL,
  StartTs timestamptz
);

CREATE TABLE orig_Group (
  Id int NOT NULL,
  Name varchar(256) NOT NULL,
  UserId uuid NOT NULL,
  EventId int,
  NewestCoordTs timestamptz,
  NewestLat double precision,
  NewestLon double precision,
  ViewsNum int NOT NULL,
  PageUpdatesNum bigint NOT NULL,
  IsPublic boolean NOT NULL,
  Version int NOT NULL,
  DisplayUserMessages boolean NOT NULL
);

CREATE TABLE orig_GroupTracker (
  Id int NOT NULL,
  GroupId int NOT NULL,
  Name varchar(50) NOT NULL,
  TrackerType char(1) NOT NULL,
  TrackerForeignId varchar(445) NOT NULL,
  IsOn boolean NOT NULL,
  TrackerForeignIdAsEntered varchar(445)
);

CREATE TABLE orig_Task (
  Id int NOT NULL,
  WaypointId int NOT NULL,
  Radius int NOT NULL,
  WptOrder int NOT NULL
);

CREATE TABLE orig_UserProfile (
  UserId uuid NOT NULL,
  DefaultEventId int,
  IsSimpleEventsModel boolean NOT NULL,
  CoordFormat varchar(50) NOT NULL,
  DefHemisphereNS char(1) NOT NULL,
  DefHemisphereEW char(1) NOT NULL,
  ShowUserMessagesByDefault boolean NOT NULL,
  UserMessagesSettingIsNew boolean NOT NULL,
  Altitude varchar(20)
);

CREATE TABLE orig_Waypoint (
  Id int NOT NULL,
  EventId int NOT NULL,
  Name varchar(50) NOT NULL,
  Lat double precision NOT NULL,
  Lon double precision NOT NULL,
  Alt double precision NOT NULL,
  Description varchar(500)
);

-- Usernames to leave out of the import; filled by import-legacy.ts from LEGACY_EXCLUDE_USERS.
-- Everything owned by an excluded user (events, groups, trackers, waypoints, profile) is skipped too.
CREATE TABLE legacy_exclude (username citext PRIMARY KEY);
