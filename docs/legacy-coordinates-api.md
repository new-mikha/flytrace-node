# Legacy coordinates and tracks: API protocol and data fetching

A deep dive into the two endpoints the map page lives on (`GetCoordinates`, `GetTracks`), the incremental-update
protocol, and the in-memory machinery that feeds them. It is the detail behind §5.1, §8.3–8.5 of
[`legacy-system.md`](legacy-system.md); read that first for the wider map of the system.

Everything here was read out of the legacy source at
`/Users/michael/dev-top/flytrace-upgrade/flytrace`, and cross-checked against the production log
(`legacy-xml-samples/normal.log`, 1 Nov 2026 03:00–03:24), the production config excerpt
(`legacy-xml-samples/config-excerpts.xml`) and the nine captured responses in `legacy-xml-samples/`.
Claims are marked **(verified in prod)** where a log line or a sample confirms them, and **(unverified)** where
the code says one thing and nothing in the captures exercises it.

Primary files:

| Concern | File |
|---|---|
| Wire types | `Service/ServiceApiStructs.cs` |
| Incremental protocol | `Service/Internals/Subservices/CoordinatesService.cs` |
| Tracks | `Service/Internals/Subservices/TracksService.cs` |
| Snapshot read, lazy registration | `Service/Internals/Subservices/TrackerServiceBase.cs` |
| Group definition + its cache | `Service/Internals/GroupFacade.cs` |
| Cache, merge, revision bump | `Service/Internals/ForeignRequestsManager.cs`, `RevisedTrackerState.cs`, `TrackerStateHolder.cs` |
| Polling schedule | `Service/Internals/RequestsSchedule/Scheduler.cs` |
| Revision persistence | `Service/Internals/RevisionPersister.cs` |
| Feed fetching | `LocationLib/ForeignAccess/` (`LocationRequest.cs`, `Spot/`, `InReach/`) |
| Client | `Tracker/Scripts/main.js` (copied verbatim to `flytrace-node/public/js/map/main.js`) |

---

## 1. The two concepts the protocol is built on

Everything in the incremental protocol reduces to two counters. They are easy to confuse, so first, plainly:

| | **Version** | **Revision** |
|---|---|---|
| Scope | One per group | **One global counter for the whole service** |
| Lives in | `Group.Version` column (SQL Server) | Memory, backed by `App_Data/revision.bin` |
| Answers | "Is the client's *set of trackers* still correct?" | "Has this *tracker's data* changed since the client last looked?" |
| Bumped by | Any edit to the group (see below) | Any tracker snapshot whose content actually changed |
| Typical value | 180, 260, 278 (verified in prod) | 2,424,100-ish (verified in prod) |

### 1.1 Version: the group's shape

`Group.Version` must increase whenever anything the client has cached about the group's *tracker set* can change:
a tracker added, renamed, deleted or switched on/off; the group header edited; the assigned event's `StartTs`
changed (`UpdateEventStartTs` bumps every group assigned to the event). The stored procedures do
`UPDATE Group SET Version = Version + 1` inside the same transaction as the change, and `GetGroupTrackerIds` reads
it under `REPEATABLE READ` so reads and writes serialise.

The client's cached tracker list is keyed by **name**, and the incremental responses carry no "removed" marker, so
a version mismatch is the only way the server can tell the client "throw your list away and take a fresh one".

**Caching trap.** `GroupFacade` caches the whole `GroupDef` (tracker list, version, `ShowUserMessages`, `StartTs`,
`AltitudeUnits`) in a static dictionary **with no expiry**. It is only ever dropped wholesale by
`ServiceFacade.ResetGroupsDefCache()`, which every mutating page calls after writing. So the version the service
compares against is the *cached* one, not the one in the database. If a write path ever forgets the reset call, the
service keeps serving the stale tracker set indefinitely and clients never notice, because the cached version still
matches their seed. In the rewrite this coupling should be replaced by something that cannot be forgotten — read the
version per request, or invalidate by the write itself.

### 1.2 Revision: the data's freshness

One `int`, shared by every tracker of every group in the process. It is incremented in `OnEndReadLocation` only when
a completed foreign request actually produced different data (`RevisedTrackerState.Merge` returns a new instance
rather than the old one). The new value is stamped onto the snapshot as `DataRevision`.

Consequences worth keeping in mind:

- The number is **not** a per-tracker counter. Tracker A's snapshot carrying revision 2424131 only means "A was the
  2424131st change in this process since the counter started".
- A tracker that is polled every 30 s but reports nothing new consumes **no** revision. In the production log,
  21 trackers were polled for 19 minutes and the counter moved from 2424130 to 2424131 — a single change
  (verified in prod).
- Equality is **structural over the whole snapshot**, including the full 48 h track, not just the current point
  (`Position.ArePositionsEqual` compares `Type`, `UserMessage`, `CurrPoint`, `PreviousPoint` **and** `FullTrack`).
  So a historic point appearing in the inReach second iteration, or an old point ageing out of the 48 h window,
  bumps the revision even though the current position did not move — and the client then receives an "update"
  identical to what it already had. Harmless but wasteful.
