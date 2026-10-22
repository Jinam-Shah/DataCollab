const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const workspaceController = require('../controllers/workspaceController');

router.use(authMiddleware);

router.get('/', workspaceController.get);
router.post('/invite-code', workspaceController.rotateInvite);

module.exports = router;
