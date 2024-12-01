const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');

// Initialize Google Cloud Storage with a relative path to the key file
const storage = new Storage({ keyFilename: './bucket-scripts/certain-upgrade-341601-6db30a4e61b5.json' });
const bucketName = 'titulino-bucket';

// Function to recursively upload files from a directory
async function uploadDirectory(directory) {
  const files = fs.readdirSync(directory);

  for (const file of files) {
    const filePath = path.join(directory, file);

    // Check if it's a directory or a file
    if (fs.statSync(filePath).isDirectory()) {
      // If it's a directory, recursively call uploadDirectory
      await uploadDirectory(filePath);
    } else {
      // If it's a file, upload it
      const destination = path.relative(path.join(directory, '..'), filePath); // Maintain folder structure
      console.log(`Uploading ${filePath} to ${bucketName}/${destination}...`);
      await storage.bucket(bucketName).upload(filePath, { destination });
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
