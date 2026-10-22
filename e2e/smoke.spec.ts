import { expect, type Page, test } from "@playwright/test";

/** Falha o teste se a página registrar erro no console (exceto recursos externos de fonte/ícone). */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("painel mostra onde estão os pedidos e os erros por causa", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
  await expect(page.getByText("Onde estão os pedidos")).toBeVisible();
  await expect(page.getByText("Mapeamento de dados").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("pedido com erro: causa clara, simulação do mapeamento e reenvio depois de corrigir o de-para", async ({ page, request }) => {
  const errors = watchConsole(page);
  await page.goto("/pedidos?status=ERROR");
  await page.getByRole("link", { name: "14103" }).first().click();
  await expect(page.getByRole("heading", { name: "Pedido 14103" })).toBeVisible();
  await expect(page.getByText('sem de-para para o valor "999"').first()).toBeVisible();

  await page.getByRole("button", { name: "Simular mapeamento" }).click();
  await expect(page.getByRole("dialog").getByText("Simulação do mapeamento")).toBeVisible();
  await page.keyboard.press("Escape");

  // Corrige o de-para pela API (como faria a tela de Mapeamentos) e reenvia pela tela.
  const { accounts } = await (await request.get("/api/omie-accounts")).json();
  const { maps } = await (await request.get("/api/mappings/value-maps")).json();
  const produtos = maps.find((m: { key: string }) => m.key === "produtos");
  for (const account of accounts) {
    await request.post(`/api/mappings/value-maps/${produtos.id}/entries`, { data: { omieAccountId: account.id, visionValue: "999", omieValue: "4422999" } });
  }
  await page.getByRole("button", { name: "Reenviar agora" }).click();
  await expect(page.getByText("Pedido reenviado")).toBeVisible();
  await expect(page.getByText("Aguardando faturamento").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("configurações salvam e a alteração aparece na auditoria", async ({ page }) => {
  await page.goto("/configuracoes");
  await page.getByLabel("Pedidos por página").fill("60");
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect(page.getByText("Configurações salvas")).toBeVisible();

  await page.goto("/auditoria");
  await expect(page.getByText(/Configurações alteradas/).first()).toBeVisible();
});

test("mapeamentos mostram a condição de pagamento definida em Configurações", async ({ page }) => {
  await page.goto("/mapeamentos");
  await expect(page.getByText("Definido em Configurações › Condições de pagamento").first()).toBeVisible();
  await page.getByRole("tab", { name: "Tabelas de-para" }).click();
  await expect(page.getByText("Produtos").first()).toBeVisible();
});

test("contas Omie e execuções carregam", async ({ page }) => {
  await page.goto("/contas-omie");
  await expect(page.getByText("Ecolife Matriz Belo Horizonte")).toBeVisible();
  await page.goto("/execucoes");
  await expect(page.getByText("Coleta e envio").first()).toBeVisible();
});

test("webhook do Omie entra na fila e aparece processado na aba de webhooks", async ({ page, request }) => {
  const { items } = await (await request.get("/api/orders?search=14100")).json();
  const { order } = await (await request.get(`/api/orders/${items[0].id}`)).json();
  const omieId = order.documentsFull[0].omieId;
  const response = await request.post("/api/webhooks/omie?token=token-e2e", { data: { messageId: `e2e-${Date.now()}`, topic: "VendaProduto.Faturada", event: { idPedido: omieId } } });
  expect((await response.json()).queued).toBe(true);

  await page.goto("/execucoes");
  await page.getByRole("tab", { name: "Webhooks do Omie" }).click();
  await expect(page.getByText("em memória (desenvolvimento)")).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "VendaProduto.Faturada" }).first();
  await expect(row.getByRole("link", { name: "Pedido 14100" })).toBeVisible();
  await expect(row.getByText("Processado", { exact: true })).toBeVisible();
});

test("celular: lista de pedidos sem rolagem horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pedidos");
  await expect(page.getByRole("heading", { name: "Pedidos" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
