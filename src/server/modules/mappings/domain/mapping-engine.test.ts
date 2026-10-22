import { describe, expect, it } from "vitest";
import { resolveEffectiveRules } from "./effective-rules";
import { FieldRule } from "./field-rule";
import { MappingEngine, type MappingContext, type ValueMapResolver } from "./mapping-engine";
import type { DocumentType } from "./types";

const visionOrder = {
  codigo: 14100,
  codigoEmpresa: 1,
  dataCadastro: "2026-10-13T09:30:00",
  observacao: "Entregar no período da manhã",
  valorFrete: 25.5,
  codigoVendedor: 7,
  cliente: {
    codigo: 501,
    razaoSocial: "Hospital Santa Clara Ltda",
    nomeFantasia: "",
    cpfcnpj: "11.222.333/0001-81",
    telefone: "(31) 98877-6655",
    cidade: "Belo Horizonte",
    uf: "mg",
    cep: "30.110-012",
    entidadeClassificacao: { xContribuinte: true, xContribuinteFinal: false },
  },
  itens: [
    { seq: 1, codigoMaterial: 123, quantidade: 2, valorUnitario: 150, porcentagemDesconto: 0 },
    { seq: 2, codigoMaterial: 999, quantidade: 1, valorUnitario: "80,50", porcentagemDesconto: 5 },
  ],
  // Formato real do Vision: CodigoServico chega 0 e o código do serviço vem em CodigoMaterial.
  servicos: [{ seq: 0, codigoItem: 1, codigoServico: 0, codigoMaterial: 77, quantidade: 1, valorUnitario: 300 }],
};

function resolver(entries: Record<string, Record<string, string>>): ValueMapResolver {
  return {
    exists: (k) => k in entries || k === "vazia",
    name: (k) => ({ produtos: "Produtos", servicos: "Serviços", vendedores: "Vendedores" })[k] ?? k,
    resolve: (k, v) => (entries[k]?.[v] ? { omieValue: entries[k][v], omieLabel: null } : null),
  };
}

function ctx(documentType: DocumentType, rules: FieldRule[] = [], maps = resolver({ produtos: { "123": "4422421", "999": "4422999" }, servicos: { "77": "8800" } })): MappingContext {
  return {
    timeZone: "America/Sao_Paulo",
    now: new Date("2026-10-21T15:00:00Z"),
    accountName: "Base Matriz",
    rules: resolveEffectiveRules(documentType, rules, "acc-1"),
    valueMaps: maps,
    tokens: { codigoPedido: "14100" },
  };
}

function rule(partial: Partial<Parameters<typeof FieldRule.create>[0]> & { targetField: string; documentType: DocumentType }) {
  const created = FieldRule.create(
    { omieAccountId: "acc-1", sourceType: "CONSTANT", active: true, notes: null, transforms: [], ...partial },
    `r-${partial.targetField}`,
    new Date(),
  );
  if (!created.ok) throw created.error;
  return created.value;
}

