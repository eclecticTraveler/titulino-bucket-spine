// Derives the Phase 2 learning-reminder content-capability / schedule-anchor / notification-policy
// manifests from the three verified spine data sources. Every published item is computed from
// these sources using the same lookup mechanism the deployed UI uses (QuizletService row-index
// bounds, LrnManager theme+chapter key lookup) -- nothing here is hand-typed or guessed from
// titles, row order across unrelated arrays, or URLs.
//
// Source of truth files (read-only inputs):
//   titulino-bucket/titulino-spine-data/quizlet-pratice-data.json
//   titulino-bucket/titulino-spine-data/know-me-survey-data.json
//   titulino-bucket/titulino-spine-data/course-progress-data.json
//
// See docs/learning-reminders/README.md for the manifest contract and how to add a rule.

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const DATA_ROOT = resolve(__dirname, '../../titulino-bucket/titulino-spine-data');

export const SOURCE_FILES = {
  quizlet: join(DATA_ROOT, 'quizlet-pratice-data.json'),
  knowMeSurvey: join(DATA_ROOT, 'know-me-survey-data.json'),
  courseProgress: join(DATA_ROOT, 'course-progress-data.json'),
};

export const MANIFEST_KEY = 'learning-reminders.content-capabilities';
export const SCHEMA_VERSION = '1.0.0';

export const RULE_KEYS = {
  vocabularyReview: 'vocabulary-review-after-availability',
  knowMeReflection: 'knowme-reflection-after-availability',
};

export const FEATURE_KEYS = {
  quizlet: 'course-feature.submenu.quizlet',
  knowMe: 'course-feature.submenu.know-me',
};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha1(value) {
  return createHash('sha1').update(value, 'utf8').digest('hex');
}

