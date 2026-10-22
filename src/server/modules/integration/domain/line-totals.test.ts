import { describe, expect, it } from "vitest";
import { describeLineMismatch, reconcileLineTotals } from "./line-totals";
import type { VisionOrderPayload } from "./vision-order";

/** Linha do pedido real 14062: 271 × 5,18 = 1.403,78, mas o total no Vision é 1.408,70. */
const order = (line: Record<string, unknown>): VisionOrderPayload => ({ codigo: 14062, itens: [], servicos: [{ codigoMaterial: 3, descricaoMaterialVenda: "COLETA DE RSS", quantidade: 271, valorUnitario: 5.18, valorTotal: 1408.7, porcentagemDesconto: 0, ...line }] });

describe("consistência quantidade × valor unitário × total", () => {
  it("bloqueia por padrão e explica a diferença", () => {
    const { payload, mismatches } = reconcileLineTotals(order({}), "BLOCK");
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({ collection: "servicos", blocking: true, computed: 1403.78 });
    expect(describeLineMismatch(mismatches[0])).toContain("R$ 1.408,70");
    expect(describeLineMismatch(mismatches[0])).toContain("271 × 5,18 = R$ 1.403,78");
    expect(payload.servicos?.[0].quantidade).toBe(271);
  });

  it("recalcula a quantidade a partir do total", () => {
    const { payload, mismatches } = reconcileLineTotals(order({}), "ADJUST_QUANTITY");
    expect(payload.servicos?.[0].quantidade).toBe(271.9498);
    expect(mismatches[0].adjustment).toEqual({ field: "quantidade", from: 271, to: 271.9498, residual: 0 });
  });

  it("recalcula o valor unitário e avisa o centavo que sobra", () => {
    const { payload, mismatches } = reconcileLineTotals(order({}), "ADJUST_UNIT_PRICE");
    expect(payload.servicos?.[0].valorUnitario).toBe(5.1982);
    expect(mismatches[0].adjustment?.residual).toBe(-0.01);
    expect(describeLineMismatch(mismatches[0])).toContain("Restou diferença de R$ 0,01");
  });

  it("não mexe em linha que fecha nem em desconto legítimo; desconto com total maior bloqueia", () => {
    expect(reconcileLineTotals(order({ quantidade: 2, valorUnitario: 150, valorTotal: 300 }), "ADJUST_QUANTITY").mismatches).toEqual([]);
    expect(reconcileLineTotals(order({ quantidade: 2, valorUnitario: 150, valorTotal: 270, porcentagemDesconto: 10 }), "ADJUST_QUANTITY").mismatches).toEqual([]);
    const withDiscount = reconcileLineTotals(order({ porcentagemDesconto: 5 }), "ADJUST_QUANTITY");
    expect(withDiscount.mismatches[0]).toMatchObject({ blocking: true, hasDiscount: true });
    expect(withDiscount.payload.servicos?.[0].quantidade).toBe(271);
  });
});
