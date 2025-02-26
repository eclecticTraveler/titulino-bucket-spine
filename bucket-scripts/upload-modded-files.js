import { Storage } from '@google-cloud/storage';
import { join, relative } from 'path';
import { readdirSync, statSync } from 'fs';

// Initialize Google Cloud Storage with your credentials
const storage = new Storage({ keyFilename: './bucket-scripts/certain-upgrade-341601-6db30a4e61b5.json' });
const bucketName = 'titulino-bucket';

// Get remote files metadata
async function getRemoteFiles() {
  const [files] = await storage.bucket(bucketName).getFiles();
  const remoteFiles = {};
  files.forEach(file => {
    remoteFiles[file.name] = new Date(file.metadata.updated).getTime();
  });
  return remoteFiles;
}

// Function to upload files from a directory if modified
async function uploadDirectory(directory, remoteFiles) {
  const files = readdirSync(directory);

  for (const file of files) {
    const filePath = join(directory, file);
    let destination = relative(join(directory, '..'), filePath);
    destination = destination.replace(/\\/g, '/');

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
      } else {
        // console.log(`Skipping ${filePath}, no changes detected.`);        
      }
    }
  }
}

// Main function
async function main() {
  try {
    console.log('Fetching remote files metadata...');
    const remoteFiles = await getRemoteFiles();
    await uploadDirectory('./titulino-bucket', remoteFiles);
  } catch (err) {
    console.error('Error uploading files:', err);
  }
}

main();
