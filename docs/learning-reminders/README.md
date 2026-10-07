# Learning reminder content-capability & policy manifest (Phase 2B)

This is the Titulino Bucket Spine half of the course-learning-reminders plan
(`titulino-ui-react-app-1/docs/plans/future/2026-09-28-course-learning-reminders.md`, Phase 2).
It provides the versioned, machine-readable data that Phase 2A (Bridge Libraries / Net API) and
the later Worker need to know **which exact course/chapter/language combinations have real
Quizlet or Know Me content**, **when that content becomes available**, and **which progress
categories should generate a notification at all** -- without guessing from translated titles,
row order, or URLs.

This package does not implement any HTTP client, .NET DTO, controller, Worker dispatch logic,
database migration, or UI. It produces data that another agent turns into typed contracts and
wires into `"TitulinoApi_v1"."ReplaceLearningContentCapabilities"(jsonb)`.

## Files

```
titulino-bucket/titulino-spine-data/learning-reminders/
  content-capabilities-manifest.json   <- published data (GCS-uploaded like every other spine file)
  schedule-anchors.json                <- published data
  notification-policy.json             <- published data

docs/learning-reminders/
  README.md                            <- this file
  mapping-report.md                    <- generated, human-readable included/excluded report
  schema/
    content-capability-request.schema.json
    schedule-anchors.schema.json
    notification-policy.schema.json

bucket-scripts/
  lib/learningReminderContent.mjs           <- derivation logic (pure, no side effects besides fs reads)
  lib/validateLearningReminderContent.mjs   <- validation rules (pure)
  generate-learning-reminder-manifest.js    <- CLI: (re)writes the three JSON files + report
  validate-learning-reminder-manifest.js    <- CLI: contract validation + drift check + fixtures
  __fixtures__/learning-reminders/          <- valid-*.json / invalid-*.json validator fixtures
```

Run with:

```
npm run generate-learning-reminder-manifest
npm run validate-learning-reminder-manifest
```

## Why three files instead of one

- **`content-capabilities-manifest.json`** is the exact wire shape of the deployed (not yet
  staged/pushed) database contract `"Notification".replace_learning_content_capabilities(p_request jsonb)`
  -- see `titulino-warehouse/deploy/Notification/2026/09/28_learning_reminder_{tables,functions}.sql`.
  Phase 2A can send this file's top-level object (`manifestKey`, `manifestVersion`, `publishedAt`,
  `items`) essentially as-is to `ReplaceLearningContentCapabilities`. **Recommended:** the
  publisher should overwrite `publishedAt` with the actual call time rather than the value frozen
  in this committed file, since that field is meant to record when the database observed the
  content, not when a human last edited a JSON file in git.
- **`schedule-anchors.json`** is *not* a database contract today. It gives the per-chapter
  `sourceAvailableOn` and the chronologically next applicable chapter date (`nextAvailableOn`),
  which the Worker/bridge is expected to pass as `sourceAvailableOn` / `nextAvailableOn` fields on
  each candidate object into `Notification.evaluate_learning_reminder_candidate(p_candidate jsonb, ...)`
  so expiry is capped at `LEAST(sourceAvailableOn + 7, course.EndDate, nextAvailableOn)`.
- **`notification-policy.json`** is additive metadata over `course-progress-data.json`. It never
  modifies that file. It says explicitly which categories are notification-worthy and, for the
  category-4/class-0 identity, which courses are opted in with a typed `activityKind`.

Keeping these separate means Phase 2A can adopt the content-capability manifest immediately
(it maps directly onto a deployed function) without being blocked on schedule-anchor or
notification-policy contracts that are still design proposals.

## Content-capability manifest contract

See `schema/content-capability-request.schema.json` for the full field-by-field contract. Key
points a consuming DTO must respect, taken directly from the deployed CHECK constraints:

