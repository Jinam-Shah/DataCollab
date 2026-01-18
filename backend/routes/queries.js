const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const queryController = require('../controllers/queryController');

// All routes require authentication
router.use(authMiddleware);

// Execute SQL query
router.post('/execute', queryController.executeQuery);

// Get table schema
router.get('/schema/:tableName', queryController.getTableSchema);

// Get sample queries for a file
router.get('/samples/:fileId', queryController.getSampleQueries);

module.exports = router;