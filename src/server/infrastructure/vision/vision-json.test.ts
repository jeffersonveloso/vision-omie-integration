import { describe, expect, it } from "vitest";
import { toVisionWire } from "../../../../scripts/simulators/vision-simulator";
import { buildVisionOrders } from "../../../../scripts/simulators/fixtures";
import { parseVisionOrderSummary, snapshotVisionOrder, type VisionOrderPayload } from "@/server/modules/integration/domain/vision-order";
import { extractCompanyCnpj } from "@/server/modules/integration/domain/vision-order";
import { collectLeafPaths, getPath } from "@/server/modules/mappings/domain/object-path";
import { VISION_FIELD_CATALOG } from "./vision-field-catalog";
import { normalizeVisionJson, toCamelCaseKey } from "./vision-json";
import lista from "./__fixtures__/busca-atualizados.json";
import pedido from "./__fixtures__/pedido-servico-sem-financeiro.json";

const TZ = "America/Sao_Paulo";

describe("JSON da ControllerAPI (formato real)", () => {
  it("converte PascalCase como o Json.NET, inclusive siglas", () => {
    expect(["CodigoPedido", "CPFCNPJ", "CEP", "UF", "IE", "XBloquearFaturamento", "EntidadeClassificacao", "CodigoCMECliente", "Seq", "TotalPaginas"].map(toCamelCaseKey)).toEqual([
      "codigoPedido", "cpfcnpj", "cep", "uf", "ie", "xBloquearFaturamento", "entidadeClassificacao", "codigoCMECliente", "seq", "totalPaginas",
    ]);
  });

  it("lê o resumo da lista de atualizados com o fuso da operação", () => {
    const body = normalizeVisionJson(lista, TZ) as { pedidos: Array<Record<string, unknown>>; totalPaginas: number };
    expect(body.totalPaginas).toBe(3);
    const summary = parseVisionOrderSummary(body.pedidos[0])!;
    expect(summary).toMatchObject({ code: 14062, companyCode: 1, statusCode: 2, statusDescription: "CONCLUÍDO / FATURADO" });
    expect(summary.updatedAt?.toISOString()).toBe("2026-10-01T11:47:58.453Z"); // 08:47 em São Paulo
  });

  it("o pedido completo usa os mesmos caminhos do catálogo de campos", () => {
    const order = normalizeVisionJson(pedido, TZ) as VisionOrderPayload;
    expect(getPath(order, "cliente.cpfcnpj")).toBe("44.555.666/0001-81");
    expect(getPath(order, "cliente.entidadeClassificacao.xContribuinte")).toBe(true);
    expect(getPath(order, "servicos[0].codigoMaterial")).toBe(3);
    expect(order.dataAtualizacao).toBe("2026-10-01T08:47:58.453-03:00");

    const snapshot = snapshotVisionOrder(order);
    expect(snapshot).toMatchObject({ code: 14062, companyCode: 1, customerCode: 169, hasProducts: false, hasServices: true, totalAmount: 1408.7, parcels: [] });

    // O pedido não traz CNPJ da empresa: o roteamento cai na tabela de-para pelo código da empresa.
    expect(extractCompanyCnpj(order, ["cnpjEmpresa", "empresa.cnpj"])).toBeNull();

    const known = new Set(VISION_FIELD_CATALOG.map((f) => (f.scope === "header" ? f.path : `${f.scope === "item" ? "itens" : "servicos"}[].${f.path}`)));
    const paths = [...collectLeafPaths(order).keys()].map((p) => p.replace(/\[\d+\]/g, "[]"));
    for (const path of ["codigo", "codigoEmpresa", "cliente.cpfcnpj", "cliente.razaoSocial", "cliente.cep", "cliente.uf", "servicos[].codigoMaterial", "servicos[].quantidade", "servicos[].valorTotal"]) {
      expect(paths).toContain(path);
      expect(known.has(path)).toBe(true);
    }
  });

  it("o simulador responde no mesmo formato e volta igual depois de normalizado", () => {
    const [first] = buildVisionOrders();
    const wire = toVisionWire(first) as Record<string, unknown>;
    expect(Object.keys(wire)).toContain("Codigo");
    expect(Object.keys(wire.Cliente as object)).toContain("CPFCNPJ");
    const back = normalizeVisionJson(JSON.parse(JSON.stringify(wire)), "UTC") as Record<string, unknown>;
    expect([...collectLeafPaths(back).keys()].sort()).toEqual([...collectLeafPaths(first).keys()].sort());
  });
});