- `Utils.EqualityExpressionCheck` is a startup self-test asserting that every field of the equality-bearing types
  participates in the comparison; a field added without updating the expression fails fast at boot. Worth copying
  as an idea: the revision protocol is only correct if equality is complete.

**Persistence** (`RevisionPersister`): written to `App_Data/revision.bin` every 100 increments, asynchronously. On
start, the stored value is rounded **up** to the next multiple of 100 (`(n / 100 + 1) * 100`) so that revisions
issued after a crash can never repeat ones a client may still hold. Verified in prod: the service started at
revision 2,424,100, a round hundred.

If the file is missing or unparsable, the counter restarts at 0 and the service runs
`UPDATE [Group] SET [Version] = [Version] + 1` over the **whole table**, invalidating every client seed in one
shot. If even that fails, `IsAlwaysFullGroup` is set and the process serves full responses for its lifetime.

---

## 2. `GetCoordinates`: the shape of the protocol

```
GetCoordinates(int group, string srcSeed, DateTime scrTime) -> GroupData
```

`scrTime` is a cache-buster only; the server ignores it. `srcSeed` is the client's seed, or `""`/`null` on the
first call.

**Seed format**: `"<groupVersion>;<maxRevisionSeen>"`, e.g. `"180;2424130"` (verified in prod). It is parsed by
`TryParseThresholdRevision`, which returns a threshold only if: the string splits into exactly two parts, both parse
as non-negative ints, and **the first equals the group's current version**. Anything else → `null` → the client is
treated as new.

### 2.1 Full vs non-full

"Full group" is a property of **the response**, not of the group. In `IsFullGroup`:

```
isFullGroup = DataManager.IsAlwaysFullGroup || any snapshot is null || any snapshot.DataRevision is null
```

- **A null snapshot** means the tracker is in the group but the service has not yet fetched its feed even once
  (it was registered in the cache during this call, or a moment ago). Those trackers are sent as `Type: "wait"`.
  While even one tracker of the group is in that state, *nobody* watching the group gets an incremental response.
- **`IsAlwaysFullGroup`** is a process-wide fail-safe, set by: `AllowIncrementalUpdates=false` in config; a failure
  to initialise or restore the revision counter; or the self-check in §2.3 detecting an inconsistency.
- A null `DataRevision` on a non-null snapshot can only happen when the revision persister is inactive, i.e. already
  in emergency mode.

So the normal lifecycle of a freshly-opened map is: **full → full → … → non-full**, flipping as soon as the last
tracker of the group has been polled once. Verified in prod for group 653 (9 SPOT trackers):

```
03:01:59  call 1   seed ""              isFullGroup True,  null snapshots 9   Res ""
03:02:29  call 3   seed ""              isFullGroup False, null snapshots 0   Res "260;2424109"
03:02:59  call 6   seed "260;2424109"   (incremental from here on)
```

That is also exactly what the samples `03-waiting-for-the-data.json` → `03-waiting-for-the-data-some-obtained.json`
→ `03-all-obtained.json` capture, for a 42-tracker group.

### 2.2 The four response shapes

A tracker is included in the response when
`snapshot == null || snapshot.DataRevision == null || threshold == null || snapshot.DataRevision > threshold`.
`nextThresholdRevision` is the **max `DataRevision` over all trackers of the group**, not only the included ones —
so the returned seed always advances past everything the server knows, and an unchanged tracker is never re-sent.

| # | Case | `Trackers` | `Src` | `Res` | `StartTs` |
|---|---|---|---|---|---|
| 1 | Full (any null snapshot, or always-full) | all | `null` | `null` | sent |
| 2 | First incremental-capable reply (seed absent/stale/wrong version) | all | `null` | `"v;r"` | sent |
| 3 | Incremental, something changed | changed only¹ | echo of client seed | `"v;r"` | **omitted** |
| 4 | Incremental, nothing changed | `null`¹ | `null` | `"NIL"` | sent |

¹ with the production debug setting, all trackers are sent in cases 3 and 4 too — see §2.3.

Two details that look like bugs but are not:

- **`StartTs` is sent whenever `Src` is null**, which includes case 4 (`"NIL"`). The rule in code is literally
  `result.StartTs = result.Src == null ? groupConfig.StartTs : null`. Verified by `02-trackers-with-task.json`:
  `Res: "NIL"`, `Src: null`, `StartTs: /Date(1776471424717)/`. So the hide-old-points threshold does keep reaching
  the client on quiet polls, which is why a `StartTs` change (which also bumps the version) is picked up promptly.
- **An empty group** (no trackers at all) takes path 2: the threshold is never even parsed
  (`if (!isFullGroup && trackerDefs.Any())`), so `Src = null`, `Res = "v;0"`, `Trackers = null`.

`Res == "NIL"` means "your seed is still current, change nothing". The client keeps its existing seed
(`else if (result.Res != "NIL") _currentSeed = result.Res;`), so `NIL` can repeat indefinitely — in the log,
group 2127 sent the same seed `"180;2424130"` on 19 consecutive polls over ten minutes (verified in prod).

