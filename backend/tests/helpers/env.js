// Loaded by Jest before any test module, so config/database.js sees the test database.
const base =
  process.env.TEST_DATABASE_URL ||
  'postgresql://datacollab:datacollab@localhost:5432/datacollab_test';
const readerPassword = process.env.TEST_READER_PASSWORD || 'reader_test_pw';
const url = new URL(base);
const reader = new URL(base);
// Roles are shared by every database on the server, so tests use their own reader login.
reader.username = 'datacollab_test_reader';
reader.password = readerPassword;

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = url.toString();
process.env.DATABASE_READER_URL = reader.toString();
process.env.JWT_SECRET = 'test-secret';
process.env.QUERY_TIMEOUT_MS = process.env.QUERY_TIMEOUT_MS || '1000';
process.env.GEMINI_API_KEY = '';
process.env.INGEST_BACKOFF_MS = '10';
// Never inherit Redis from a developer's .env (dotenv does not override variables that are set).
process.env.REDIS_URL = '';
// A separate queue name, so a running development worker cannot pick up test jobs.
process.env.INGEST_QUEUE_NAME = 'csv-ingest-test';
