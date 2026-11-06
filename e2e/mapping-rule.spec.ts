import { expect, test } from "@playwright/test";

test("regra com de-para: as linhas da tabela aparecem e são editadas dentro da própria regra", async ({ page }) => {
  await page.goto("/mapeamentos");
  const row = page.getByRole("listitem").filter({ hasText: "det[].produto.codigo_produto" });
  await row.getByRole("button", { name: /Editar|Configurar/ }).click();
  const dialog = page.getByRole("dialog", { name: "Produto" });
  await expect(dialog.getByLabel("Tabela de-para")).toHaveValue("produtos");

  const lines = dialog.getByRole("region", { name: "Linhas da tabela Produtos" });
  await expect(lines.getByText("123", { exact: true })).toBeVisible();

  // Código digitado direto, sem escolher da lista do Omie.
  const code = String(Date.now()).slice(-6);
  await lines.getByLabel("Valor no Vision").fill(code);
  await lines.getByRole("combobox", { name: /no Omie/ }).click();
  await page.getByPlaceholder("Buscar por código ou descrição").fill("7777001");
  await page.getByRole("option", { name: /Usar\s*7777001/ }).click();
  await lines.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByText("Linha adicionada")).toBeVisible();
  await expect(lines.getByText(code, { exact: true })).toBeVisible();
  // Adicionar a linha não salva nem fecha a regra.
  await expect(dialog).toBeVisible();

  // Nova tabela criada de dentro da regra já fica selecionada.
  await dialog.getByRole("button", { name: "Nova tabela" }).click();
  const create = page.getByRole("dialog", { name: "Nova tabela de-para" });
  await create.getByLabel("Nome").fill("Produtos alternativos");
  await create.getByLabel("Chave", { exact: true }).fill(`produtos-alt-${code}`);
  await create.getByLabel("Registro do Omie").selectOption("livre");
  await create.getByRole("button", { name: "Criar tabela" }).click();
  await expect(dialog.getByLabel("Tabela de-para")).toHaveValue(`produtos-alt-${code}`);
  await expect(dialog.getByRole("region", { name: "Linhas da tabela Produtos alternativos" }).getByText("Tabela vazia para esta conta")).toBeVisible();
});

test("trazer do Vision pelo código mostra o resultado e o que não existe", async ({ page }) => {
  await page.goto("/pedidos");
  await page.getByRole("button", { name: "Trazer do Vision" }).click();
  const dialog = page.getByRole("dialog", { name: "Trazer pedidos do Vision" });
  await dialog.getByLabel("Códigos dos pedidos no Vision").fill("14100, 999999");
  await dialog.getByLabel("Enviar ao Omie agora").click();
  await dialog.getByRole("button", { name: "Trazer pedidos" }).click();
  await expect(dialog.getByText("1 pedido(s) lido(s) no Vision")).toBeVisible();
  await expect(dialog.getByText("999999")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Pedido 14100" })).toBeVisible();
});

test("valor fixo e valor se vier vazio: escolher do cadastro do Omie ou digitar o código", async ({ page }) => {
  await page.goto("/mapeamentos");
  // Regra de uma conta: a lista vem da base dela.
  const scope = page.locator("#scope");
  await scope.selectOption({ index: 1 });
  const row = page.getByRole("listitem").filter({ hasText: "informacoes_adicionais.codigo_categoria" });
  await row.getByRole("button", { name: /Editar|Configurar/ }).click();
  const dialog = page.getByRole("dialog", { name: "Categoria" });

  await dialog.getByRole("radio", { name: "Valor fixo" }).click();
  const fixed = dialog.getByRole("radiogroup", { name: "Como informar o valor" }).first();
  await expect(fixed.getByRole("radio", { name: "Escolher do Omie" })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByLabel("Cadastro do Omie").first()).toHaveValue("categorias");
  await dialog.locator("#constant").click();
  await page.getByRole("option", { name: /Prestação de serviços/ }).click();
  await expect(dialog.locator("#constant")).toContainText("Prestação de serviços");

  // Digitar: o código vai como está, sem consultar o Omie.
  await fixed.getByRole("radio", { name: "Digitar" }).click();
  await dialog.locator("#constant").fill("1.01.03");
  await expect(dialog.locator("#constant")).toHaveValue("1.01.03");

  // "Valor se vier vazio" também tem as duas formas.
  await dialog.getByRole("radio", { name: "Campo do Vision" }).click();
  const fallback = dialog.getByRole("radiogroup", { name: "Como informar o valor" }).last();
  await fallback.getByRole("radio", { name: "Escolher do Omie" }).click();
  await dialog.locator("#default").click();
  await page.getByRole("option", { name: /Venda de produtos/ }).click();
  await expect(dialog.locator("#default")).toContainText("Venda de produtos");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
});
