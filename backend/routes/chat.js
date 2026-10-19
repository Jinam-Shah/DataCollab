const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const chatController = require('../controllers/chatController');

router.use(authMiddleware);

router.get('/messages', chatController.getMessages);
router.post('/messages', chatController.sendMessage);

module.exports = router;