- `chapterNumber` is stored as text matching `^[0-9]{1,3}$` before being cast to `int4` -- always a
  plain non-negative integer, 0-100.
- `relativePath` must be `null`, or start with exactly one `/` and contain no `//` prefix or
  `://` substring anywhere. **Never publish an absolute `https://titulino.com/...` URL.** In
  practice every item in this package publishes `relativePath: null` -- the actual student-facing
  route depends on the viewer's UI locale and is resolved at send/open time from live navigation
  metadata (`AuthCourseInnerSubMenu.js` / `DynamicNavigationRouter.js`), which this manifest cannot
  know in advance. Treat each item purely as a **content-existence gate** (does exact content
  exist for this course theme + chapter + content language + native-language pairing + level?),
  not as a URL source.
- The identity `(ManifestKey, CourseTheme, CourseCodeId, FeatureKey, ChapterNumber,
  ContentLanguageCode, NativeLanguageCode, Level)` is unique in the database
  (`NotificationContentCapability_identity_uidx`). The validator rejects duplicates against this
  exact tuple.
- `courseCodeId: null` means theme-level (applies to every `CourseCodeId` under that theme). Set
  it to a specific `CourseCodeId` only after individually verifying that cohort's content and
  calendar -- see `cohortCalendarLimitations` in `schedule-anchors.json` for a documented case
  (English Connect 1 has two course codes with unverified calendar equivalence).

### Stale / removal behavior

