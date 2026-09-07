import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  outputDir: process.env.TMPDIR ? `${process.env.TMPDIR}/concierge-voice-browser-results` : 'test-results',
  use: {
    ...devices['iPhone 13'],
    browserName: 'chromium',
    baseURL: process.env.VOICE_TEST_URL || 'http://127.0.0.1:4188/os3-concierge/',
    launchOptions: process.env.VOICE_TEST_CHROME ? { executablePath: process.env.VOICE_TEST_CHROME } : {},
  },
  webServer: process.env.VOICE_TEST_URL ? undefined : {
    command: 'npm run preview -- --host 127.0.0.1 --port 4188 --strictPort',
    url: 'http://127.0.0.1:4188/os3-concierge/',
    reuseExistingServer: false,
  },
})
