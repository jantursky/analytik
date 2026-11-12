import { defineConfig, devices } from '@playwright/test'

// Two servers:
// - `vite preview` serves the built demo exactly as the public demo runs, read-only. Every spec runs against it.
// - `vite` (dev) serves the same app with every write allowed. Only `*.dev.spec.ts` run against it, for flows that
//   save something, so the read-only specs can never change the data they read.
const previewPort = 4180
const devPort = 4181

const mobile = ['**/touch.spec.ts', '**/touch-size.spec.ts']
const writes = ['**/*.dev.spec.ts']

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${previewPort}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: [...writes, ...mobile] },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: [...writes, ...mobile] },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: [...writes, ...mobile] },
    // Flows that write, against the dev server.
    {
      name: 'dev',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${devPort}` },
      testMatch: writes,
    },
    // Touch smoke tests only; the rest of the suite is about layout and logic that do not depend on the device.
    { name: 'pixel-7', use: { ...devices['Pixel 7'] }, testMatch: mobile },
    { name: 'iphone-14', use: { ...devices['iPhone 14'] }, testMatch: mobile },
  ],
  webServer: [
    {
      command: `bunx vite preview --port ${previewPort} --strictPort`,
      port: previewPort,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `bunx vite --port ${devPort} --strictPort`,
      port: devPort,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
