import { fileURLToPath } from 'url';
import { dirname, join, relative, resolve } from 'path';
import { readdirSync, statSync, existsSync } from 'fs';
import { Storage } from '@google-cloud/storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isGitHubAction = process.env.GITHUB_ACTIONS === 'true';
console.log("------>isGitHubAction", isGitHubAction);

const pathToKey = join(__dirname, 'certain-upgrade-341601-6db30a4e61b5.json');
const useExplicitKey = !isGitHubAction && existsSync(pathToKey);

const storage = useExplicitKey
  ? new Storage({ keyFilename: pathToKey })
  : new Storage();

const bucketName = 'titulino-bucket';

async function getRemoteFiles() {
  const [files] = await storage.bucket(bucketName).getFiles();
  const remoteFiles = {};
  files.forEach(file => {
    remoteFiles[file.name] = new Date(file.metadata.updated).getTime();
  });
  return remoteFiles;
}

async function uploadDirectory(directory, remoteFiles) {
  const files = readdirSync(directory);

  for (const file of files) {
    const filePath = join(directory, file);
    let destination = relative(join(directory, '..'), filePath).replace(/\\/g, '/');

    if (statSync(filePath).isDirectory()) {
      await uploadDirectory(filePath, remoteFiles);
    } else {
      const localModifiedTime = statSync(filePath).mtime.getTime();

      if (!remoteFiles[destination] || localModifiedTime > remoteFiles[destination]) {
        console.log(`Uploading ${filePath} to gs://${bucketName}/${destination}...`);
        await storage.bucket(bucketName).upload(filePath, {
          destination,
          metadata: { cacheControl: 'no-cache' },
        });
        console.log(`Upload completed for ${filePath}`);
      }
    }
  }
}

async function main() {
  try {
    console.log('Fetching remote files metadata...');
    const remoteFiles = await getRemoteFiles();
    const uploadDir = resolve('./titulino-bucket');
    await uploadDirectory(uploadDir, remoteFiles);
  } catch (err) {
    console.error('Error uploading files:', err);
  }
}

main();