### 2.3 The debug/surrogate mode — on in production

`IncrDebugRatio` (production value **1**, confirmed in `config-excerpts.xml`) makes `isDebugFullGroup` true for that
fraction of calls. When it is true:

- **every** tracker is put in the response, regardless of the incremental logic;
- each carries `IncrTest` = whether the normal logic *would* have included it;
- `IncrSurr: true` tells the client this is a self-test payload.

The client then runs its normal processing over the full list and compares against what it would have expected,
reporting anomalies back through `TestCheck`. Because the ratio is 1, **the incremental protocol currently saves no
bandwidth in production**: the payloads are always complete. The seed logic still runs underneath in full, and
`Src`/`Res` are still computed normally, which is why the captured samples show `IncrSurr: true` alongside
`Res: "NIL"` with all 21 trackers present.

The clearest capture of the two layers disagreeing is log call 36 (verified in prod):

```
Call id 36, isDebugFullGroup True
Call id 36, isFullGroup False, null snapshots count 0
Call id 36, input threshold revision 2424130
Call id 36, got tracker FALKO ... revision 2424131 (NewPos), included: True
Call id 36, 21 tracker(s) in total, and returning 21 in this call (1 by incr.logic). Res.seed is "180;2424131"
```

One tracker had actually changed; 21 were sent.

There is also a **consistency self-check**: reaching the "nothing changed" branch with contradictory state
(`incrLogicIncludeCount != 0` or `Src != Res`) logs Fatal, raises an admin alert, sets `IsAlwaysFullGroup` for the
process lifetime, and throws to the client. It is skipped in debug mode. This is the only place the protocol can
trip into permanent full mode at runtime (unverified — no occurrence in the captured log).

### 2.4 Per-tracker payload gating

`TrackerFromTrackerSnapshot` builds each item:

- `Type: "wait"` and nothing else when the snapshot is null.
- `Lat`/`Lon`/`Ts`/`Age` from the current point; `Lat`/`Lon` are **omitted when zero**, and the
  `ShouldSerializeXxx` methods hang `Ts` and `Age` off `Lat != 0` / `Lon != 0`. The client defaults missing
  `Lat`/`Lon` to 0. "No coordinates" is therefore expressed as the absence of fields, and `(0,0)` is not
  representable as a real position.
- `Alt` only when the group owner's profile sets an altitude unit. **The value is always metres on the wire** —
  `AltitudeUnits: "ft"` is a display instruction, and `main.js` multiplies by 3.28084 itself
  (`main.js:2042`). Worth stating plainly because it is easy to assume the server converts. The samples agree:
  group 3 has `AltitudeUnits: "ft"` with values like 92 and 455, which are plausible metres for Brazil/Argentina.
- `UsrMsg` only when the group has owner-defined messages enabled.
- `Prev*` only when the previous point exists **and** is newer than `StartTs`.
- `IsHidden = !IsOn`, additionally forced true when the current point is older than `StartTs`.
- `Error` = the user-facing message of the error attached to the snapshot. Note a snapshot can carry **both** a
  stale position and a fresh error.
- `Age` is computed **at response time** (`TimeService.Now - foreignTime`, floored at 0), so two responses a
  minute apart report different ages for the same point; the client ticks its own clock between polls.

---

## 3. `GetTracks`

```
GetTracks(int group, TrackRequest { Items: [{ TrackerName, LaterThan? }] }, DateTime scriptCurrTime)
  -> TrackResponseItem[] { TrackerName, Track: [{ Lat, Lon, Ts, Age, Type }] }
```

- **No seed, no incremental protocol.** The only narrowing is `LaterThan` per item.
- **At most 10 items**, else `ApplicationException("Number of requested full tracks can't exceed 10")`. Names are
  matched case-insensitively against the group's tracker names; names not in the group are silently dropped.
- Points come from the snapshot's `FullTrack`, **newest first**, filtered to `ForeignTime > LaterThan`.
- `Type` is set **only on the newest point** of each track (index 0) and is null on the rest — confirmed in every
  captured track sample.
- Tracks that come out empty are omitted from the response entirely, so a requested name may be missing from the
  reply.
- **`StartTs` is not applied here at all.** The server sends points older than the hide-threshold and the client
  cuts the polyline itself. Keep that in mind when porting: the filtering is client-side by design.
- It calls the same `GetSnapshots`, so asking for a track also refreshes the trackers' access time and registers
  any that are missing — fetching a track keeps a tracker alive in the cache.

Client side (`checkFullTracks`): at most **one `GetTracks` call per 30 s**; candidates are trackers whose marker is
displayable and which are flagged `shouldDisplayTrack && needGetTrack`; they are sorted by oldest request first and
the first 10 are taken. `LaterThan` is set to the newest point the client already holds for that tracker. This
explains the payload shape you captured: a first request for 8 names with no `LaterThan`, which is why only the
8 trackers that had data appeared, and why the 9th (`FALKO`) came separately when its data arrived later.

---

## 4. Internal data: what a snapshot is and how it is kept

### 4.1 The three layers

