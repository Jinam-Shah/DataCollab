const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const agentController = require('../controllers/agentController');
const { llmRateLimit } = require('../middleware/rateLimit');

router.use(authMiddleware);

router.post('/ask', llmRateLimit(), agentController.ask);
router.get('/runs', agentController.listRuns);
router.get('/runs/:id', agentController.getRun);

module.exports = router;
