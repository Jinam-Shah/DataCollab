const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middleware/auth');
const documentController = require('../controllers/documentController');
const { documentKind } = require('../rag/parse');

const router = express.Router();

// Documents are parsed straight from memory; they are not kept on disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_DOCUMENT_MB || 20) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (documentKind(file.originalname)) cb(null, true);
    else cb(new Error('Only PDF, Markdown and TXT documents are supported'));
  },
});

router.use(authMiddleware);

router.post('/', upload.single('file'), documentController.upload);
router.get('/', documentController.list);
router.post('/search', documentController.search);
router.get('/:id', documentController.get);
router.get('/:id/chunks/:chunkId', documentController.getChunk);
router.delete('/:id', documentController.remove);

module.exports = router;
