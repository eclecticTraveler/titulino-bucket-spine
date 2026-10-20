# `course-theme-registry.data.json` — RETIRED, 2026-10-15

**Nothing reads this file any more. Do not edit it. Do not trust its contents.**

It is left in place rather than deleted because removing it from the repository would **not**
remove it from the bucket — the object would simply linger with nothing left to explain what it
was. This note is that explanation.

---

## What replaced it

The theme-to-cohort mapping now lives in the database and is authoritative there:

| | |
|---|---|
| Tables | `Enrollment.CourseTheme`, `Enrollment.CourseThemeRegistry` |
| Read API | `TitulinoApi_v1.GetCourseThemeRegistry()` — public, callable logged-out |
| Write API | `TitulinoApi_v1.UpsertCourseThemeRegistry()` — admin only |

A course is registered to its theme **at creation**, from Admin Tools → Course Management →
Create, which now requires a Theme field. That is why nothing needs to hand-edit a registry file
any more.

## Who used to read it, and what they do now

| Consumer | Before | Now |
|---|---|---|
| titulino-ui | `GoogleService.getCourseThemeRegistryData` → `LrnManager` | `TitulinoRestService.getCourseThemeRegistry` (database), falling back to the copy bundled in the app |
| TitulinoMissive (Communication) | `IRepositoryClient.GetCourseThemeRegistryAsync` → `GcpBucketAdapter` | same call, now served by `SupabaseAdapter` |
| TitulinoWorkerService | as above, via the shared Bridge package | as above |

`Repository/Provider/GcpBucketAdapter.GetCourseThemeRegistryAsync` still exists in the Bridge
library but is no longer wired to anything. It is scheduled for removal in a later package
release; until then it would read **this stale file** if anyone called it.

## Why the app still bundles its own copy

`titulino-ui/src/assets/data/course-theme-registry.data.json` is kept deliberately, as the
offline fallback used when the database read fails.

That is not a contradiction with retiring this one. A fallback has to fail for *different*
reasons than the thing it backs up — this file and the database are both remote network fetches
from the browser and share their failure modes, whereas the bundled copy already sits inside the
JavaScript the page downloaded and cannot fail at runtime. This file's one real advantage,
"editable without a deploy", is now the database's job, and done better.

## It is stale, and will only get staler

It is a frozen snapshot. It does not and will not track cohorts created after 2026-10-15,
because course creation writes to the database only.

It also no longer carries the legacy `meditation` key, which was removed when that alias was
found to win theme lookups ahead of `meditaciones` and leave the Chapters admin tab empty
(titulino-ui `docs/known-bugs.md`, BUG-022). Note that the sibling
`course-theme-landing-paths.json` **still** contains a `meditation` key; that retirement is
tracked separately as IMP-009.

## If you need this data

Query the database, or call `GetCourseThemeRegistry()`. Do not reintroduce a file-based copy —
having two live sources is what produced the drift this migration removed. The full reasoning is
in titulino-ui `docs/improvements.md` (IMP-003) and
`docs/plans/active/2026-10-14-database-course-theme-registry-consumers.md`.

## Safe to delete when

Every deployed consumer is confirmed on the database path — titulino-ui, TitulinoMissive and
TitulinoWorkerService were all released on 2026-10-15 — **and** the orphaned
`GcpBucketAdapter` method has been removed from a published Bridge package. Delete this note
with it.
