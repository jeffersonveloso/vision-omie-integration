import type { VisionOrderPayload } from "./vision-order";

/**
 * Consistência das linhas do pedido do Vision: quantidade × valor unitário deve fechar o valor total.
 *
 * Na API real já apareceu `Quantidade: 271`, `ValorUnitario: 5.18`, `ValorTotal: 1408.70`
 * (271 × 5,18 = 1.403,78). O Swagger declara `Quantidade` como inteiro, então a quantidade pode estar
 * sendo truncada (271,95 kg × 5,18 = 1.408,70). Enviar assim ao Omie geraria nota com valor diferente
 * do pedido, por isso o padrão é bloquear e deixar o usuário decidir como tratar.
 */
export type LineTotalPolicy = "BLOCK" | "ADJUST_QUANTITY" | "ADJUST_UNIT_PRICE";

export const LINE_TOTAL_POLICY_LABELS: Record<LineTotalPolicy, string> = {
  BLOCK: "Bloquear o pedido e mostrar a diferença",
  ADJUST_QUANTITY: "Recalcular a quantidade (total ÷ valor unitário)",
  ADJUST_UNIT_PRICE: "Recalcular o valor unitário (total ÷ quantidade)",
};

export type LineCollection = "itens" | "servicos";

export interface LineMismatch {
  collection: LineCollection;
  index: number;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /** quantidade × valor unitário, em centavos arredondados. */
  computed: number;
  hasDiscount: boolean;
  /** Linha com desconto não é recalculada: não dá para saber qual valor está errado. */
  blocking: boolean;
  adjustment?: { field: "quantidade" | "valorUnitario"; from: number; to: number; residual: number };
}

const QUANTITY_DECIMALS = 4;
const PRICE_DECIMALS = 4;
const TOLERANCE = 0.01;

const round = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function reconcileLineTotals(payload: VisionOrderPayload, policy: LineTotalPolicy): { payload: VisionOrderPayload; mismatches: LineMismatch[] } {
  const mismatches: LineMismatch[] = [];
  const adjusted: VisionOrderPayload = { ...payload };

  for (const collection of ["itens", "servicos"] as const) {
    const lines = Array.isArray(payload[collection]) ? (payload[collection] as Array<Record<string, unknown>>) : [];
    const out = lines.map((line, index) => {
      const quantity = num(line.quantidade);
      const unitPrice = num(line.valorUnitario);
      const total = num(line.valorTotal);
      if (!quantity || !unitPrice || !total || quantity <= 0 || unitPrice <= 0 || total <= 0) return line;

      const hasDiscount = (num(line.porcentagemDesconto) ?? 0) > 0 || (num(line.valorDesconto) ?? 0) > 0;
      const computed = round(quantity * unitPrice, 2);
      // Desconto só reduz o total; total acima de quantidade × unitário nunca é desconto.
      const inconsistent = hasDiscount ? total > computed + TOLERANCE : Math.abs(total - computed) > TOLERANCE;
      if (!inconsistent) return line;

      const description = String(line.descricaoMaterialVenda ?? line.descricaoMaterial ?? line.descricaoServico ?? line.codigoMaterial ?? `linha ${index + 1}`);
      const base: LineMismatch = { collection, index, description, quantity, unitPrice, total, computed, hasDiscount, blocking: policy === "BLOCK" || hasDiscount };
      if (base.blocking) {
        mismatches.push(base);
        return line;
      }
      if (policy === "ADJUST_QUANTITY") {
        const to = round(total / unitPrice, QUANTITY_DECIMALS);
        mismatches.push({ ...base, adjustment: { field: "quantidade", from: quantity, to, residual: round(total - round(to * unitPrice, 2), 2) } });
        return { ...line, quantidade: to };
      }
      const to = round(total / quantity, PRICE_DECIMALS);
      mismatches.push({ ...base, adjustment: { field: "valorUnitario", from: unitPrice, to, residual: round(total - round(quantity * to, 2), 2) } });
      return { ...line, valorUnitario: to };
    });
    if (lines.length) adjusted[collection] = out;
  }
  return { payload: adjusted, mismatches };
}

const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
const decimal = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 6 });

export function describeLineMismatch(m: LineMismatch): string {
  const kind = m.collection === "servicos" ? "Serviço" : "Item";
  const base = `${kind} ${m.index + 1} (${m.description.slice(0, 60)}): o total no Vision é ${money(m.total)}, mas quantidade × valor unitário dá ${decimal(m.quantity)} × ${decimal(m.unitPrice)} = ${money(m.computed)}`;
  if (!m.adjustment) return `${base}.`;
  const field = m.adjustment.field === "quantidade" ? "A quantidade foi recalculada" : "O valor unitário foi recalculado";
  const residual = m.adjustment.residual ? ` Restou diferença de ${money(Math.abs(m.adjustment.residual))} por arredondamento.` : "";
  return `${base}. ${field} de ${decimal(m.adjustment.from)} para ${decimal(m.adjustment.to)}.${residual}`;
}