Publishing is a **full replace under one `manifestKey`**: on each call,
`replace_learning_content_capabilities` first sets `IsAvailable = false` for every existing row
under that `manifestKey`, then re-inserts/updates every row present in the new `items` array back
to `IsAvailable = true` (or whatever the item's own `isAvailable` says). Concretely:

- An item omitted from a new publish becomes unavailable automatically -- its content capability
  silently expires from the read-time gate used by `evaluate_learning_reminder_candidate`
  (`content_unavailable` reason), which blocks new reminder dispatch to that chapter. This is the
  intended removal path when content is genuinely taken down.
- An item can also be published with `isAvailable: false` explicitly, which this package uses for
  Speeches chapter 11 (see below) -- the difference from omission is that an explicit `false` plus
  `metadata.exclusionReason` documents *why* it is blocked, for admin preview and future review,
  rather than looking like content that was simply never audited.
- There is no independent per-row "last verified" staleness clock in the database beyond
  `PublishedAt`/`ObservedAt`. Freshness is a publishing-process responsibility: re-run
  `generate-learning-reminder-manifest.js` against current source data before every publish, and
  run `validate-learning-reminder-manifest.js`'s drift check, which fails if the committed manifest
  no longer matches what the verified sources currently produce.
- The plan's own freshness caveat applies here too: for content removed from GCS, the database
  cannot discover the change by itself. The availability index (`ContentCapability`) must be
  refreshed by re-publishing when content changes, and during any daily maintenance pass Phase 2A
  adds; direct-open resolution should re-verify the target if freshness is ever uncertain.

## What is (and isn't) published in this first cut

See `mapping-report.md` for the full generated table. Summary:

| Rule | Course theme | Chapters | Notes |
|---|---|---|---|
| Vocabulary review (`course-feature.submenu.quizlet`) | english-connect-1 | 1-24, x2 native-language pairings (es, pt) | Verified against `quizlet-pratice-data.json` folder (theme, baseLanguages, contentLanguageCode) and `course-progress-data.json` category 2 ("Recorded Classes") schedule, using the exact `courses[chapterNo - 1]` row-index lookup `QuizletService.js` uses. |
| Know Me reflection (`course-feature.submenu.know-me`) | meditaciones | 1-11 | Verified against `know-me-survey-data.json` theme+chapter key lookup (`LrnManager.getKnowMeSurveyQuestions`) and category 2 ("Conóceme") schedule. |
| Know Me reflection (`course-feature.submenu.know-me`) | speeches | 1, 3, 5, 7, 9 available; **11 published as `isAvailable: false`** | Chapter 11 renders Know Me through the legacy `getAuthCourseInnerSubMenuNoClassV3` builder (`AuthCourseSubNavigationSpeechesTheme.js`), which does not run the same feature/group/tier gating as `buildCourseInnerSubMenu` used for chapters 0-10. Do not flip to available until that path's gating parity is explicitly validated. Even chapters (2, 4, 6, 8, 10) have no survey content and are excluded. |

Deliberately **not** published (documented in the report, not silently omitted):

- English Connect 1/2 reflection: chapter templates set `showKnowMe: false`.
- Supermarket reflection: survey has chapter 1 content, but the chapter template does not expose
  Know Me -- template/content mismatch.
- Work & Jobs reflection: survey content is keyed to chapter 1, navigation exposes Know Me only on
  intro chapter 0 -- chapter/content mapping mismatch.
- Household reflection: no survey collection at all, and the template does not expose Know Me.

## Notification policy: category 4 / class 0

Per the plan, class 0 is only ever accepted through the reviewed availability contract when paired
with `categoryId = 4` and a typed `activityKind` of `assessment` or `reflection` --
`Notification.get_course_progress_availability_recipients` enforces exactly this. This package's
`notification-policy.json` opts in:

- **Supermarket** (`assessment`) and **Household** (`assessment`) and **Meditaciones**
  (`reflection`): `links.internal` is verified non-null in `course-progress-data.json`.
- **Work & Jobs** and **Speeches**: left `enabled: false` with `reason: "missing_internal_target"`
  because `links.internal` is `null` for their category-4/class-0 lesson. Do not enable until a
  reviewed internal target is published.

Category 0 must never be rendered as a student-facing "Class 0" label; that is a presentation
concern for Phase 4 UI, noted here as `presentationRules.neverRenderClassZeroAsStudentFacingCopy`.

## Known data-quality finding (reported, not corrected)

English Connect 1's category-2 ("Recorded Classes") schedule in `course-progress-data.json` does
not have `classNumber` and `availableDate` moving in the same order for chapters 1-6 (e.g. chapter
2 is dated *before* chapter 1; chapter 4 before chapter 3; chapter 6 before chapter 5). Per the
plan's "preserve existing JSON content and dates unless a correction is required and justified"
rule, this package does **not** reorder or reinterpret those dates. Instead:

- `nextAvailableOn` in `schedule-anchors.json` is computed **chronologically** (the next distinct
  `availableDate` value after a chapter's own date among the included chapters), not by
  `chapterNumber + 1`. This keeps every published boundary valid
  (`nextAvailableOn > sourceAvailableOn`, matching `evaluate_learning_reminder_candidate`'s
  `invalid_expiry_boundary` check) regardless of the underlying ordering anomaly.
- The anomaly itself is recorded in `schedule-anchors.json`'s `dataQualityWarnings` array and in
  `mapping-report.md`, the same way the plan already documents Household's March-2024/2025 date
  typo. Fix the source dates in `course-progress-data.json` deliberately (separate change, with
  its own review) if this is not intentional.

## How Phase 2A/Worker should publish this manifest

1. Read `titulino-bucket/titulino-spine-data/learning-reminders/content-capabilities-manifest.json`
   from the deployed bucket object (not the git checkout -- publishing to GCS happens via this
   repo's existing `.github/workflows` upload-on-push-to-`main`, the same mechanism every other
   spine JSON file uses; editing the local file alone does not update the deployed object).
2. Validate it against `schema/content-capability-request.schema.json` (or an equivalent typed
   C# DTO with the same required/optional fields and constraints).
3. Call `"TitulinoApi_v1"."ReplaceLearningContentCapabilities"(request)` with the file's
   `manifestKey`, `manifestVersion`, and `items` verbatim, and `publishedAt` set to the current UTC
   timestamp at call time.
4. Read `schedule-anchors.json` to compute each candidate's `sourceAvailableOn` and
   `nextAvailableOn` before calling `Notification.evaluate_learning_reminder_candidate`.
5. Read `notification-policy.json` to decide whether the existing course-progress availability
   Worker path should include a given category/class-0 activity, and with which `activityKind`.
6. Re-run this publish whenever the manifest changes (new chapter content, a theme added, a
   `isAvailable` flip such as validating Speeches chapter 11). There is no polling -- publish is an
   explicit step tied to a content change, exactly like every other spine data file.

## How to add a future rule/mapping

1. Add a new builder function in `bucket-scripts/lib/learningReminderContent.mjs` (mirroring
   `buildVocabularyItems` / `buildMeditacionesReflectionItems` / `buildSpeechesReflectionItems`)
   that derives items **only** from verified source data -- reuse the existing
   `quizletChapterExists` / `knowMeChapterExists` / `displayedLessonsByClassNumber` helpers rather
   than re-deriving lookup logic. If the new rule's content lives in a different spine file
   (e.g. `speaking-practice-data.json` for a future pronunciation rule), add a matching
   existence-check helper next to the existing ones, using whatever lookup mechanism the real
   consuming service uses (do not invent a new one).
2. If the new rule targets a feature key or course theme not already in
   `bucket-scripts/lib/validateLearningReminderContent.mjs`'s `KNOWN_FEATURE_KEYS` /
   `KNOWN_COURSE_THEMES` sets, add it there deliberately -- the validator intentionally rejects
   unregistered themes/feature keys so a future mapping cannot be invented silently.
3. Add a corresponding `RuleDefinition` row (in the warehouse repo, as a Sqitch migration, by
   whoever owns Phase 2A/3) with `IsEnabled = false` until content and eligibility are verified
   end-to-end, exactly like `vocabulary-review-after-availability` and
   `knowme-reflection-after-availability` are seeded today.
4. Run `npm run generate-learning-reminder-manifest` then
   `npm run validate-learning-reminder-manifest`; add a fixture in
   `bucket-scripts/__fixtures__/learning-reminders/` if the new rule introduces a genuinely new
   failure mode the existing fixtures don't cover.
5. Update `mapping-report.md` (regenerated automatically) and this README's "what is (and isn't)
   published" table.

## Open items for Phase 2A / a future session

- **Language code convention.** This package assumes `Enrollment.Course.TargetLanguageId` /
  `NativeLanguageId` use the same two-letter codes (`en`, `es`, `pt`) as
  `quizlet-pratice-data.json` / `course-progress-data.json`'s `contentLanguageCode` /
  `baseLanguages`. This was not directly confirmed against live `Enrollment.Course` rows (out of
  scope -- the database is read-only reference for this work). Confirm before relying on the
  `contentLanguageCode`/`nativeLanguageCode` match in
  `evaluate_learning_reminder_candidate`.
- **English Connect 1 dual cohort.** Two `CourseCodeId`s exist for this theme
  (`ENGLISH_CONNECT_1_JUL_2026_COURSE_01`, `ENGLISHCONNECT_01_JUN_2025_COURSE_02`) with no
  confirmed shared calendar. This package publishes content capabilities theme-level (content
  existence does not depend on cohort), but schedule-anchor dates are also theme-level and would
  currently apply identically to both cohorts. Confirm whether both should launch together or
  whether the schedule needs a per-cohort override before enabling the vocabulary rule broadly.
- **Speeches chapter 11 legacy path.** Needs an explicit review of
  `getAuthCourseInnerSubMenuNoClassV3`'s access-gating parity with `buildCourseInnerSubMenu`
  before flipping `isAvailable: true` for that item.
- **English Connect 1 category-2 date ordering.** See "Known data-quality finding" above --
  confirm with content ownership whether the schedule dates for chapters 1-6 are correct as
  authored.
