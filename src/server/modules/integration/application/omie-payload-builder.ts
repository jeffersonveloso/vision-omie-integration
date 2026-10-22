import { toBrDateFromAny } from "@/server/shared/domain/dates";
import type { MappingResult } from "@/server/modules/mappings/domain/mapping-engine";
import { getPath, setPath } from "@/server/modules/mappings/domain/object-path";
import { itemIntegrationCode } from "../domain/integration-codes";
import type { VisionOrderPayload, VisionParcel } from "../domain/vision-order";

export interface BuildContext {
  customerId: number;
  integrationCode: string;
  visionOrderCode: number;
  visionOrder: VisionOrderPayload;
  /** Parcelas do Vision já proporcionais a este documento. */
  parcels: VisionParcel[];
  sendInstallments: boolean;
  timeZone: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Divide as parcelas do Vision proporcionalmente quando o pedido gera PV e OS.
 * O ajuste de centavos vai para a última parcela.
 */
export function splitParcels(parcels: VisionParcel[], share: number): VisionParcel[] {
  if (share >= 0.9999) return parcels;
  const total = round2(parcels.reduce((a, p) => a + p.amount, 0) * share);
  const split = parcels.map((p) => ({ ...p, amount: round2(p.amount * share) }));
  const diff = round2(total - split.reduce((a, p) => a + p.amount, 0));
  if (split.length) split[split.length - 1].amount = round2(split[split.length - 1].amount + diff);
  return split;
}

function percentages(parcels: VisionParcel[]): number[] {
  const total = parcels.reduce((a, p) => a + p.amount, 0);
  if (total <= 0) return parcels.map(() => round2(100 / parcels.length));
  const values = parcels.map((p) => round2((p.amount / total) * 100));
  const diff = round2(100 - values.reduce((a, v) => a + v, 0));
  values[values.length - 1] = round2(values[values.length - 1] + diff);
  return values;
}

/** Monta os payloads finais do Omie a partir do resultado do mapeamento + campos de sistema. */
export class OmiePayloadBuilder {
  customer(mapping: MappingResult, integrationCode: string): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(mapping.header)) setPath(payload, key, value);
    payload.codigo_cliente_integracao = integrationCode;
    return payload;
  }

  /** produtos/pedido › IncluirPedido */
  salesOrder(mapping: MappingResult, ctx: BuildContext): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(mapping.header)) setPath(payload, key, value);
    setPath(payload, "cabecalho.codigo_cliente", ctx.customerId);
    setPath(payload, "cabecalho.codigo_pedido_integracao", ctx.integrationCode);
    const visionItems = Array.isArray(ctx.visionOrder.itens) ? ctx.visionOrder.itens : [];
    payload.det = mapping.items.map((item, index) => {
      const det: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(item)) setPath(det, key, value);
      const seq = Number(getPath(visionItems[index], "seq")) || index + 1;
      setPath(det, "ide.codigo_item_integracao", itemIntegrationCode(ctx.visionOrderCode, seq));
      return det;
    });
    setPath(payload, "cabecalho.quantidade_itens", mapping.items.length);

    const parcelCode = String(getPath(payload, "cabecalho.codigo_parcela") ?? "");
    if (ctx.sendInstallments && parcelCode === "999" && ctx.parcels.length > 0) {
      const perc = percentages(ctx.parcels);
      setPath(payload, "lista_parcelas.parcela", ctx.parcels.map((p, i) => ({
        numero_parcela: i + 1,
        valor: round2(p.amount),
        percentual: perc[i],
        data_vencimento: toBrDateFromAny(p.dueDate, ctx.timeZone) ?? getPath(payload, "cabecalho.data_previsao"),
      })));
      setPath(payload, "cabecalho.qtde_parcelas", ctx.parcels.length);
    }
    return payload;
  }

  /** servicos/os › IncluirOS */
  serviceOrder(mapping: MappingResult, ctx: BuildContext): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(mapping.header)) setPath(payload, key, value);
    setPath(payload, "Cabecalho.nCodCli", ctx.customerId);
    setPath(payload, "Cabecalho.cCodIntOS", ctx.integrationCode);
    payload.ServicosPrestados = mapping.items.map((item, index) => {
      const line: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(item)) setPath(line, key, value);
      line.nSeqItem = index + 1;
      return line;
    });
    if (!payload.Departamentos) payload.Departamentos = [];

    const parcelCode = String(getPath(payload, "Cabecalho.cCodParc") ?? "");
    if (ctx.sendInstallments && parcelCode === "999" && ctx.parcels.length > 0) {
      const perc = percentages(ctx.parcels);
      payload.Parcelas = ctx.parcels.map((p, i) => ({
        nParcela: i + 1,
        dDtVenc: toBrDateFromAny(p.dueDate, ctx.timeZone) ?? getPath(payload, "Cabecalho.dDtPrevisao"),
        nValor: round2(p.amount),
        nPercentual: perc[i],
      }));
      setPath(payload, "Cabecalho.nQtdeParc", ctx.parcels.length);
    } else if (getPath(payload, "Cabecalho.nQtdeParc") === undefined) {
      setPath(payload, "Cabecalho.nQtdeParc", 1);
    }
    return payload;
  }
}
