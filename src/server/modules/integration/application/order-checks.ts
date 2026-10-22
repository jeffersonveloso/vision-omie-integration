import type { MappingResult } from "@/server/modules/mappings/domain/mapping-engine";
import type { DocumentType, MappingIssue } from "@/server/modules/mappings/domain/types";
import { getPath } from "@/server/modules/mappings/domain/object-path";
import type { IntegrationSettings } from "@/server/modules/settings/domain/integration-settings";
import { describeLineMismatch, type LineMismatch, type LineTotalPolicy, reconcileLineTotals } from "../domain/line-totals";
import { MANUAL_INSTALLMENTS_CODE, resolvePaymentTerm } from "../domain/payment-terms";
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
const PAYMENT_TERMS_PLACE = "Configurações › Condições de pagamento";

function paymentForm(payload: VisionOrderPayload): { code: number | null; description: string | null; text: string } {
  const raw = payload.codigoFormaPagamento;
  const code = raw === undefined || raw === null || raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
  // A descrição só vem no cadastro do cliente; vale quando é a mesma forma do pedido.
  const description = code !== null && Number(getPath(payload, "cliente.codigoFormaPagamento")) === code ? ((getPath(payload, "cliente.descricaoFormaPagamento") as string | null) ?? null) : null;
  return { code, description, text: code === null ? "não informada" : `${code}${description ? ` — ${description}` : ""}` };
}

/**
 * Condição de pagamento de cada documento. Sem regra no mapeamento, vem de Configurações › Condições de
 * pagamento (parcelas do Vision → forma de pagamento → condição padrão). Com regra, vale a regra, mas 999
 * continua exigindo parcelas. Preenche o campo no resultado do mapeamento e devolve as pendências.
 */
export function applyPaymentTerms(type: DocumentType, mapping: MappingResult, snapshot: VisionOrderSnapshot, payload: VisionOrderPayload, settings: IntegrationSettings): MappingIssue[] {
  const field = PARCEL_FIELD[type];
  if (!field) return [];
  const sendInstallments = settings.documents.sendVisionInstallments;
  const hasParcels = snapshot.parcels.length > 0;
  const form = paymentForm(payload);
  const base = { documentType: type, targetField: field, label: "Condição de pagamento" };
  const traceIndex = mapping.trace.findIndex((t) => t.key === field && t.itemIndex === undefined);
  const userRule = traceIndex >= 0 && (mapping.trace[traceIndex].origin === "GLOBAL" || mapping.trace[traceIndex].origin === "ACCOUNT");

  if (!userRule) {
    const term = resolvePaymentTerm({ hasParcels, sendVisionInstallments: sendInstallments, paymentFormCode: form.code, paymentFormDescription: form.description, terms: settings.paymentTerms });
    const entry = { key: field, label: "Condição de pagamento", origin: "SYSTEM" as const, source: term ? `${PAYMENT_TERMS_PLACE}: ${term.description}` : PAYMENT_TERMS_PLACE, rawValue: form.code, value: term?.code };
    if (traceIndex >= 0) mapping.trace[traceIndex] = entry;
    else mapping.trace.push(entry);
    if (term) {
      mapping.header[field] = term.code;
      return [];
    }
    delete mapping.header[field];
    return [
      {
        ...base,
        severity: "error",
        kind: "NO_PAYMENT_TERM",
        message: `o pedido não tem parcelas no Vision e a forma de pagamento ${form.text} não tem condição do Omie configurada`,
        hint: `Associe a forma de pagamento a uma condição do Omie (ou defina uma condição padrão) em ${PAYMENT_TERMS_PLACE} e reenvie o pedido.`,
        visionValue: form.code === null ? undefined : String(form.code),
      },
    ];
  }

  if (String(mapping.header[field] ?? "") !== MANUAL_INSTALLMENTS_CODE || (sendInstallments && hasParcels)) return [];
  return [
    {
      ...base,
      severity: "error",
      kind: "NO_INSTALLMENTS",
      message: sendInstallments
        ? `a regra de mapeamento fixa a condição 999 (parcelas informadas), mas o pedido não tem parcelas no Vision (forma de pagamento ${form.text})`
        : "a regra de mapeamento fixa a condição 999 (parcelas informadas), mas o envio das parcelas do Vision está desligado",
      hint: `Remova a regra da Condição de pagamento em Mapeamentos para usar ${PAYMENT_TERMS_PLACE}, ou escolha outra condição na regra.`,
    },
  ];
}
