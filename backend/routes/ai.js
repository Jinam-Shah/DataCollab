const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const aiController = require('../controllers/aiController');

router.use(authMiddleware);

router.post('/text-to-sql', aiController.textToSQL);

module.exports = router;