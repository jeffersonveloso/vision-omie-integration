/**
 * Configura um ambiente de demonstração usando a própria API HTTP da plataforma
 * (contas Omie dos simuladores, regras obrigatórias e de-para de produtos/serviços)
 * e dispara uma sincronização.
 *
 *   npm run simulators          # em um terminal
 *   npm run dev                 # em outro (com o .env.local apontando para os simuladores)
 *   npm run demo:seed           # configura e sincroniza
 */
import { COMPANIES } from "./simulators/fixtures";

const BASE = process.env.APP_URL ?? "http://localhost:3000";

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${JSON.stringify(data)}`);
  return data as T;
}

async function main() {
  const { accounts: existing } = await call<{ accounts: Array<{ id: string; cnpj: string }> }>("GET", "/api/omie-accounts");
  const ids: string[] = [];
  for (const [label, c] of [["Matriz Belo Horizonte", COMPANIES.matriz], ["Filial Pedro Leopoldo", COMPANIES.filial]] as const) {
    const found = existing.find((a) => a.cnpj === c.cnpj);
    const id =
      found?.id ??
      (await call<{ account: { id: string } }>("POST", "/api/omie-accounts", { name: `Ecolife ${label}`, cnpj: c.cnpj, appKey: c.appKey, appSecret: c.appSecret, description: label.startsWith("Filial") ? "Base da filial, emite NFS-e de coleta e tratamento." : "Base principal, vendas de produtos.", active: true })).account.id;
    ids.push(id);
    const test = await call<{ ok: boolean; message: string }>("POST", `/api/omie-accounts/${id}/test`);
    console.log(`Conta ${label}: ${test.message}`);
  }

  const rules: Array<[string, string, string]> = [
    ["SALES_ORDER", "informacoes_adicionais.codigo_categoria", "1.01.01"],
    ["SALES_ORDER", "informacoes_adicionais.codigo_conta_corrente", "11850365"],
    ["SERVICE_ORDER", "InformacoesAdicionais.cCodCateg", "1.01.02"],
    ["SERVICE_ORDER", "InformacoesAdicionais.nCodCC", "11850365"],
  ];
  for (const [documentType, targetField, constantValue] of rules) {
    await call("PUT", "/api/mappings/rules", { omieAccountId: null, documentType, targetField, sourceType: "CONSTANT", constantValue, transforms: [] });
  }

  const { maps } = await call<{ maps: Array<{ id: string; key: string }> }>("GET", "/api/mappings/value-maps");
  const produtos = maps.find((m) => m.key === "produtos")!;
  const servicos = maps.find((m) => m.key === "servicos")!;
  // O pedido do Vision traz só o código da empresa: cada conta Omie recebe a(s) empresa(s) que atende.
  const empresas = maps.find((m) => m.key === "empresa-cnpj")!;
  for (const [index, c] of [COMPANIES.matriz, COMPANIES.filial].entries()) {
    await call("POST", `/api/mappings/value-maps/${empresas.id}/import`, { omieAccountId: ids[index], text: `${c.code};${c.cnpj};${c.name}` });
  }
  for (const id of ids) {
    await call("POST", `/api/mappings/value-maps/${produtos.id}/import`, { omieAccountId: id, text: "123;4422421;PRD-123 — Coletor de resíduos 20L\n456;4422456;PRD-456 — Kit descarte perfurocortante" });
    await call("POST", `/api/mappings/value-maps/${servicos.id}/import`, { omieAccountId: id, text: "77;8800077;SRV-77 — Coleta de resíduos de saúde\n78;8800078;SRV-78 — Tratamento e destinação final" });
  }
  const settings = await call<{ settings: Record<string, Record<string, unknown>> }>("GET", "/api/settings");
  await call("PUT", "/api/settings", {
    ...settings.settings,
    visionReturn: { ...settings.settings.visionReturn, defaultCodigoContaCorrente: 1 },
    // Configurações › Condições de pagamento: pedidos "SEM FINANCEIRO" (forma 2) vão à vista.
    paymentTerms: { ...settings.settings.paymentTerms, byPaymentForm: [{ visionCode: 2, visionDescription: "SEM FINANCEIRO", omieCode: "000", omieDescription: "À vista" }] },
  });

  const sync = await call<{ run: { stats: Record<string, number> } }>("POST", "/api/sync/run", { job: "SYNC" });
  console.log("Sincronização:", sync.run.stats);
  for (let i = 0; i < 3; i++) {
    const rec = await call<{ run: { stats: Record<string, number> } }>("POST", "/api/sync/run", { job: "RECONCILE" });
    console.log(`Retorno ${i + 1}:`, rec.run.stats);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
