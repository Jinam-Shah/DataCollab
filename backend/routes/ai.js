const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const aiController = require('../controllers/aiController');
const { llmRateLimit } = require('../middleware/rateLimit');

router.use(authMiddleware);

router.post('/text-to-sql', llmRateLimit(), aiController.textToSQL);

module.exports = router;
