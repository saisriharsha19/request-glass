import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  use: { baseURL: "http://127.0.0.1:3210", headless: true },
  webServer: {
    command: "HOST=127.0.0.1 PORT=3210 bun run server.ts",
    url: "http://127.0.0.1:3210/healthz",
    reuseExistingServer: false,
  },
  reporter: "list",
});
