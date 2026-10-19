const fs = require('fs');
const path = require('path');

// Where multer stores uploads. The API and the worker must see the same directory.
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = { UPLOAD_DIR };
