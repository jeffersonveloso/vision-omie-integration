import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { APP_URL, E2E_ADMIN, E2E_API_TOKEN, E2E_STORAGE } from "../playwright.config";

/**
 * 1. Mesma configuração de demonstração do `npm run demo:seed` (contas, regras, de-para e uma coleta),
 *    autenticada com o token de API.
 * 2. Entra pela tela de login como administrador e guarda a sessão para os testes.
 */
export default async function globalSetup(): Promise<void> {
  execFileSync("npx", ["tsx", "scripts/seed-demo.ts"], { env: { ...process.env, APP_URL, AUTH_API_TOKEN: E2E_API_TOKEN }, stdio: "inherit" });

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: APP_URL });
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(E2E_ADMIN.email);
  await page.getByLabel("Senha", { exact: true }).fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("heading", { name: "Painel" }).waitFor();
  await page.context().storageState({ path: E2E_STORAGE });
  await browser.close();
}
