const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const tokenController = require('../controllers/tokenController');

router.use(authMiddleware);

router.post('/', tokenController.create);
router.get('/', tokenController.list);
router.delete('/:id', tokenController.revoke);

module.exports = router;
