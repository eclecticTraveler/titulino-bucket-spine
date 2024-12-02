import { Storage } from '@google-cloud/storage';
import { join, relative } from 'path';
import { readdirSync, statSync } from 'fs';

// Initialize Google Cloud Storage with a relative path to the key file
const storage = new Storage({ keyFilename: './bucket-scripts/certain-upgrade-341601-6db30a4e61b5.json' });
const bucketName = 'titulino-bucket';

// Function to upload files from a directory (non-recursive approach)
async function uploadDirectory(directory) {
  const files = readdirSync(directory);

  for (const file of files) {
    const filePath = join(directory, file);
    const destination = relative(join(directory, '..'), filePath); // Maintain folder structure

    // Check if it's a directory or a file
    if (statSync(filePath).isDirectory()) {
      // If it's a directory, recursively call uploadDirectory
      await uploadDirectory(filePath);
    } else {
      // If it's a file, upload it with Cache-Control header
      console.log(`Uploading ${filePath} to ${bucketName}/${destination}...`);
      await storage.bucket(bucketName).upload(filePath, {
        destination,
        metadata: {
          cacheControl: 'no-cache', // Set Cache-Control header
        },
      });
    }
  }

  console.log('Upload complete!');
}

// Main function to trigger the upload
async function main() {
  try {
    // Specify the root directory where you want to upload everything
    await uploadDirectory('./titulino-bucket');
  } catch (err) {
    console.error('Error uploading files:', err);
  }
}

main();
