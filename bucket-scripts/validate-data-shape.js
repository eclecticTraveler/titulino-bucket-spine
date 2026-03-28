import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataRoot = resolve(__dirname, '../titulino-bucket/titulino-spine-data');

function collectJsonFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(entryPath));
      continue;
    }

    if (entry.isFile() && extname(entry.name).toLowerCase() === '.json') {
      files.push(entryPath);
    }
  }

  return files;
}

function describePath(pathParts) {
  if (pathParts.length === 0) {
    return '$';
  }

  return `$${pathParts.reduce((result, part) => {
    if (part.startsWith('[')) {
      return `${result}${part}`;
    }

    return `${result}.${part}`;
  }, '')}`;
}

function validateNode(node, pathParts, filePath, errors) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => validateNode(item, [...pathParts, `[${index}]`], filePath, errors));
    return;
  }

  if (!node || typeof node !== 'object') {
    return;
  }

  const hasNativeLanguage = Object.prototype.hasOwnProperty.call(node, 'nativeLanguage');
  const hasCourse = Object.prototype.hasOwnProperty.call(node, 'course');
  const hasBaseLanguages = Object.prototype.hasOwnProperty.call(node, 'baseLanguages');
  const hasContentLanguageCode = Object.prototype.hasOwnProperty.call(node, 'contentLanguageCode');
  const nodePath = describePath(pathParts);

  if (hasNativeLanguage) {
    errors.push(`${filePath}: ${nodePath} still uses nativeLanguage`);
  }

  if (hasCourse) {
    errors.push(`${filePath}: ${nodePath} still uses course`);
  }

  if (hasBaseLanguages) {
    const { baseLanguages } = node;
    const isValidBaseLanguages =
      Array.isArray(baseLanguages) &&
      baseLanguages.length > 0 &&
      baseLanguages.every((value) => typeof value === 'string' && value.trim().length > 0);

    if (!isValidBaseLanguages) {
      errors.push(`${filePath}: ${nodePath}.baseLanguages must be a non-empty array of strings`);
    }
  }

  if (hasContentLanguageCode) {
    if (typeof node.contentLanguageCode !== 'string' || node.contentLanguageCode.trim().length === 0) {
      errors.push(`${filePath}: ${nodePath}.contentLanguageCode must be a non-empty string`);
    }
  }

  if (hasBaseLanguages !== hasContentLanguageCode) {
    errors.push(
      `${filePath}: ${nodePath} must define baseLanguages and contentLanguageCode together`
    );
  }

  Object.entries(node).forEach(([key, value]) => {
    validateNode(value, [...pathParts, key], filePath, errors);
  });
}

function main() {
  if (!statSync(dataRoot).isDirectory()) {
    throw new Error(`Data directory not found: ${dataRoot}`);
  }

  const jsonFiles = collectJsonFiles(dataRoot);
  const errors = [];

  for (const filePath of jsonFiles) {
    const contents = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(contents);
    validateNode(parsed, [], filePath, errors);
  }

  if (errors.length > 0) {
    console.error('Data shape validation failed:\n');
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log(`Validated ${jsonFiles.length} JSON files. No legacy language metadata keys found.`);
}

main();
