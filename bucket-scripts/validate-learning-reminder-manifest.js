// Repeatable validator for the Phase 2 learning-reminder manifests.
//
// Checks performed:
//   1. Schema/contract validation of the three committed manifest files (mirrors the deployed
//      warehouse CHECK constraints and replace_learning_content_capabilities parsing rules).
//   2. Drift detection: recomputes the manifests fresh from the verified spine data sources and
//      deep-compares them against the committed files, so a published capability that no longer
//      corresponds to content the deployed UI actually loads is reported, not silently kept.
//   3. Fixture suite: every __fixtures__/learning-reminders/valid-*.json must pass, every
//      invalid-*.json must fail (this proves the validator actually rejects bad input, not just
//      that it accepts the real manifest).
//
// Usage: node bucket-scripts/validate-learning-reminder-manifest.js
// Exit code 0 = all checks passed. Non-zero = at least one failure (see stderr).

import { readFileSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { buildManifests, DATA_ROOT } from './lib/learningReminderContent.mjs';
import {
  validateContentCapabilitiesManifest,
  validateScheduleAnchors,
  validateNotificationPolicy,
} from './lib/validateLearningReminderContent.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const MANIFEST_DIR = join(DATA_ROOT, 'learning-reminders');
const FIXTURES_DIR = join(__dirname, '__fixtures__', 'learning-reminders');

let failures = 0;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function report(label, errors) {
  if (errors.length === 0) {
    console.log(`OK   ${label}`);
    return;
  }
  failures += errors.length;
  console.error(`FAIL ${label} (${errors.length} issue${errors.length === 1 ? '' : 's'})`);
  for (const e of errors) console.error(`     - ${e}`);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffPaths(a, b, path, out) {
  if (deepEqual(a, b)) return;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && typeof a[0] === 'object') {
    for (let i = 0; i < a.length; i++) diffPaths(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diffPaths(a[k], b[k], `${path}.${k}`, out);
    return;
  }
  out.push(`${path}: committed=${JSON.stringify(a)} recomputed=${JSON.stringify(b)}`);
}

function validateCommittedManifests() {
  let committed;
  try {
    committed = {
      contentCapabilitiesManifest: readJson(join(MANIFEST_DIR, 'content-capabilities-manifest.json')),
      scheduleAnchors: readJson(join(MANIFEST_DIR, 'schedule-anchors.json')),
      notificationPolicy: readJson(join(MANIFEST_DIR, 'notification-policy.json')),
    };
  } catch (err) {
    report('load committed manifest files', [`could not read committed manifests: ${err.message}. Run generate-learning-reminder-manifest.js first.`]);
    return;
  }

  report('content-capabilities-manifest.json contract', validateContentCapabilitiesManifest(committed.contentCapabilitiesManifest));
  report('schedule-anchors.json contract', validateScheduleAnchors(committed.scheduleAnchors));
  report('notification-policy.json contract', validateNotificationPolicy(committed.notificationPolicy));

  const recomputed = buildManifests({ publishedAt: committed.contentCapabilitiesManifest.publishedAt });
  const diffs = [];
  diffPaths(committed.contentCapabilitiesManifest.items, recomputed.contentCapabilitiesManifest.items, 'items', diffs);
  diffPaths(committed.scheduleAnchors.anchors, recomputed.scheduleAnchors.anchors, 'anchors', diffs);
  report(
    'drift check: committed manifest matches what the verified sources currently produce',
    diffs.length > 0
      ? [...diffs, 'Source data changed since the manifest was generated. Re-run generate-learning-reminder-manifest.js and review the diff before publishing.']
      : []
  );
}

function validateFixtures() {
  let entries;
  try {
    entries = readdirSync(FIXTURES_DIR);
  } catch {
    report('fixtures directory', [`missing ${FIXTURES_DIR}`]);
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const path = join(FIXTURES_DIR, entry);
    const doc = readJson(path);
    const errors = validateContentCapabilitiesManifest(doc);
    const shouldBeValid = entry.startsWith('valid-');
    const shouldBeInvalid = entry.startsWith('invalid-');

    if (!shouldBeValid && !shouldBeInvalid) {
      report(`fixture naming: ${entry}`, [`fixture files must be named valid-*.json or invalid-*.json`]);
      continue;
    }
    if (shouldBeValid && errors.length > 0) {
      report(`fixture ${entry} (expected valid)`, errors);
    } else if (shouldBeInvalid && errors.length === 0) {
      report(`fixture ${entry} (expected invalid)`, [`validator accepted a fixture that must be rejected`]);
    } else {
      console.log(`OK   fixture ${entry} (${shouldBeValid ? 'accepted as valid' : `rejected: ${errors[0]}`})`);
    }
  }
}

function main() {
  console.log(`Validating manifests in ${MANIFEST_DIR}`);
  validateCommittedManifests();
  console.log('');
  console.log(`Validating fixtures in ${FIXTURES_DIR}`);
  validateFixtures();
  console.log('');
  if (failures > 0) {
    console.error(`${failures} validation issue(s) found.`);
    process.exitCode = 1;
  } else {
    console.log('All learning-reminder manifest checks passed.');
  }
}

main();
