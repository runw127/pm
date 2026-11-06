import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: externalBaseURL ?? "http://127.0.0.1:8123",
    trace: "retain-on-failure",
  },
  // Without PLAYWRIGHT_BASE_URL, build the static site and serve it from the real FastAPI
  // backend with a fresh SQLite database, so browser tests exercise the full stack.
  webServer: externalBaseURL ? undefined : {
    command:
      "rm -rf .e2e-data && npm run build && cd ../backend && " +
      "OPENROUTER_API_KEY= PM_DATA_DIR=../frontend/.e2e-data PM_FRONTEND_DIR=../frontend/out " +
      "uv run uvicorn app.main:default_app --factory --host 127.0.0.1 --port 8123",
    url: "http://127.0.0.1:8123/api/hello",
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
