import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "../playwright.config";

test.describe("sem sessão", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("tela protegida leva ao login e volta para ela depois de entrar", async ({ page }) => {
    await page.goto("/contas-omie");
    await expect(page).toHaveURL(/\/login\?next=%2Fcontas-omie$/);
    await page.getByLabel("E-mail").fill(E2E_ADMIN.email);
    await page.getByLabel("Senha", { exact: true }).fill("senha-errada-123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
    await page.getByLabel("Senha", { exact: true }).fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("heading", { name: "Contas Omie" })).toBeVisible();
  });

  test("API sem login responde 401", async ({ request }) => {
    expect((await request.get("/api/orders")).status()).toBe(401);
    expect((await request.get("/api/health")).status()).toBe(200);
  });
});

test("administrador cadastra operador; operador troca a senha temporária no primeiro acesso e sai", async ({ page, browser }) => {
  await page.goto("/usuarios");
  await expect(page.getByRole("heading", { name: "Usuários" })).toBeVisible();
  await page.getByRole("button", { name: "Novo usuário" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome").fill("Operador E2E");
  const email = `operador-${Date.now()}@e2e.test`;
  await dialog.getByLabel("E-mail").fill(email);
  await dialog.getByRole("button", { name: "Cadastrar usuário" }).click();
  const shown = page.getByRole("dialog", { name: "Senha temporária de Operador E2E" });
  await expect(shown).toBeVisible();
  const temporary = await shown.getByLabel("Senha temporária").inputValue();
  expect(temporary).toHaveLength(14);
  await shown.getByRole("button", { name: "Pronto" }).click();
  await expect(page.getByText(email)).toBeVisible();

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const operator = await context.newPage();
  await operator.goto("/login");
  await operator.getByLabel("E-mail").fill(email);
  await operator.getByLabel("Senha", { exact: true }).fill(temporary);
  await operator.getByRole("button", { name: "Entrar" }).click();
  await expect(operator.getByText("Você entrou com uma senha temporária.")).toBeVisible();
  await operator.getByLabel("Senha temporária").fill(temporary);
  await operator.getByLabel("Nova senha", { exact: true }).fill("jabuticaba-madura-9");
  await operator.getByLabel("Confirme a nova senha").fill("jabuticaba-madura-9");
  await operator.getByRole("button", { name: "Trocar senha" }).click();
  await expect(operator.getByRole("heading", { name: "Painel" })).toBeVisible();
  // Operador não vê o cadastro de usuários.
  await expect(operator.getByRole("link", { name: "Usuários" })).toHaveCount(0);
  await operator.getByRole("button", { name: "Sair" }).click();
  await expect(operator).toHaveURL(/\/login$/);
  await context.close();
});
