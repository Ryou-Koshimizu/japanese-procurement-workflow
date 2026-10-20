import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3013',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    // Check the settled screens: with motion on, axe would measure text while
    // it is still tipping in. Reduce motion is also a supported mode (nothing
    // animates). The motion itself is checked by hand (docs/verification.md).
    reducedMotion: 'reduce',
    launchOptions: process.env.CHROMIUM_EXECUTABLE_PATH
      ? {
          executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
          args: ['--no-sandbox', '--disable-gpu'],
        }
      : undefined,
  },
  // The whole suite runs in Chromium and in WebKit (the Safari engine).
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], browserName: 'webkit' },
    },
  ],
  // E2E_BASE_URL points the tests at a server that is already running.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run start -- --port 3013',
        url: 'http://127.0.0.1:3013/login',
        reuseExistingServer: false,
        timeout: 240_000,
        env: { APP_MODE: 'demo' },
      },
});
