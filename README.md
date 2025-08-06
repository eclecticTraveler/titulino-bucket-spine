# Titulino Bucket Spine

This project manages uploading files to a Google Cloud Storage bucket (`titulino-bucket`) using Node.js. 
It includes a recursive uploader that only uploads changed files based on their last modified time.
This files vary from email templates, messages, map files, json data that are public in the bucket and are consumed
by Titulino.com and also the Missive Project (Net).
---

## 📁 Project Structure

titulino-bucket-spine/
├── bucket-scripts/
│ ├── upload.js
│ └── upload-modded-files.js
