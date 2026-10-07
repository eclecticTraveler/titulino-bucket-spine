// Pure validation rules for the learning-reminder manifests. Mirrors, wherever possible, the
// exact CHECK constraints and parsing rules in the deployed (but not yet staged/pushed) warehouse
// migrations so a manifest that passes here will also be accepted by
// "Notification".replace_learning_content_capabilities:
//   titulino-warehouse/deploy/Notification/2026/09/28_learning_reminder_tables.sql
//   titulino-warehouse/deploy/Notification/2026/09/28_learning_reminder_functions.sql
//
// This module has no side effects (no fs/process) so it can be exercised against fixtures.

const KNOWN_COURSE_THEMES = new Set(['english-connect-1', 'meditaciones', 'speeches']);
const KNOWN_FEATURE_KEYS = new Set(['course-feature.submenu.quizlet', 'course-feature.submenu.know-me']);
const KNOWN_TARGET_KINDS = new Set(['course-feature']);
const KNOWN_SOURCE_CATEGORY_IDS = new Set([1, 2, 4]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRelativePathValid(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  if (value.includes('://')) return false;
  return true;
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && value.includes('T');
}

function containsUrlLike(node, path, errors) {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    if (/https?:\/\//i.test(node) || /titulino\.com/i.test(node)) {
      errors.push(`${path}: must not contain an absolute URL or titulino.com host ("${node}")`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => containsUrlLike(v, `${path}[${i}]`, errors));
    return;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) containsUrlLike(v, `${path}.${k}`, errors);
  }
}

export function validateContentCapabilitiesManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return ['manifest must be an object'];
  }

  if (!isNonEmptyString(manifest.schemaVersion)) errors.push('schemaVersion is required');
  if (!isNonEmptyString(manifest.manifestKey)) errors.push('manifestKey is required');
  if (!isNonEmptyString(manifest.manifestVersion)) errors.push('manifestVersion is required');
  if (!isIsoTimestamp(manifest.publishedAt)) errors.push('publishedAt must be an ISO timestamp');

  if (!Array.isArray(manifest.items)) {
    errors.push('items must be an array');
    return errors;
  }
  if (manifest.items.length > 5000) errors.push('items must not exceed 5000 entries (DB request limit)');

  const identitySeen = new Set();

  manifest.items.forEach((item, index) => {
    const p = `items[${index}]`;
    if (!item || typeof item !== 'object') { errors.push(`${p} must be an object`); return; }

    if (!isNonEmptyString(item.courseTheme)) errors.push(`${p}.courseTheme is required`);
    else if (!KNOWN_COURSE_THEMES.has(item.courseTheme)) {
      errors.push(`${p}.courseTheme "${item.courseTheme}" is not one of the reviewed themes (${[...KNOWN_COURSE_THEMES].join(', ')}); add it deliberately, do not invent a mapping`);
    }

    if (item.courseCodeId !== null && item.courseCodeId !== undefined && !isNonEmptyString(item.courseCodeId)) {
      errors.push(`${p}.courseCodeId must be null or a non-empty string`);
    }

    if (!isNonEmptyString(item.featureKey)) errors.push(`${p}.featureKey is required`);
    else if (!KNOWN_FEATURE_KEYS.has(item.featureKey)) {
      errors.push(`${p}.featureKey "${item.featureKey}" is not a registered target feature key`);
    }

    const chapterOk = Number.isInteger(item.chapterNumber) && item.chapterNumber >= 0 && item.chapterNumber <= 100
      && /^[0-9]{1,3}$/.test(String(item.chapterNumber));
    if (!chapterOk) errors.push(`${p}.chapterNumber must be an integer 0-100 (got ${JSON.stringify(item.chapterNumber)})`);

    if (!isNonEmptyString(item.contentLanguageCode)) errors.push(`${p}.contentLanguageCode is required`);
    if (item.nativeLanguageCode !== undefined && !isNonEmptyString(item.nativeLanguageCode)) {
      errors.push(`${p}.nativeLanguageCode must be a non-empty string when present`);
    }
    if (Array.isArray(item.baseLanguages)) {
      if (item.baseLanguages.length === 0 || !item.baseLanguages.every(isNonEmptyString)) {
        errors.push(`${p}.baseLanguages must be a non-empty array of strings when present`);
      }
    }

    if (item.level !== undefined && (!Number.isInteger(item.level) || item.level < 0 || item.level > 10)) {
      errors.push(`${p}.level must be an integer 0-10 when present`);
    }

    if (item.targetKind !== undefined && !KNOWN_TARGET_KINDS.has(item.targetKind)) {
      errors.push(`${p}.targetKind must be one of ${[...KNOWN_TARGET_KINDS].join(', ')}`);
    }

    if (!isRelativePathValid(item.relativePath)) {
      errors.push(`${p}.relativePath must be null or start with "/" (not "//") and contain no "://"`);
    }

    if (item.isAvailable !== undefined && typeof item.isAvailable !== 'boolean') {
      errors.push(`${p}.isAvailable must be a boolean when present`);
    }

    if (item.metadata !== undefined && (typeof item.metadata !== 'object' || item.metadata === null || Array.isArray(item.metadata))) {
      errors.push(`${p}.metadata must be an object when present`);
    } else if (item.metadata && item.metadata.sourceCategoryId !== undefined
      && !KNOWN_SOURCE_CATEGORY_IDS.has(item.metadata.sourceCategoryId)) {
      errors.push(`${p}.metadata.sourceCategoryId "${item.metadata.sourceCategoryId}" is not an audited category id (${[...KNOWN_SOURCE_CATEGORY_IDS].join(', ')})`);
    }

    const identityKey = JSON.stringify([
      item.courseTheme, item.courseCodeId ?? '', item.featureKey, item.chapterNumber,
      item.contentLanguageCode, item.nativeLanguageCode ?? '*', item.level ?? 0,
    ]);
    if (identitySeen.has(identityKey)) {
      errors.push(`${p} duplicates the identity ${identityKey} (matches NotificationContentCapability_identity_uidx)`);
    }
    identitySeen.add(identityKey);
  });

  containsUrlLike(manifest.items, 'items', errors);
  return errors;
}

