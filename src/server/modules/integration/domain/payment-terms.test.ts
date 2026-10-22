import { describe, expect, it } from "vitest";
import type { PaymentTermsSettings } from "@/server/modules/settings/domain/integration-settings";
import { resolvePaymentTerm } from "./payment-terms";

const terms: PaymentTermsSettings = {
  byPaymentForm: [{ visionCode: 2, visionDescription: "SEM FINANCEIRO", omieCode: "000", omieDescription: "À vista" }],
  defaultCondition: "A30",
  defaultConditionDescription: "Para 30 dias",
};
const base = { hasParcels: false, sendVisionInstallments: true, paymentFormCode: 2, paymentFormDescription: "SEM FINANCEIRO", terms };

describe("condição de pagamento do Omie", () => {
  it("pedido com parcelas usa 999 com as parcelas do Vision", () => {
    expect(resolvePaymentTerm({ ...base, hasParcels: true })).toMatchObject({ code: "999", source: "VISION_PARCELS" });
  });

  it("sem parcelas, usa a condição da forma de pagamento", () => {
    expect(resolvePaymentTerm(base)).toEqual({ code: "000", source: "PAYMENT_FORM", description: "Forma de pagamento 2 — SEM FINANCEIRO → 000 À vista" });
  });

  it("com o envio de parcelas desligado, a forma de pagamento vale mesmo havendo parcelas", () => {
    expect(resolvePaymentTerm({ ...base, hasParcels: true, sendVisionInstallments: false })).toMatchObject({ code: "000" });
  });

  it("forma não configurada cai na condição padrão; sem padrão, não resolve", () => {
    expect(resolvePaymentTerm({ ...base, paymentFormCode: 10 })).toMatchObject({ code: "A30", source: "DEFAULT" });
    expect(resolvePaymentTerm({ ...base, paymentFormCode: 10, terms: { ...terms, defaultCondition: null } })).toBeNull();
  });
});
