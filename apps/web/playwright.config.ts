import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3310',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @realty/api dev',
      url: 'http://127.0.0.1:4410/ready',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://app:app@127.0.0.1:5432/realty',
        PORT: '4410',
        NODE_ENV: 'test',
        JWT_SECRET: 'playwright-only-secret-with-at-least-thirty-two-characters',
        ACCOUNT_TOKEN_SECRET: 'playwright-only-account-token-secret-with-enough-entropy',
        CORS_ORIGINS: 'http://localhost:3310'
      }
    },
    {
      command: 'pnpm --filter @realty/web dev',
      url: 'http://localhost:3310',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_INTERNAL_URL: 'http://127.0.0.1:4410', PORT: '3310' }
    }
  ]
});
