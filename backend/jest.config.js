module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.(t|j)sx?$': ['@swc/jest'] },
  testMatch: ['**/tests/**/*.test.(js|ts)'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  collectCoverageFrom: [
    '**/*.{js,ts}',
    '!**/node_modules/**',
    '!dist/**',
    '!coverage/**',
    '!tests/**',
    '!*.config.js',
    '!scripts/**',
    '!eval/**',
  ],
};
