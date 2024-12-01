const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');

// Initialize Google Cloud Storage
const storage = new Storage({ keyFilename: 'path/to/your/service-account-key.json' });
const bucketName = 'titulino-bucket';

async function uploadDirectory(directory) {
  const files = fs.readdirSync(directory);

  for (const file of files) {
    const filePath = path.join(directory, file);
    const destination = path.join(path.basename(directory), file); // Keeps the folder structure

    console.log(`Uploading ${filePath} to ${bucketName}/${destination}...`);
    await storage.bucket(bucketName).upload(filePath, { destination });
  }

  console.log('Upload complete!');
}

// Main function
async function main() {
  try {
    await uploadDirectory('./json-files');
    await uploadDirectory('./images');
  } catch (err) {
    console.error('Error uploading files:', err);
  }
}

main();
