import { defineConfig, devices } from "@playwright/test";

// Mode 2 — smoke tests against the LIVE published site (staging or prod).
// These verify real Webflow markup + live CMS data + the published loader
// bundle together — the things jsdom unit tests can't see (visibility, the
// custom select, CMS-driven options). They do NOT submit real leads.
//
// One spec writes data: uploads.spec.js drives the real file picker and POSTs
// to the Cloudflare Worker, storing two ~200-byte test JPEGs in R2 per run.
// It is the only test of that path, so it stays in the default run. Every
// object lands under the reference prefix AUTOMATEDTEST- (the spec asserts
// this), so test uploads can be found by prefix.
//
// Target is configurable so the same specs can point at staging or prod:
//   SMOKE_BASE_URL=https://www.suttonsandrobertsons.com npm run test:e2e
const BASE_URL =
  process.env.SMOKE_BASE_URL || "https://suttonsandrobertsons.webflow.io";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // Live pages depend on network + publish state, so allow one retry and keep
  // a trace on the retry for debugging flakes.
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
