import { defineConfig, devices } from "@playwright/test";

/**
 * Testes das telas (smoke): sobem os simuladores do Vision/Omie e a aplicação já compilada
 * (`npm run build` antes), com banco em memória e agendador desligado.
 *   npm run build && npm run test:e2e
 */
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3200);
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: APP_URL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npx tsx scripts/simulators/start.ts",
      port: 4020,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx next start -p ${APP_PORT}`,
      url: `${APP_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: "pglite:memory",
        VISION_API_URL: "http://127.0.0.1:4010/ControllerAPI",
        VISION_USERNAME: "OMIE",
        VISION_PASSWORD: "simulador",
        OMIE_API_URL: "http://127.0.0.1:4020/api/v1",
        OMIE_READ_CACHE_MS: "0",
        SCHEDULER_ENABLED: "false",
        OMIE_WEBHOOK_TOKEN: "token-e2e",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});
