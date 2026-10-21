const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const authMiddleware = require('../middleware/auth');
const fileController = require('../controllers/fileController');

const { UPLOAD_DIR } = require('../config/paths');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 50);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'csv-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

// All routes require authentication
router.use(authMiddleware);

// Upload CSV file
router.post('/upload', upload.single('file'), fileController.uploadCSV);

// Get all files
router.get('/', fileController.getFiles);

// Get file details
router.get('/:id', fileController.getFileDetails);

// Browse all rows, paginated
router.get('/:id/rows', fileController.getRows);

// Download the table as CSV
router.get('/:id/download', fileController.downloadCsv);

// Delete file
router.delete('/:id', fileController.deleteFile);

module.exports = router;