```
TrackerStateHolder          one per ForeignId, lives in the Scheduler's dictionary, mutable, identity stable
  .Snapshot  ───────────►   RevisedTrackerState   immutable, swapped atomically, carries DataRevision
                              .Position  ──────►  Position { FullTrack[] newest-first, CurrPoint = [0],
                              .Error                          PreviousPoint = [1] or null }
                              .Iteration
```

- A **snapshot** (`RevisedTrackerState`) is an immutable value: a position (with its whole 48 h track), an error,
  or both, plus the revision it was stamped with and an `UpdatedPart` tag (`BrandNew` / `NewPos` / `NewErr`).
  It is never mutated — a new one replaces the old by reference assignment, which is what makes lock-free reads
  safe.
- The **holder** is the mutable box: `Snapshot`, `CurrentRequest`, `AddedTime`, `ScheduledTime`,
  `RequestStartTime`, `RefreshTime`, and an access timestamp. It exists so that the dictionary only needs locking
  when trackers are added or removed, not on every data update. `CheckTimesConsistency` asserts the time fields
  stay sane and logs (not throws) if they do not.
- The dictionary is keyed by `ForeignId { Type: "SPOT" | "InReach" | "TEST", Id }` — **not** by group or by tracker
  name. The same device in two groups is polled once.

### 4.2 Lazy registration and eviction

Trackers enter the cache only because somebody asked for them:

1. `GetSnapshots` looks each `ForeignId` up in the dictionary under a **read lock**, reading all of the group's
   snapshots as one atomic set. (The comment in the source spells out why: if snapshots were read one by one, a
   writer interleaving between two reads could make the max revision skip a change that was never sent, and the
   client would never see it. Reading them atomically is a correctness requirement of the protocol, not an
   optimisation.)
2. Every holder found gets its access timestamp refreshed (`Interlocked.Exchange`, deliberately outside the lock).
3. If any holder was missing, `DataManager.AddMissingTrackers` is queued on the thread pool — so the call returns
   immediately with `"wait"` entries — and the worker thread is woken.
4. A tracker that no client has read for **`TrackerLifetimeWithoutAccess` = 20 minutes** is "boring" and is removed
   from the dictionary; its polling stops and its track is lost. Reopening the map starts it from scratch.

So the service polls exactly the union of trackers in groups watched in the last 20 minutes. Verified in prod: with
two groups being watched (9 + 21 trackers) the log shows exactly 30 distinct feeds polled, 25 SPOT and 5 inReach.

### 4.3 Request completion and the merge

`OnEndReadLocation` is the only place snapshots change:

1. Ignore the result if `holder.CurrentRequest` is no longer this request (a timed-out request that finished late).
2. Take an **upgradeable read lock**, compute `candidateRevision = currentRevision + 1` and
   `RevisedTrackerState.Merge(old, new, candidateRevision)` — all without writing anything.
3. Take the **write lock** briefly: clear `CurrentRequest`; if the merge returned a different instance, store it and
   commit the new revision; set `RefreshTime`.
4. Wake the scheduler.

`Merge` semantics:

- No old snapshot → new one, `BrandNew`.
- Both have positions → keep the one whose `CurrPoint.ForeignTime` is **newer**; on a tie the new one wins. (The
  older-wins branch guards against a feed briefly serving stale data.)
- The **error is always taken from the new result**, so a successful request clears a previous error, and an error
  does not erase a previously-known position.
- If the resulting position and error are both structurally equal to the old ones, **the old instance is returned**
  — no revision consumed, `RefreshTime` still updated.

---

## 5. Fetching rules: when a feed is actually hit

### 5.1 The scheduler loop

One background thread (`LocWorker`). Each pass, **per foreign system** (SPOT and inReach are scheduled
independently, with independent timelines):

1. Walk every holder: count in-flight requests, find the **most stale** tracker, and track the latest request start
   and latest refresh time.
2. Cancel timed-out requests and drop boring trackers if any were seen.
3. Compute how long to wait before the most stale tracker of each system may be hit, pick the minimum across
   systems, and sleep that long (capped at **3 s**) or until woken.
4. Start requests for every system whose wait equals that minimum (±50 ms), and mark those holders `ScheduledTime`.

**"Most stale"** (`GetMoreStaleTracker`, deliberately fragile, has its own unit tests):

1. A holder with `ScheduledTime` set is **less** stale than one without — it was scheduled but never started
   (an error?), so it must not monopolise the queue.
2. A holder with no `RefreshTime` is **more** stale than any refreshed one — never-fetched trackers go first, which
   is what makes a freshly-opened map fill quickly.
3. Otherwise compare, in order: both `ScheduledTime`s, both `RefreshTime`s, or both `AddedTime`s.

**The wait** (`GetWaitingTimeSpan`) is the latest of:

- `TimeSpan.MaxValue` if in-flight ≥ `MaxCallsInPack` (wait for a slot; a finishing call wakes the thread);
- `lastRequestStart(system) + MinTimeFromPrevStart`;
- `lastRequestEnd(system) + MinCallsGap`, **only when `MaxCallsInPack == 1`**;
- `thisTracker.RequestStartTime + SameFeedHitInterval`.