export function validateScheduleAnchors(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['schedule-anchors document must be an object'];
  if (!isNonEmptyString(doc.schemaVersion)) errors.push('schemaVersion is required');
  if (!isNonEmptyString(doc.manifestVersion)) errors.push('manifestVersion is required');
  if (doc.dataQualityWarnings !== undefined && !Array.isArray(doc.dataQualityWarnings)) {
    errors.push('dataQualityWarnings must be an array when present');
  }
  if (!Array.isArray(doc.anchors)) { errors.push('anchors must be an array'); return errors; }

  doc.anchors.forEach((anchor, ai) => {
    const p = `anchors[${ai}]`;
    if (!isNonEmptyString(anchor.courseTheme)) errors.push(`${p}.courseTheme is required`);
    if (!isNonEmptyString(anchor.ruleKey)) errors.push(`${p}.ruleKey is required`);
    if (!KNOWN_SOURCE_CATEGORY_IDS.has(anchor.sourceCategoryId)) errors.push(`${p}.sourceCategoryId is not an audited category id`);
    if (!Array.isArray(anchor.chapters)) { errors.push(`${p}.chapters must be an array`); return; }

    let previousChapter = -Infinity;
    anchor.chapters.forEach((ch, ci) => {
      const cp = `${p}.chapters[${ci}]`;
      if (!Number.isInteger(ch.chapterNumber) || ch.chapterNumber < 0) errors.push(`${cp}.chapterNumber must be a non-negative integer`);
      if (ch.chapterNumber <= previousChapter) errors.push(`${cp}.chapterNumber must be strictly ascending within an anchor`);
      previousChapter = ch.chapterNumber;
      if (!isIsoDate(ch.sourceAvailableOn)) errors.push(`${cp}.sourceAvailableOn must be an ISO YYYY-MM-DD date`);
      if (ch.nextAvailableOn !== null) {
        if (!isIsoDate(ch.nextAvailableOn)) errors.push(`${cp}.nextAvailableOn must be null or an ISO YYYY-MM-DD date`);
        else if (ch.nextAvailableOn <= ch.sourceAvailableOn) {
          errors.push(`${cp}.nextAvailableOn (${ch.nextAvailableOn}) must be strictly after sourceAvailableOn (${ch.sourceAvailableOn}), matching evaluate_learning_reminder_candidate's invalid_expiry_boundary check`);
        }
      }
    });
  });

  containsUrlLike(doc, 'schedule-anchors', errors);
  return errors;
}

export function validateNotificationPolicy(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['notification-policy document must be an object'];
  if (!isNonEmptyString(doc.schemaVersion)) errors.push('schemaVersion is required');
  if (!isNonEmptyString(doc.policyVersion)) errors.push('policyVersion is required');
  if (!Array.isArray(doc.categoryClassZeroPolicies)) { errors.push('categoryClassZeroPolicies must be an array'); return errors; }

  doc.categoryClassZeroPolicies.forEach((policy, i) => {
    const p = `categoryClassZeroPolicies[${i}]`;
    if (policy.categoryId !== 4) errors.push(`${p}.categoryId must be 4 (class-0 policy is only meaningful for category 4)`);
    if (policy.classNumber !== 0) errors.push(`${p}.classNumber must be 0`);
    if (policy.enabled && !['assessment', 'reflection'].includes(policy.activityKind)) {
      errors.push(`${p}: an enabled class-0 policy requires activityKind "assessment" or "reflection" (got ${JSON.stringify(policy.activityKind)})`);
    }
    if (policy.enabled && policy.requiresInternalTarget && !policy.internalTargetVerifiedOn) {
      errors.push(`${p}: enabled with requiresInternalTarget but no internalTargetVerifiedOn evidence`);
    }
    if (!policy.enabled && !policy.reason) {
      errors.push(`${p}: a disabled policy must record a reason`);
    }
  });

  containsUrlLike(doc, 'notification-policy', errors);
  return errors;
}
