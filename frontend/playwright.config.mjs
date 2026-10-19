import { defineConfig, devices } from '@playwright/test';

const API_PORT = 5055;
const WEB_PORT = 3055;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm --prefix ../backend run e2e:server',
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { E2E_API_PORT: String(API_PORT), E2E_FRONTEND_URL: `http://localhost:${WEB_PORT}` },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_API_URL: `http://localhost:${API_PORT}`,
        VITE_SOCKET_URL: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
