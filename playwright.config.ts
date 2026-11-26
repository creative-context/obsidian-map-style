import {defineConfig, devices} from '@playwright/test';

/**
 * The demo's browser test: every control, every state, at the sizes the demo
 * is used at. Screenshots of each state land in test-results/demo/.
 */
const PORT = 5174;

export default defineConfig({
  testDir: 'test',
  testMatch: '*.spec.ts',
  outputDir: 'test-results/playwright',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: {timeout: 15_000},
  use: {
    baseURL: `http://localhost:${PORT}`,
    // WebGL in headless Chromium, with or without a GPU.
    launchOptions: {args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']},
  },
  projects: [
    // A desktop browser window.
    {name: 'desktop', use: {...devices['Desktop Chrome'], viewport: {width: 1440, height: 900}}},
    {name: 'small-laptop', use: {...devices['Desktop Chrome'], viewport: {width: 1280, height: 720}}},
    {name: 'phone', use: {...devices['Pixel 7']}},
  ],
  // The production build, as GitHub Pages serves it.
  webServer: {
    // Built into test-results/, so the Pages build in demo/dist is left alone.
    command: `bunx vite build demo --outDir ../test-results/demo-build --emptyOutDir && bunx vite preview demo --outDir ../test-results/demo-build --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
