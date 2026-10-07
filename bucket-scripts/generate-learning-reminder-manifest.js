// Regenerates the Phase 2 learning-reminder manifests from the verified spine data sources.
// Run this whenever quizlet-pratice-data.json, know-me-survey-data.json, or
// course-progress-data.json change, then re-run validate-learning-reminder-manifest.js and
// review the diff before committing.
//
// Usage: node bucket-scripts/generate-learning-reminder-manifest.js

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { buildManifests, DATA_ROOT } from './lib/learningReminderContent.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const OUTPUT_DIR = join(DATA_ROOT, 'learning-reminders');
const REPORT_PATH = join(repoRoot, 'docs', 'learning-reminders', 'mapping-report.md');

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function renderReport(report, manifest, scheduleAnchors) {
  const lines = [];
  lines.push('# Learning reminder content-capability mapping report');
  lines.push('');
  lines.push(`Generated from \`bucket-scripts/generate-learning-reminder-manifest.js\` on ${manifest.sourceAudit.auditedOn}.`);
  lines.push('Regenerate this file instead of hand-editing it — it is derived output, not source data.');
  lines.push('');
  lines.push('## Included (published as `isAvailable: true`)');
  lines.push('');
  lines.push('| Course theme | Feature key | Chapter | Content lang | Native lang | Rule | Source category |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const row of report.included.sort((a, b) => a.courseTheme.localeCompare(b.courseTheme) || a.chapterNumber - b.chapterNumber)) {
    lines.push(`| ${row.courseTheme} | ${row.featureKey} | ${row.chapterNumber} | ${row.contentLanguageCode || '-'} | ${row.nativeLanguageCode || '-'} | ${row.ruleKey} | ${row.sourceCategoryId} |`);
  }
  lines.push('');
  lines.push('## Excluded / not published, with reason');
  lines.push('');
  lines.push('| Course theme | Feature key | Chapter | Reason |');
  lines.push('|---|---|---|---|');
  for (const row of report.excluded) {
    lines.push(`| ${row.courseTheme} | ${row.featureKey} | ${row.chapterNumber ?? '(all)'} | ${row.reason} |`);
  }
  lines.push('');
  lines.push('## Cohort/calendar limitations');
  lines.push('');
  for (const lim of scheduleAnchors.cohortCalendarLimitations) {
    lines.push(`- **${lim.courseTheme}** (${lim.courseCodeIds.join(', ')}): ${lim.limitation}`);
  }
  lines.push('');
  lines.push('## Schedule data-quality warnings');
  lines.push('');
  if (scheduleAnchors.dataQualityWarnings.length === 0) {
    lines.push('None found for the themes/categories covered by this manifest.');
  } else {
    lines.push('These are reported, not silently corrected — the underlying schedule dates are left as-is.');
    lines.push('');
    for (const w of scheduleAnchors.dataQualityWarnings) {
      lines.push(`- **${w.courseTheme}** category ${w.sourceCategoryId}: ${w.reason} — ${w.detail}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const { contentCapabilitiesManifest, scheduleAnchors, notificationPolicy, report } = buildManifests();

  writeJson(join(OUTPUT_DIR, 'content-capabilities-manifest.json'), contentCapabilitiesManifest);
  writeJson(join(OUTPUT_DIR, 'schedule-anchors.json'), scheduleAnchors);
  writeJson(join(OUTPUT_DIR, 'notification-policy.json'), notificationPolicy);

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, renderReport(report, contentCapabilitiesManifest, scheduleAnchors), 'utf8');

  console.log(`Wrote ${contentCapabilitiesManifest.items.length} content-capability items.`);
  console.log(`Included: ${report.included.length}. Excluded: ${report.excluded.length}.`);
  console.log(`Report: ${REPORT_PATH}`);
}

main();
