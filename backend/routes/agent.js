const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const agentController = require('../controllers/agentController');

router.use(authMiddleware);

router.post('/ask', agentController.ask);
router.get('/runs', agentController.listRuns);
router.get('/runs/:id', agentController.getRun);

module.exports = router;