Note the asymmetry the class comment calls out: staleness is judged on *end* times while the limits are counted
from *start* times, so the scheduler can pick a tracker it then has to wait for, while another was already eligible.
Deliberately ignored.

### 5.2 The numbers, as deployed

| Parameter | SPOT | inReach | TEST |
|---|---|---|---|
| `MaxCallsInPack` | 10 | 10 (shares the SPOT setting) | 1 |
| `MinTimeFromPrevStart` | 2000 ms | 2000 ms (shared) | 0 |
| `MinCallsGap` | 0 | 0 (shared) | 5 s |
| `SameFeedHitInterval` | **150 s** | **30 s** | 30 s |

inReach reuses `SPOT_MaxCallsInPack`, `SPOT_MinTimeFromPrevStart_Ms` and `SPOT_MinCallsGap_Ms` verbatim
(`InReachLocationRequestFactory.cs:47-49`); only the hit interval is its own. Parameters are read **once** per
foreign type and cached for the process lifetime, and are range-checked at first use (pack 1–20, intervals ≤ 60 s /
60 s / 1800 s) — a bad value throws rather than degrades.

Verified in prod, both limits visible in one log:

```
03:01:59  SPOT feed 01Fqevu3...          03:20:45  inReach 4875E
03:04:29  (+150 s)                       03:21:16  (+31 s)
03:06:59  (+150 s)                       03:21:46  (+30 s)
03:09:29  (+150 s)
```

and consecutive starts within a system exactly 2 s apart. Each SPOT cycle issued ~50 requests in 150 s — the whole
watched population, spaced 2 s apart, repeating.

**Timeout**: a request whose start is older than `max(DefaultEndWaitTimeout, 60 s)` = 60 s is considered timed out;
its `CurrentRequest` is cleared, the factory is told, and the abort is queued on the thread pool.
`SafelyAbortRequest` has been seen to hang, so queued aborts older than 5 minutes are reported separately
(`TimedOutAborts` logger).

### 5.3 One fetch, in detail

`LocationRequest` runs an iteration loop: build a `FeedRequest` for iteration 0, fetch, hand the result to
`MergeWithExistingData(result, out needContinue)`, and if `needContinue` build iteration *n+1*. The existing
snapshot is passed in as `RequestParams.ExistingState` so the request can decide how far back it needs to go.

**SPOT** (`SpotLocationRequest`): pages of 50 messages, `?start={n*50+1}`. After each page the pages are unioned,
ordered newest-first and de-duplicated. It continues to the next page **only if** all of: no error, the page was
exactly 50 points (i.e. probably truncated), the merged span is still < 48 h, iteration < 5, and either there is no
existing track or the oldest fetched point is still newer than the newest existing one (i.e. a real gap remains).
Otherwise it unions with the existing track and stops. Finally trimmed to 48 h behind the newest point.

**inReach** (`InReachLocationRequest`): a two-step strategy.
- Iteration 0 is sent **without `d1`** and normally returns just the latest point. If that point's `Id` equals the
  newest existing point's `Id`, nothing changed: return the existing track (clearing any stale error) and stop —
  one cheap request per 30 s in the common case.
- Otherwise iteration 1 refetches with `d1 = newestKnownPoint - (48/24 + 2) = 4 days`, generous on purpose because
  Garmin has been seen to mishandle the time part and timezones.
- The fresh points are sanitised against the old track (`SanitiseFreshPointsOverOlderTrack` drops points whose `Id`
  matches an existing one but whose timestamp moved — Garmin does this), unioned, trimmed to 48 h behind the newest
  **existing** point, ordered newest-first, de-duplicated.
- An error on iteration ≥ 1 after a successful iteration 0 keeps the earlier iteration's track and attaches the
  error.
- If iteration 0 unexpectedly returns many points spanning > 48 h, that result is taken as-is and reported once.

`FullTrackPointAgeToIgnoreInHours = 48` is the single constant behind all of this; the client then trims again to
12 h for display.

**Duplicate timestamps**: the inReach KML parser bumps duplicate `<when>` values by +1 s each and reports it. This
is frequent in production — the log shows feed `4875E` hitting it on every single poll (verified in prod).

### 5.4 Error classification

`Error.Type` ∈ `ResponseHasNoData | ResponseHasBadSchema | ResponseIsTooBig | BadTrackerId | AuxError`, each with a
user-facing message. The two seen most in the samples and the log:

- `"No coordinates found for the tracker."` — `ResponseHasNoData`, the SPOT feed exists but is empty
  ("No Messages to display"). Benign and very common: 24 of 42 trackers in `03-all-obtained.json`.
- `"The tracker ID is not recognized by the SPOT server."` — `BadTrackerId`, from HTTP 404, an empty body, or a
  SPOT `<error>` text of "Feed Not Found" / "Feed Currently Not Active" / "Feed Password required". 16 of 42 in the
  same sample — a lot of dead ids in real groups.

