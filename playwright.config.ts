import { defineConfig, devices } from '@playwright/test';

/**
 * Test end-to-end contro un progetto Supabase di staging (vedi README, sezione "Test end-to-end").
 * Se E2E_BASE_URL e' impostata si testa quell'ambiente gia' in esecuzione; altrimenti Playwright
 * avvia l'app in locale (build + start in CI, `next dev` in locale).
 */
const externalUrl = process.env.E2E_BASE_URL;
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = externalUrl ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL,
    // L'interfaccia segue Accept-Language: i test usano i testi italiani.
    locale: 'it-IT',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], locale: 'it-IT', storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], locale: 'it-IT', storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  webServer: externalUrl
    ? undefined
    : {
        command: process.env.CI ? `npm run build && npm run start -- -p ${port}` : `npm run dev -- -p ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        env: {
          NEXT_PUBLIC_SITE_URL: baseURL,
          NEXT_TELEMETRY_DISABLED: '1',
        },
      },
});
