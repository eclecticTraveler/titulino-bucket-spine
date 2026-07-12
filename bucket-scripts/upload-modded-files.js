import { Storage } from '@google-cloud/storage';
import { join, relative, resolve } from 'path';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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
    // md5Hash is base64-encoded, matches getLocalMd5Base64 below.
    remoteFiles[file.name] = file.metadata.md5Hash;
  });
  return remoteFiles;
}

function getLocalMd5Base64(filePath) {
  return createHash('md5').update(readFileSync(filePath)).digest('base64');
}

async function uploadDirectory(directory, remoteFiles) {
  const files = readdirSync(directory);

  for (const file of files) {
    const filePath = join(directory, file);    
    let destination = relative(resolve(__dirname, '../titulino-bucket'), filePath).replace(/\\/g, '/');

    if (statSync(filePath).isDirectory()) {
      await uploadDirectory(filePath, remoteFiles);
    } else {
      const localMd5 = getLocalMd5Base64(filePath);

      if (!remoteFiles[destination] || localMd5 !== remoteFiles[destination]) {
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
    await uploadDirectory(resolve(__dirname, '../titulino-bucket'), remoteFiles);
    console.log("Done uploading");
  } catch (err) {
    console.error('Error uploading files:', err);
  }
}

main();
