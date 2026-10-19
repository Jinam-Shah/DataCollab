const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const queryController = require('../controllers/queryController');
const { queryRateLimit } = require('../middleware/rateLimit');

// All routes require authentication
router.use(authMiddleware);

// Execute SQL query
router.post('/execute', queryRateLimit(), queryController.executeQuery);

// Get table schema
router.get('/schema/:tableName', queryController.getTableSchema);

// Get sample queries for a file
router.get('/samples/:fileId', queryController.getSampleQueries);

module.exports = router;