Both are **neutral** for error escalation: they reset nothing and count nothing. Real failures go through
`ConsequentErrorsCounter` (request errors threshold 5, timeouts 1, unexpected foreign errors 5); below threshold
they log at Info, at or above at Error, which is what reaches the admin by email. **One counter instance is shared
between SPOT and inReach**, so an outage of one silences escalation for the other.

A tracker in error keeps its last known position (`Merge` keeps the position and attaches the error), so the map
goes on showing the last fix with an error line in the pilot list.

---

## 5.5 Are the intervals ours, or imposed by SPOT and Garmin?

Short answer: **the SPOT numbers are SPOT's own published limits, copied verbatim; the inReach number is our own
guess, and it is more aggressive than anyone else's.** No, we cannot poll every second.

### SPOT: documented, and enforced

SPOT's support page for the public XML feed asks for **at least 2.5 minutes (150 s) between calls to the same
feed**, and, when pulling several feeds, **a sleep of at least 2 seconds between feed requests** (quoted in full
below). Those are exactly our two settings:

| Our setting | Value | SPOT's published rule |
|---|---|---|
| `SPOT_SameFeedHitInterval_Seconds` | 150 | "at least 2.5 minutes between calls of the same feed" |
| `SPOT_MinTimeFromPrevStart_Ms` | 2000 | "sleep of at least 2 seconds between feed requests" |

So the scheduler is not a general-purpose rate limiter that happens to be set conservatively — it is a direct
implementation of SPOT's terms, and the two parameters mean exactly what SPOT's two rules mean. That is almost
certainly why the scheduler is built the way it is (per-feed interval *and* a separate global gap between any two
requests): it needed to satisfy both rules at once.

The wording on SPOT's page, quoted verbatim (bold is theirs), fetched 1 Nov 2026 from
<https://www.findmespot.com/en-us/support/spot-gen4/get-help/general/public-api-and-xml-feed> and identical on the
`en-ca` version of the same page:

> Be considerate when making API calls, this service is provided free of charge, please do not abuse it.
>
> **Please allow as least 2.5 minutes between calls of the same feed and if you are pulling multiple feeds have
> your application sleep at least 2 seconds between feed requests**
>
> Repeatedly accessing the same feed in very short time periods will result in your IP being blocked or your feed
> disabled.

The consequence clause matters: the punishment can land on the **tracker owner**, not just on us.

**SPOT does not document HTTP 429 anywhere I can verify.** Neither live page mentions 429, "Too Many Requests" or
`Retry-After`. An earlier draft of this document said SPOT documents 429; that was wrong — it came from a search
engine's summary attributing it to a Gen3 support page that returns **404**. The only concrete 429 evidence for
either service is the Garmin forum report below. What SPOT actually publishes is the two intervals and the
blocking consequence, with no stated status code, no stated duration of a block, and no stated way to detect one.

The same page also confirms two limits worth carrying into the rewrite: the feed returns the **last 50 messages**
per page (paging in increments of 50), and "The API will only return data from the point in time the feed was
created, up to a maximum of **7 days**".

Also worth carrying over: the feed returns at most the **last 50 messages** per page (hence the paging), and SPOT
only serves **up to 7 days** of history whatever we ask for.

### inReach: nothing published

I could find no official Garmin limit for the MapShare KML feed. What exists is community evidence:

One Garmin forum thread, "Maximum Polling for KML Feed" (posted "over 3 years ago", so roughly 2023), is the
**only** concrete mention of 429 found for either service — SPOT's own pages do not mention it (see above).
<https://forums.garmin.com/outdoor-recreation/outdoor-recreation-archive/f/inreach-general/337645/maximum-polling-for-kml-feed>

The original poster (user `7616318`), verbatim:

> I finally hit a  '429 Too Many Requests' error today from my web app that does some limited live tracking.
>
> I cranked it up to 1 minute polling since the event is using all 2 minute trackers.
>
> When I noticed the error, I turned it off and tried on the hour until requests went through again (took about an
> hour or two).
>
> I've now got it polling every 10 minutes which seems ok but the fact remains there is no documentation about how
> much polling is too much!

Read that for what it is: **one user's anecdote**. He was not told he was blocked — "about an hour or two" is his
own estimate of when requests started working again, and the thread never uses the words "locked out", "blocked" or
"banned". The 10-minute figure is his own choice ("seems ok"), not a published threshold. The single Garmin reply
in the thread, from `Garmin-Leslie`, offers to take it to a private message and **does not address polling limits
at all**.

So for inReach there is no documented limit, no documented status code, and no documented recovery time — only
evidence that 429 exists and that one person saw it at 1-minute polling.
- Devices only *produce* points every **10 minutes** on the Standard plan and **2 minutes** on Premium, so anything
  faster than that fetches nothing new. (The poster above was running 2-minute trackers and still got throttled at
  1-minute polling.)
- A Garmin representative is reported elsewhere as saying the feed is polled "at a frequency desired by the
  consumer", i.e. that they set no limit. **I have not verified that quote** — it came from a search summary of a
  thread I did not open, and the one Garmin reply in the thread I did verify says nothing about limits. Treat it
  as hearsay. **(unverified)**

