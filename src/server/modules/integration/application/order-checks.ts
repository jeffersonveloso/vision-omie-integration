import type { MappingResult } from "@/server/modules/mappings/domain/mapping-engine";
import type { DocumentType, MappingIssue } from "@/server/modules/mappings/domain/types";
import { getPath } from "@/server/modules/mappings/domain/object-path";
import { describeLineMismatch, type LineMismatch, type LineTotalPolicy, reconcileLineTotals } from "../domain/line-totals";
import type { VisionOrderPayload, VisionOrderSnapshot } from "../domain/vision-order";

/**
 * Checagens do pedido além do mapeamento campo a campo. Rodam antes de qualquer chamada ao Omie,
 * no envio e na simulação, para o usuário ver a mesma pendência nos dois lugares.
 */

export interface PreparedLines {
  /** Pedido com as linhas ajustadas pela política (o pedido original do Vision não é alterado). */
  payload: VisionOrderPayload;
  issues: MappingIssue[];
}

export function prepareLines(payload: VisionOrderPayload, policy: LineTotalPolicy): PreparedLines {
  const { payload: adjusted, mismatches } = reconcileLineTotals(payload, policy);
  return { payload: adjusted, issues: mismatches.map(lineIssue) };
}

function lineIssue(m: LineMismatch): MappingIssue {
  const service = m.collection === "servicos";
  return {
    severity: m.blocking ? "error" : "warning",
    kind: "LINE_TOTAL_MISMATCH",
    documentType: service ? "SERVICE_ORDER" : "SALES_ORDER",
    targetField: service ? "ServicosPrestados[].nQtde" : "det[].produto.quantidade",
    label: "Quantidade × valor unitário",
    message: describeLineMismatch(m),
    hint: !m.blocking
      ? undefined
      : m.hasDiscount
        ? "Linha com desconto não é recalculada automaticamente: confira os valores no Vision antes de reenviar."
        : "A API do Vision pode estar arredondando a quantidade (o Swagger declara Quantidade como inteiro) ou o valor unitário. Confirme com o Vision ou escolha em Configurações › Roteamento e documentos se a integração deve recalcular.",
    itemIndex: m.index,
  };
}

const PARCEL_FIELD: Partial<Record<DocumentType, string>> = { SALES_ORDER: "cabecalho.codigo_parcela", SERVICE_ORDER: "Cabecalho.cCodParc" };

/** Condição 999 (parcelas informadas) exige as parcelas do Vision. */
export function installmentIssues(type: DocumentType, mapping: MappingResult, snapshot: VisionOrderSnapshot, payload: VisionOrderPayload, sendInstallments: boolean): MappingIssue[] {
  const field = PARCEL_FIELD[type];
  if (!field || String(mapping.header[field] ?? "") !== "999") return [];
  if (sendInstallments && snapshot.parcels.length > 0) return [];
  const formCode = payload.codigoFormaPagamento;
  const formName = getPath(payload, "cliente.codigoFormaPagamento") === formCode ? getPath(payload, "cliente.descricaoFormaPagamento") : null;
  const form = formCode !== undefined && formCode !== null ? ` (forma de pagamento ${formCode}${formName ? ` — ${formName}` : ""})` : "";
  return [
    {
      severity: "error",
      kind: "NO_INSTALLMENTS",
      documentType: type,
      targetField: field,
      label: "Condição de pagamento",
      message: sendInstallments
        ? `a condição de pagamento está como 999 (parcelas informadas), mas o pedido não tem parcelas no Vision${form}`
        : "a condição de pagamento está como 999 (parcelas informadas), mas o envio das parcelas do Vision está desligado",
      hint: "Escolha em Mapeamentos uma condição do Omie para esses pedidos — fixa ou por tabela de-para da forma de pagamento do Vision (campo codigoFormaPagamento).",
    },
  ];
}