// Parses the spine's fixed MM/dd/yyyy convention explicitly. Never delegate to `new Date(str)`,
// which is locale/engine dependent for non-ISO strings.
export function parseMmDdYyyyToIso(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || '').trim());
  if (!match) {
    throw new Error(`Expected MM/dd/yyyy date, got: ${JSON.stringify(value)}`);
  }
  const [, mm, dd, yyyy] = match;
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Invalid calendar date in MM/dd/yyyy value: ${value}`);
  }
  return `${yyyy}-${mm}-${dd}`;
}

function loadSources() {
  return {
    quizlet: readJson(SOURCE_FILES.quizlet),
    knowMeSurvey: readJson(SOURCE_FILES.knowMeSurvey),
    courseProgress: readJson(SOURCE_FILES.courseProgress),
  };
}

// --- Quizlet content existence -------------------------------------------------------------
//
// Mirrors src/services/QuizletService.js exactly: a folder is matched by
// (theme, baseLanguages includes nativeLanguageCode, contentLanguageCode), and a chapter's
// content exists only if `courses[chapterNo - 1]` is present in that folder (row-index bound,
// not title text). This is the same mechanism the deployed UI uses to resolve the embed.
function findQuizletFolder(quizletData, theme, nativeLanguageCode, contentLanguageCode) {
  return (quizletData.folders || []).find(
    (f) => f.theme === theme && (f.baseLanguages || []).includes(nativeLanguageCode) && f.contentLanguageCode === contentLanguageCode
  );
}

export function quizletChapterExists(quizletData, theme, nativeLanguageCode, contentLanguageCode, chapterNumber) {
  const folder = findQuizletFolder(quizletData, theme, nativeLanguageCode, contentLanguageCode);
  if (!folder) return { exists: false, folder: null, entry: null };
  const entry = folder.courses[chapterNumber - 1];
  return { exists: Boolean(entry && entry.id), folder, entry };
}

// --- Know Me survey content existence ------------------------------------------------------
//
// Mirrors src/managers/LrnManager.js getKnowMeSurveyQuestions exactly: lowercase theme key,
// string chapter key, questions array must exist and be non-empty.
export function knowMeChapterExists(knowMeSurveyData, theme, chapterNumber) {
  const themeKey = String(theme || '').toLowerCase();
  const chapterKey = String(chapterNumber);
  const questions = knowMeSurveyData?.[themeKey]?.[chapterKey]?.questions;
  return {
    exists: Array.isArray(questions) && questions.length > 0,
    questions: Array.isArray(questions) ? questions : null,
  };
}

// --- Course-progress schedule lookups -------------------------------------------------------

function findThemeSchedule(courseProgressData, theme) {
  return (courseProgressData || []).find((t) => t.courseGeneralTheme === theme);
}

function findCategory(themeSchedule, categoryId) {
  if (!themeSchedule) return [];
  return Object.values(themeSchedule.categories || {}).filter((c) => c.categoryId === categoryId);
}

// Returns lessons for a theme/category sorted by classNumber, restricted to isToDisplay lessons.
// When more than one category row shares the same categoryId (e.g. Speeches Basic/Advanced
// Grammar), all matching lessons are considered and de-duplicated by classNumber so that a
// single content-capability decision does not silently prefer one level variant over another.
function displayedLessonsByClassNumber(themeSchedule, categoryId) {
  const byClass = new Map();
  for (const category of findCategory(themeSchedule, categoryId)) {
    for (const lesson of category.lessons || []) {
      if (!lesson.isToDisplay) continue;
      if (!byClass.has(lesson.classNumber)) byClass.set(lesson.classNumber, []);
      byClass.get(lesson.classNumber).push(lesson);
    }
  }
  return byClass;
}

// --- Manifest item builders ------------------------------------------------------------------

function buildVocabularyItems(sources, report) {
  const theme = 'english-connect-1';
  const themeSchedule = findThemeSchedule(sources.courseProgress, theme);
  const scheduleClasses = displayedLessonsByClassNumber(themeSchedule, 2); // "Recorded Classes"
  const contentLanguageCode = 'en';
  const nativeLanguageCodes = ['es', 'pt']; // verified Quizlet folders for this theme/content language
  const items = [];

  for (const nativeLanguageCode of nativeLanguageCodes) {
    const folder = findQuizletFolder(sources.quizlet, theme, nativeLanguageCode, contentLanguageCode);
    if (!folder) {
      report.excluded.push({
        courseTheme: theme, featureKey: FEATURE_KEYS.quizlet, nativeLanguageCode, contentLanguageCode,
        reason: 'no_matching_quizlet_folder',
      });
      continue;
    }
    for (const [chapterNumber, lessons] of scheduleClasses) {
      const { exists, entry } = quizletChapterExists(sources.quizlet, theme, nativeLanguageCode, contentLanguageCode, chapterNumber);
      if (!exists) {
        report.excluded.push({
          courseTheme: theme, featureKey: FEATURE_KEYS.quizlet, chapterNumber, nativeLanguageCode, contentLanguageCode,
          reason: 'quizlet_chapter_out_of_bounds',
        });
        continue;
      }
      items.push({
        courseTheme: theme,
        courseCodeId: null,
        featureKey: FEATURE_KEYS.quizlet,
        chapterNumber,
        contentLanguageCode,
        nativeLanguageCode,
        baseLanguages: [nativeLanguageCode],
        level: 0,
        targetKind: 'course-feature',
        relativePath: null,
        templateKey: RULE_KEYS.vocabularyReview,
        contentHash: sha1(`quizlet:${folder.id}:${entry.id}:${entry.title}`),
        isAvailable: true,
        metadata: {
          sourceCategoryId: 2,
          quizletFolderId: folder.id,
          quizletResourceName: folder.resourceName,
          quizletCourseId: entry.id,
        },
      });
      report.included.push({
        courseTheme: theme, featureKey: FEATURE_KEYS.quizlet, chapterNumber, nativeLanguageCode, contentLanguageCode,
        ruleKey: RULE_KEYS.vocabularyReview, sourceCategoryId: 2,
      });
    }
  }
  return items;
}

function buildMeditacionesReflectionItems(sources, report) {
  const theme = 'meditaciones';
  const themeSchedule = findThemeSchedule(sources.courseProgress, theme);
  const scheduleClasses = displayedLessonsByClassNumber(themeSchedule, 2); // "Conóceme"
  const contentLanguageCode = 'es';
  const nativeLanguageCode = 'es';
  const items = [];

  for (const [chapterNumber] of scheduleClasses) {
    const { exists, questions } = knowMeChapterExists(sources.knowMeSurvey, theme, chapterNumber);
    if (!exists) {
      report.excluded.push({ courseTheme: theme, featureKey: FEATURE_KEYS.knowMe, chapterNumber, reason: 'know_me_survey_missing' });
      continue;
    }
    items.push({
      courseTheme: theme,
      courseCodeId: null,
      featureKey: FEATURE_KEYS.knowMe,
      chapterNumber,
      contentLanguageCode,
      nativeLanguageCode,
      baseLanguages: [nativeLanguageCode],
      level: 0,
      targetKind: 'course-feature',
      relativePath: null,
      templateKey: RULE_KEYS.knowMeReflection,
      contentHash: sha1(`know-me:${theme}:${chapterNumber}:${questions.length}:${questions.map((q) => q.id).join(',')}`),
      isAvailable: true,
      metadata: { sourceCategoryId: 2, questionCount: questions.length },
    });
    report.included.push({
      courseTheme: theme, featureKey: FEATURE_KEYS.knowMe, chapterNumber,
      ruleKey: RULE_KEYS.knowMeReflection, sourceCategoryId: 2,
    });
  }
  return items;
}

function buildSpeechesReflectionItems(sources, report) {
  const theme = 'speeches';
  const themeSchedule = findThemeSchedule(sources.courseProgress, theme);
  const scheduleClasses = displayedLessonsByClassNumber(themeSchedule, 1); // "General Gatherings"
  const contentLanguageCode = 'en';
  const nativeLanguageCode = 'es';
  // Chapter 11 renders Know Me through the legacy `getAuthCourseInnerSubMenuNoClassV3` builder
  // (AuthCourseSubNavigationSpeechesTheme.js), which does not run the same feature/group gating
  // as `buildCourseInnerSubMenu` used for chapters 0-10. Publish it as unavailable until that
  // path is explicitly validated to honor Active/tier/group access the same way.
  const UNVALIDATED_LEGACY_CHAPTERS = new Set([11]);
  const items = [];

  for (const [chapterNumber] of scheduleClasses) {
    const { exists, questions } = knowMeChapterExists(sources.knowMeSurvey, theme, chapterNumber);
    if (!exists) {
      report.excluded.push({
        courseTheme: theme, featureKey: FEATURE_KEYS.knowMe, chapterNumber, reason: 'know_me_survey_missing',
      });
      continue;
    }
    const legacyUnvalidated = UNVALIDATED_LEGACY_CHAPTERS.has(chapterNumber);
    items.push({
      courseTheme: theme,
      courseCodeId: null,
      featureKey: FEATURE_KEYS.knowMe,
      chapterNumber,
      contentLanguageCode,
      nativeLanguageCode,
      baseLanguages: [nativeLanguageCode],
      level: 0,
      targetKind: 'course-feature',
      relativePath: null,
      templateKey: RULE_KEYS.knowMeReflection,
      contentHash: sha1(`know-me:${theme}:${chapterNumber}:${questions.length}:${questions.map((q) => q.id).join(',')}`),
      isAvailable: !legacyUnvalidated,
      metadata: {
        sourceCategoryId: 1,
        questionCount: questions.length,
        ...(legacyUnvalidated
          ? {
              exclusionReason: 'chapter_11_legacy_navigation_unverified',
              note: 'getAuthCourseInnerSubMenuNoClassV3 always renders Know Me unconditionally; feature/group/tier gating parity is unverified. Validate before flipping isAvailable to true.',
            }
          : {}),
      },
    });
    if (legacyUnvalidated) {
      report.excluded.push({
        courseTheme: theme, featureKey: FEATURE_KEYS.knowMe, chapterNumber, reason: 'chapter_11_legacy_navigation_unverified',
      });
    } else {
      report.included.push({
        courseTheme: theme, featureKey: FEATURE_KEYS.knowMe, chapterNumber,
        ruleKey: RULE_KEYS.knowMeReflection, sourceCategoryId: 1,
      });
    }
  }
  return items;
}

// Documents template/content mismatches that were deliberately NOT published, per the plan's
// initial reflection-mapping table, so the report accounts for every reviewed combination.
function knownOutOfScopeReflectionCombinations() {
  return [
    { courseTheme: 'english-connect-1', featureKey: FEATURE_KEYS.knowMe, reason: 'template_shows_know_me_false' },
    { courseTheme: 'english-connect-2', featureKey: FEATURE_KEYS.knowMe, reason: 'template_shows_know_me_false' },
    { courseTheme: 'supermarket', featureKey: FEATURE_KEYS.knowMe, reason: 'template_does_not_expose_know_me' },
    { courseTheme: 'work-n-jobs', featureKey: FEATURE_KEYS.knowMe, reason: 'chapter_content_mapping_mismatch' },
    { courseTheme: 'household', featureKey: FEATURE_KEYS.knowMe, reason: 'no_survey_content_and_no_template_exposure' },
  ];
}

export function buildManifests({ publishedAt } = {}) {
  const sources = loadSources();
  const report = { included: [], excluded: [] };

  const items = [
    ...buildVocabularyItems(sources, report),
    ...buildMeditacionesReflectionItems(sources, report),
    ...buildSpeechesReflectionItems(sources, report),
  ];

  for (const combo of knownOutOfScopeReflectionCombinations()) {
    report.excluded.push(combo);
  }

  const contentCapabilitiesManifest = {
    schemaVersion: SCHEMA_VERSION,
    manifestKey: MANIFEST_KEY,
    manifestVersion: '2026.09.28-1',
    publishedAt: publishedAt || '2026-09-28T00:00:00.000Z',
    sourceAudit: {
      auditedOn: '2026-09-28',
      sources: [
        'titulino-bucket/titulino-spine-data/quizlet-pratice-data.json',
        'titulino-bucket/titulino-spine-data/know-me-survey-data.json',
        'titulino-bucket/titulino-spine-data/course-progress-data.json',
      ],
      note:
        'Content existence verified against the exact deployed UI lookup mechanisms (QuizletService ' +
        'row-index bounds; LrnManager theme+chapter key lookup) against the local repository checkout, ' +
        'not a live production/GCS audit. Re-run bucket-scripts/generate-learning-reminder-manifest.js ' +
        'against the deployed bucket contents before publishing to detect drift.',
    },
    items,
  };

  const scheduleAnchors = buildScheduleAnchors(sources);
  const notificationPolicy = buildNotificationPolicy(sources);

  return { contentCapabilitiesManifest, scheduleAnchors, notificationPolicy, report };
}

// --- Schedule anchors (next-applicable-chapter boundary for expiry capping) ------------------
//
// "Next applicable" is defined chronologically (the next distinct availableDate after this
// chapter's own date among the included chapters), NOT by classNumber+1. Course-progress data is
// not guaranteed to have classNumber and availableDate move in the same order (see the
// English Connect 1 category-2 finding below, where chapter 2 is dated before chapter 1) --
// deriving "next" from row/class order instead of the actual date would silently invent a
// boundary the source data does not support.
function buildAnchorChapterList(themeSchedule, categoryId, chapterNumbers, warnings, warningContext) {
  const byClass = displayedLessonsByClassNumber(themeSchedule, categoryId);
  const sortedByChapterNumber = [...byClass.keys()].sort((a, b) => a - b);
  const included = chapterNumbers ? sortedByChapterNumber.filter((c) => chapterNumbers.has(c)) : sortedByChapterNumber;

  const withDates = included.map((chapterNumber) => ({
    chapterNumber,
    sourceAvailableOn: parseMmDdYyyyToIso(byClass.get(chapterNumber)[0].availableDate),
  }));
  const sortedDates = [...new Set(withDates.map((c) => c.sourceAvailableOn))].sort();

  // Flag (not silently fix) any case where chapter-number order disagrees with date order.
  for (let i = 1; i < withDates.length; i++) {
    if (withDates[i].sourceAvailableOn < withDates[i - 1].sourceAvailableOn) {
      warnings.push({
        ...warningContext,
        reason: 'chapter_number_and_available_date_out_of_order',
        detail: `chapter ${withDates[i - 1].chapterNumber} (${withDates[i - 1].sourceAvailableOn}) is dated after chapter ${withDates[i].chapterNumber} (${withDates[i].sourceAvailableOn})`,
      });
    }
  }

  return withDates.map(({ chapterNumber, sourceAvailableOn }) => {
    const nextDate = sortedDates.find((d) => d > sourceAvailableOn) ?? null;
    return { chapterNumber, sourceAvailableOn, nextAvailableOn: nextDate };
  });
}

function buildScheduleAnchors(sources) {
  const ec1Schedule = findThemeSchedule(sources.courseProgress, 'english-connect-1');
  const medSchedule = findThemeSchedule(sources.courseProgress, 'meditaciones');
  const spSchedule = findThemeSchedule(sources.courseProgress, 'speeches');
  const dataQualityWarnings = [];

  const anchors = [
    {
      courseTheme: 'english-connect-1', ruleKey: RULE_KEYS.vocabularyReview, sourceCategoryId: 2,
      chapters: buildAnchorChapterList(ec1Schedule, 2, null, dataQualityWarnings, { courseTheme: 'english-connect-1', sourceCategoryId: 2 }),
    },
    {
      courseTheme: 'meditaciones', ruleKey: RULE_KEYS.knowMeReflection, sourceCategoryId: 2,
      chapters: buildAnchorChapterList(medSchedule, 2, null, dataQualityWarnings, { courseTheme: 'meditaciones', sourceCategoryId: 2 }),
    },
    {
      courseTheme: 'speeches', ruleKey: RULE_KEYS.knowMeReflection, sourceCategoryId: 1,
      chapters: buildAnchorChapterList(spSchedule, 1, new Set([1, 3, 5, 7, 9, 11]), dataQualityWarnings, { courseTheme: 'speeches', sourceCategoryId: 1 }),
    },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    manifestVersion: '2026.09.28-1',
    scheduleSource: 'titulino-bucket/titulino-spine-data/course-progress-data.json',
    scheduleObservedAt: '2026-09-28T00:00:00.000Z',
    cohortCalendarLimitations: [
      {
        courseTheme: 'english-connect-1',
        courseCodeIds: ['ENGLISH_CONNECT_1_JUL_2026_COURSE_01', 'ENGLISHCONNECT_01_JUN_2025_COURSE_02'],
        limitation:
          'The schedule anchor below is theme-level (course-progress-data.json has one schedule per theme). ' +
          'These two concrete CourseCodeIds have not been verified to share the same weekly calendar -- ' +
          'COURSE_02 enrolled roughly a year before COURSE_01. Do not assume identical dueOn/expiry across ' +
          'both course codes until a per-cohort schedule binding is confirmed; initially restrict rollout to ' +
          'one verified cohort or add an explicit override before enabling both.',
      },
    ],
    dataQualityWarnings,
    anchors,
  };
}

// --- Notification policy (additive; does not modify course-progress-data.json) ---------------

function buildNotificationPolicy() {
  return {
    schemaVersion: SCHEMA_VERSION,
    policyVersion: '2026.09.28-1',
    note:
      'Additive policy over course-progress-data.json. Visibility (isToDisplay) is necessary but not ' +
      'sufficient for a notification: this file is the explicit, separate signal for whether a category ' +
      '(or a category-4/class-0 activity) is notification-worthy. Category number is not itself a semantic ' +
      'activity type and must never be inferred.',
    categoryPolicies: [
      {
        categoryId: 1, enabled: true, activityKind: null,
        note: 'Preserve existing course-progress availability behavior (Gatherings/Reuniones).',
      },
      {
        categoryId: 2, enabled: true, activityKind: null,
        note: 'Preserve existing course-progress availability behavior (Grammar/Recorded Classes/Conóceme). Category 2 vocabulary/reflection reminders are governed separately by content-capabilities-manifest.json + RuleDefinition, not by this flag.',
      },
    ],
    categoryClassZeroPolicies: [
      {
        courseTheme: 'supermarket', categoryId: 4, classNumber: 0, enabled: true, activityKind: 'assessment',
        requiresInternalTarget: true, internalTargetVerifiedOn: '2026-09-28',
        note: 'Internal target verified present in course-progress-data.json (links.internal non-null).',
      },
      {
        courseTheme: 'household', categoryId: 4, classNumber: 0, enabled: true, activityKind: 'assessment',
        requiresInternalTarget: true, internalTargetVerifiedOn: '2026-09-28',
        note: 'Internal target verified present in course-progress-data.json (links.internal non-null).',
      },
      {
        courseTheme: 'meditaciones', categoryId: 4, classNumber: 0, enabled: true, activityKind: 'reflection',
        requiresInternalTarget: true, internalTargetVerifiedOn: '2026-09-28',
        note: 'Internal target verified present in course-progress-data.json (links.internal non-null).',
      },
      {
        courseTheme: 'work-n-jobs', categoryId: 4, classNumber: 0, enabled: false, activityKind: 'assessment',
        requiresInternalTarget: true, reason: 'missing_internal_target',
        note: 'links.internal is null in course-progress-data.json. Do not enable until a reviewed internal target is published.',
      },
      {
        courseTheme: 'speeches', categoryId: 4, classNumber: 0, enabled: false, activityKind: 'assessment',
        requiresInternalTarget: true, reason: 'missing_internal_target',
        note: 'links.internal is null in course-progress-data.json. Do not enable until a reviewed internal target is published.',
      },
    ],
    presentationRules: {
      neverRenderClassZeroAsStudentFacingCopy: true,
      neutralGroupedCopyWhenMixedActivityKinds: true,
    },
  };
}