Our **30 s** is therefore well inside the range where at least one person has been throttled, and 20–60× faster
than the device reporting rate. It has evidently not caused trouble (the production log shows 30 s polling of five
inReach feeds with no errors), which is probably down to two things: we only ever watch a handful of inReach feeds
at a time, and the common-case request is cheap — iteration 0 is sent without `d1`, returns a single point, and
stops as soon as its `Id` matches what we already have (§5.3). But it is luck and low volume, not design. **For the
rewrite I would not keep 30 s.** Something in the 2–5 minute range costs viewers almost nothing (the device is not
reporting faster than that anyway) and removes the risk.

Note also that the feed host has moved over the years — `inreach.garmin.com` → `share.garmin.com` →
`explore.garmin.com` is reported as current, with `share.garmin.com/Feed/Share/<name>` still answering. Our stored
ids are all `share.garmin.com/...`, so this needs watching. **(unverified)**

### What the legacy code does when a limit is hit: nothing

This is the real gap, and it is worth fixing in the rewrite rather than porting:

- **Only HTTP 404 is recognised** (`WebFeedRequest.cs:218`) and mapped to `BadTrackerId`. Every other HTTP status,
  **429 included**, falls through to a generic `AuxError` carrying the exception message, shown to the viewer as
  "Cannot retrieve location data for the tracker: ...".
- **There is no backoff anywhere.** `ConsequentErrorsCounter` and its three `ThresholdCounter`s only decide whether
  a failure is logged at Info or at Error (which drives the SMTP alert). They do not change the schedule. A feed
  returning 429 is retried on exactly the same cadence as a healthy one, forever.
- **The response headers are never inspected on the error path**, so if either service does send a `Retry-After`
  on a 429, we neither see nor obey it. Whether they send one is **unknown**: SPOT's live support pages do not
  mention `Retry-After` or 429 at all, Garmin documents nothing, and I found no report either way. It can only be
  established by capturing a real 429.
- An unknown SPOT `<error><text>` is treated as "no data" and logged; if SPOT ever signalled throttling that way we
  would absorb it silently.
- The only thing that ever stops a failing feed being polled is the 20-minute no-viewer eviction.

So the system is well-behaved as long as the configured intervals are right, and has no defence at all if they are
wrong or if the far end changes its mind. A rewrite should: treat 429 as a first-class outcome with per-feed
exponential backoff, keep the per-feed and global gaps as hard floors rather than targets, and log the full
response headers of a 429 the first time one is seen — that is the cheapest way to find out whether either
service sends `Retry-After`, which is currently an open question, not a known fact.

---

## 6. End to end: opening a map

```
t=0     map.aspx renders; main.js initialize(); _currentSeed = null
t=0     GetCoordinates(group, null, now)
          └ GroupFacade: GetGroupTrackerIds (or cache) → tracker list + version + StartTs + units + messages flag
          └ GetSnapshots under read lock → all null → queue AddMissingTrackers, wake LocWorker
          └ response: full, every tracker Type:"wait", Res=null, StartTs sent
        client: shows "Waiting for the data...", keeps _currentSeed = null
t≈0-20s LocWorker polls the new trackers, 2 s apart per system, most-stale-first
          └ each completion: Merge → new snapshot, revision++ (only if changed), RefreshTime set
t=30s   GetCoordinates(group, null, now)        ← client still has no seed
          └ no null snapshots → non-full; threshold null → all trackers sent, Src=null, Res="v;r"
        client: _currentSeed = "v;r"
t=60s+  GetCoordinates(group, "v;r", now) every 30 s
          └ nothing changed → Res="NIL", client keeps its seed          (the common case)
          └ something changed → Res="v;r2", only changed trackers¹      (¹ all of them, with IncrDebugRatio=1)
          └ group edited → version differs → threshold null → full list again, Res="v2;r"
on click GetTracks(group, {Items:[≤10 names, LaterThan?]}, now), at most one call per 30 s
every call  thread pool: UPDATE Group SET PageUpdatesNum+=1 [, NewestCoordTs/Lat/Lon]
```

The client also compares `result.Ver` (the `Settings.Version` constant, 18 in production) against the last value it
saw, and triggers a full page postback when it changes — the deploy-time mechanism for forcing clients onto new
scripts, preserving map centre and zoom through hidden fields.

---

## 7. Notes for the rewrite

### 7.0 Settled since this document was written (1 Nov 2026)

Recorded in full under "Decisions (do not re-propose)" in `AGENTS.md`; summarised here because the items below were
written before these calls were made, and items 1, 2, 7 and 8 are superseded by them.

- **The coordinates endpoint always sends the full tracker list.** No revision counter, no seeds, no
  `Src` / `Res` / `"NIL"`, no `IncrSurr` / `IncrTest`, no `TestCheck`. This settles items 2, 7 and 8 and the
  "still open" question about capturing a true incremental response: it no longer matters.
- **Snapshots and tracks live in memory only; there is no table of track points.** This confirms item 1 (and item 3,
  which a shared in-memory snapshot gives for free) and settles item 5: keep both the 48 h server trim and the 12 h
  client trim, since the client is unchanged. Item 4 goes away with the revision counter — equality no longer gates
  anything on the wire.
