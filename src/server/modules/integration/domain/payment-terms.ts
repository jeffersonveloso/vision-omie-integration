import type { PaymentTermsSettings } from "@/server/modules/settings/domain/integration-settings";

/** Condição "parcelas informadas" do Omie: as parcelas vão no próprio pedido/OS. */
export const MANUAL_INSTALLMENTS_CODE = "999";

export type PaymentTermSource = "VISION_PARCELS" | "PAYMENT_FORM" | "DEFAULT";

export interface ResolvedPaymentTerm {
  code: string;
  source: PaymentTermSource;
  /** Texto para o rastro do mapeamento ("Forma de pagamento 2 — SEM FINANCEIRO → 000 À vista"). */
  description: string;
}

/**
 * Condição de pagamento do Omie para um pedido do Vision, na ordem configurada em
 * Configurações › Condições de pagamento:
 *  1. pedido com parcelas e envio de parcelas ligado → 999 (as parcelas do Vision vão no documento);
 *  2. condição associada à forma de pagamento do pedido (codigoFormaPagamento);
 *  3. condição padrão para pedidos sem parcelas;
 *  4. nenhuma → o pedido para com pendência.
 */
export function resolvePaymentTerm(input: {
  hasParcels: boolean;
  sendVisionInstallments: boolean;
  paymentFormCode: number | null;
  paymentFormDescription: string | null;
  terms: PaymentTermsSettings;
}): ResolvedPaymentTerm | null {
  if (input.hasParcels && input.sendVisionInstallments) {
    return { code: MANUAL_INSTALLMENTS_CODE, source: "VISION_PARCELS", description: "Parcelas do pedido no Vision (999)" };
  }
  const form = input.paymentFormCode === null ? undefined : input.terms.byPaymentForm.find((t) => t.visionCode === input.paymentFormCode);
  if (form) {
    const vision = form.visionDescription || input.paymentFormDescription || "";
    return {
      code: form.omieCode,
      source: "PAYMENT_FORM",
      description: `Forma de pagamento ${form.visionCode}${vision ? ` — ${vision}` : ""} → ${form.omieCode}${form.omieDescription ? ` ${form.omieDescription}` : ""}`,
    };
  }
  if (input.terms.defaultCondition) {
    return {
      code: input.terms.defaultCondition,
      source: "DEFAULT",
      description: `Condição padrão → ${input.terms.defaultCondition}${input.terms.defaultConditionDescription ? ` ${input.terms.defaultConditionDescription}` : ""}`,
    };
  }
  return null;
}