describe("MappingEngine", () => {
  const engine = new MappingEngine();

  it("aponta campos obrigatórios sem regra (categoria e conta corrente)", () => {
    const result = engine.map("SALES_ORDER", visionOrder, ctx("SALES_ORDER"));
    const missing = result.issues.filter((i) => i.kind === "MISSING_REQUIRED").map((i) => i.targetField);
    expect(missing).toContain("informacoes_adicionais.codigo_categoria");
    expect(missing).toContain("informacoes_adicionais.codigo_conta_corrente");
  });

  it("monta cabeçalho e itens com de-para, transformações e tokens", () => {
    const rules = [
      rule({ documentType: "SALES_ORDER", targetField: "informacoes_adicionais.codigo_categoria", constantValue: "1.01.03" }),
      rule({ documentType: "SALES_ORDER", targetField: "informacoes_adicionais.codigo_conta_corrente", constantValue: "11850365" }),
    ];
    const result = engine.map("SALES_ORDER", visionOrder, ctx("SALES_ORDER", rules));
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.header["cabecalho.data_previsao"]).toBe("21/10/2026");
    expect(result.header["cabecalho.etapa"]).toBe("10");
    expect(result.header["informacoes_adicionais.codigo_conta_corrente"]).toBe(11850365);
    expect(result.header["informacoes_adicionais.consumidor_final"]).toBe("N");
    expect(result.header["frete.valor_frete"]).toBe(25.5);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]["produto.codigo_produto"]).toBe(4422421);
    expect(result.items[1]["produto.valor_unitario"]).toBe(80.5);
  });

  it("gera erro claro quando falta de-para de produto", () => {
    const maps = resolver({ produtos: { "123": "4422421" } });
    const result = engine.map("SALES_ORDER", visionOrder, ctx("SALES_ORDER", [], maps));
    const issue = result.issues.find((i) => i.kind === "VALUE_MAP_MISSING");
    expect(issue?.itemIndex).toBe(1);
    expect(issue?.visionValue).toBe("999");
    expect(issue?.message).toContain('sem de-para para o valor "999" na tabela "Produtos"');
    expect(issue?.hint).toContain("Mapeamentos");
  });

  it("de-para opcional sem correspondência gera apenas aviso", () => {
    const rules = [rule({ documentType: "SALES_ORDER", targetField: "informacoes_adicionais.codVend", sourceType: "VALUE_MAP", sourcePath: "codigoVendedor", valueMapKey: "vendedores" })];
    const maps = resolver({ produtos: { "123": "1", "999": "2" }, vendedores: {} });
    const result = engine.map("SALES_ORDER", visionOrder, ctx("SALES_ORDER", rules, maps));
    const issue = result.issues.find((i) => i.targetField === "informacoes_adicionais.codVend");
    expect(issue?.severity).toBe("warning");
    expect(result.header["informacoes_adicionais.codVend"]).toBeUndefined();
  });

  it("templates e transformações do cliente", () => {
    const result = engine.map("CUSTOMER", visionOrder, ctx("CUSTOMER"));
    expect(result.header.cnpj_cpf).toBe("11222333000181");
    expect(result.header.nome_fantasia).toBe("Hospital Santa Clara Ltda");
    expect(result.header.telefone1_ddd).toBe("31");
    expect(result.header.telefone1_numero).toBe("988776655");
    expect(result.header.estado).toBe("MG");
    expect(result.header.cep).toBe("30110012");
    expect(result.header.contribuinte).toBe("S");
  });

  it("ordem de serviço: cidade da prestação no formato CIDADE (UF) e serviço via de-para", () => {
    const rules = [
      rule({ documentType: "SERVICE_ORDER", targetField: "InformacoesAdicionais.cCodCateg", constantValue: "1.01.02" }),
      rule({ documentType: "SERVICE_ORDER", targetField: "InformacoesAdicionais.nCodCC", constantValue: "123" }),
    ];
    const result = engine.map("SERVICE_ORDER", visionOrder, ctx("SERVICE_ORDER", rules));
    expect(result.header["InformacoesAdicionais.cCidPrestServ"]).toBe("BELO HORIZONTE (MG)");
    expect(result.items[0]["nCodServico"]).toBe(8800);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("campo personalizado e regra da conta sobrepõe a global", () => {
    const global = FieldRule.create({ omieAccountId: null, documentType: "SALES_ORDER", targetField: "frete.modalidade", sourceType: "CONSTANT", constantValue: "0", active: true, notes: null }, "g1", new Date());
    const account = FieldRule.create({ omieAccountId: "acc-1", documentType: "SALES_ORDER", targetField: "frete.modalidade", sourceType: "CONSTANT", constantValue: "1", active: true, notes: null }, "a1", new Date());
    const custom = FieldRule.create({ omieAccountId: null, documentType: "SALES_ORDER", targetField: "frete.quantidade_volumes", sourceType: "CONSTANT", constantValue: "3", transforms: ["INTEGER"], active: true, notes: null }, "c1", new Date());
    if (!global.ok || !account.ok || !custom.ok) throw new Error("invalid");
    const effective = resolveEffectiveRules("SALES_ORDER", [global.value, account.value, custom.value], "acc-1");
    expect(effective.find((r) => r.definition.key === "frete.modalidade")?.origin).toBe("ACCOUNT");
    const result = engine.map("SALES_ORDER", visionOrder, { ...ctx("SALES_ORDER"), rules: effective });
    expect(result.header["frete.modalidade"]).toBe("1");
    expect(result.header["frete.quantidade_volumes"]).toBe("3");
  });

  it("valor inválido para campo inteiro é erro", () => {
    const rules = [rule({ documentType: "SALES_ORDER", targetField: "informacoes_adicionais.codigo_conta_corrente", constantValue: "abc" })];
    const result = engine.map("SALES_ORDER", visionOrder, ctx("SALES_ORDER", rules));
    expect(result.issues.some((i) => i.kind === "INVALID_VALUE" && i.targetField === "informacoes_adicionais.codigo_conta_corrente")).toBe(true);
  });
});

describe("FieldRule", () => {
  it("não permite regra para campo de sistema", () => {
    const r = FieldRule.create({ omieAccountId: null, documentType: "SALES_ORDER", targetField: "cabecalho.codigo_cliente", sourceType: "CONSTANT", constantValue: "1", active: true, notes: null }, "x", new Date());
    expect(r.ok).toBe(false);
  });
  it("valida caminho de item personalizado", () => {
    const ok = FieldRule.create({ omieAccountId: null, documentType: "SALES_ORDER", targetField: "det[].inf_adic.peso_bruto", sourceType: "VISION_FIELD", sourcePath: "peso", active: true, notes: null }, "x", new Date());
    const bad = FieldRule.create({ omieAccountId: null, documentType: "SALES_ORDER", targetField: "ServicosPrestados[].x", sourceType: "VISION_FIELD", sourcePath: "peso", active: true, notes: null }, "y", new Date());
    expect(ok.ok).toBe(true);
    expect(bad.ok).toBe(false);
  });
});