- **One app process, never a second instance**, with the poller inside it (item 1's "keep a single poller process"
  branch, made explicit).
- **Request timeouts, reduced from legacy.** Legacy: 55 s per HTTP request (`Math.Max(20000,
  DefaultEndWaitTimeout - 5000)`) and 60 s per logical request measured from the chain's start (the scheduler's
  `TimeoutSpanInSeconds = 60` watchdog, swept rather than exact). Ours: **10 s per HTTP request, 60 s for the whole
  paging chain**, one `AbortSignal` shared by every page of a chain so the ceiling is exact. 10 s is roughly 10x a
  normal response, and every second beyond it is a tracker parked in a concurrency slot.
- **The legacy timing rules are kept, and there is no backoff** (4 Nov 2026): 2 s between request starts, at most 10
  in flight, 150 s (SPOT) and 30 s (inReach) per feed from the start of its last call, as §5.2. This overrides the
  backoff advice of item 0 and §5.5: a failing feed is retried on its normal interval, as in legacy, and the errors
  are logged in full with their response headers. SPOT paging happens only on a tracker's first fetch. The design is
  under "Tracker sources and polling" in `AGENTS.md`.
- **`feed_polls` (`tracker_type`, `foreign_id`, `last_polled_at`)** is the one piece of polling state in Postgres:
  it exists so a restart does not re-hit a feed sooner than the self-imposed interval, and it is read at startup
  only. Keyed by the feed, because the same feed in several groups is one snapshot and one schedule
  (legacy: `IDictionary<ForeignId, TrackerStateHolder>`). It holds no positions and no tracks.

### 7.1 Things that will bite if ported naively

In rough order of importance:

0. **The polling intervals are external constraints, not tuning knobs** (§5.5): 150 s per SPOT feed and 2 s between
   any two SPOT requests are SPOT's published rules, and breaking them risks the feed owner's access, not just
   ours — SPOT's published consequence for abuse is the **feed owner's** feed being disabled or our IP blocked. Add
   the backoff handling the legacy code lacks, and log a throttling response in full the first time one appears,
   since neither service documents what one looks like.
1. **The whole design assumes one process with memory.** Group definitions, tracker snapshots, the revision counter
   and the "boring" eviction clock are all process-local. Two Node workers would each poll every feed and issue
   conflicting revisions. Either keep a single poller process, or move snapshots and the revision counter into
   Postgres/Redis and accept the latency.
2. **The revision counter is global and monotonic.** Postgres sequences give this directly. The round-up-by-100
   restart trick exists only because the file persistence was lossy; a sequence makes it unnecessary.
3. **Atomic multi-tracker reads are a correctness requirement**, not a nicety (§4.2). A single `SELECT` over the
   group's trackers gives this for free; a per-tracker read loop does not.
4. **Equality must cover everything** that can change, or clients silently miss updates. Port
   `EqualityExpressionCheck` as a test over the snapshot type.
5. **The 48 h / 12 h split**: 48 h is server-side (`FullTrackPointAgeToIgnoreInHours`), 12 h is client-side trimming
   in `main.js`. Keep both or neither; the sizes of `GetTracks` responses depend on the first.
6. **`Alt` is metres on the wire** regardless of `AltitudeUnits` (§2.4). Do not "fix" this without changing the
   client.
7. **`IncrDebugRatio = 1` means the incremental saving is currently off in production.** Before porting the
   surrogate/self-test machinery, decide whether it is wanted at all; the simpler protocol without `IncrSurr` and
   `IncrTest` is a legitimate target, and the bandwidth win is real on a competition day.
8. **`"NIL"` keeps `StartTs` flowing** but omits trackers; `Src` being null in both the "first incremental" and the
   "no change" case is load-bearing for the client. If the wire format is redesigned, make these explicit states
   rather than null-combinations.
9. **`(0,0)` is not representable** as a position, and absent fields carry meaning. A JSON rewrite should use
   explicit nulls.
10. **Lazy registration means the first 10–60 s of any map view is data-free.** Any rewrite that polls eagerly for
    all groups would be gentler on viewers but much heavier on SPOT and Garmin; the 20-minute eviction is what keeps
    the load proportional to actual viewers.

### Still open

- `AvgAllowedMsBetweenCalls` (1800), `RefreshChunk` (10) and `IsNewScheduler` (True) are in the production config
  but I found no reader for the first two; `IsNewScheduler` appears to be a leftover switch. **(unverified)**
- `IsOfficial` is marked obsolete in the source and always serialised as false.
- `DebugLines` is populated from `c:\temp\debuglines.txt` when that file exists — a live debugging hook, null in all
  samples.
- No captured sample shows a **true incremental** response (`Src` non-null), because with `IncrDebugRatio = 1`
  that only happens on a poll where something changed; the log confirms the state (call 36) but the payload was not
  captured. If you can capture one, it would confirm the case-3 row of the table in §2.2.
- The exact behaviour when a group is edited while clients are watching (version bump mid-session) is derived from
  code only. **(unverified)**
