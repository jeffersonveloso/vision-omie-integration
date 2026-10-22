import { NotFoundError } from "@/server/shared/domain/result";
import type { MappingContextFactory } from "@/server/modules/mappings/application/mapping-context-factory";
import { MappingEngine } from "@/server/modules/mappings/domain/mapping-engine";
import type { DocumentType, FieldTrace, MappingIssue } from "@/server/modules/mappings/domain/types";
import type { OmieAccountRepository } from "@/server/modules/omie-accounts/domain/omie-account-repository";
import type { SettingsRepository } from "@/server/modules/settings/domain/integration-settings";
import { customerIntegrationCode, documentIntegrationCode } from "../../domain/integration-codes";
import { IntegrationError } from "../../domain/integration-error";
import type { IntegrationOrderRepository } from "../../domain/repositories";
import { snapshotVisionOrder, type VisionOrderPayload } from "../../domain/vision-order";
import type { AccountRouter } from "../account-router";
import { OmiePayloadBuilder } from "../omie-payload-builder";
import { installmentIssues, prepareLines } from "../order-checks";
import type { VisionGateway } from "../ports";

export interface MappingPreview {
  account: { id: string; name: string; cnpj: string } | null;
  routingError: string | null;
  documents: Array<{
    type: DocumentType;
    payload: Record<string, unknown>;
    issues: MappingIssue[];
    trace: FieldTrace[];
  }>;
  visionPayload: VisionOrderPayload;
  fetchedFromVision: boolean;
}

/**
 * Simulação ("dry-run"): mostra o payload que seria enviado ao Omie para um pedido,
 * com a origem de cada campo e as pendências — sem chamar o Omie.
 */
export class PreviewOrderMapping {
  private readonly engine = new MappingEngine();
  private readonly builder = new OmiePayloadBuilder();

  constructor(
    private readonly deps: {
      orders: IntegrationOrderRepository;
      accounts: OmieAccountRepository;
      router: AccountRouter;
      mappingContexts: MappingContextFactory;
      vision: VisionGateway;
      settings: SettingsRepository;
      timeZone: string;
    },
  ) {}

  async execute(input: { orderId: string; omieAccountId?: string | null; refresh?: boolean }): Promise<MappingPreview> {
    const order = await this.deps.orders.findById(input.orderId);
    if (!order) throw new NotFoundError("Pedido", input.orderId);
    const settings = await this.deps.settings.get();

    let payload = order.visionPayload;
    let fetchedFromVision = false;
    if (!payload || input.refresh) {
      payload = await this.deps.vision.getOrder(order.visionOrderCode);
      fetchedFromVision = true;
    }

    let account = input.omieAccountId ? await this.deps.accounts.findById(input.omieAccountId) : null;
    let routingError: string | null = null;
    if (!account) {
      try {
        account = (await this.deps.router.resolve(payload, settings)).account;
      } catch (error) {
        routingError = error instanceof IntegrationError ? `${error.message} ${error.hint ?? ""}`.trim() : String(error);
      }
    }
    if (!account) return { account: null, routingError, documents: [], visionPayload: payload, fetchedFromVision };

    const snapshot = snapshotVisionOrder(payload);
    const prefix = settings.documents.integrationCodePrefix;
    const contextFor = await this.deps.mappingContexts.build({ id: account.id, name: account.name }, { codigoPedido: String(order.visionOrderCode) });
    const documents: MappingPreview["documents"] = [];

    // Mesmas checagens do envio: linhas com total divergente e condição 999 sem parcelas.
    const lines = prepareLines(payload, settings.documents.lineTotalMismatch);
    const mapped = lines.payload;
    const extra = (type: DocumentType, m: ReturnType<MappingEngine["map"]>) => [
      ...lines.issues.filter((i) => i.documentType === type),
      ...installmentIssues(type, m, snapshot, mapped, settings.documents.sendVisionInstallments),
    ];

    const customer = this.engine.map("CUSTOMER", mapped, contextFor("CUSTOMER"));
    documents.push({ type: "CUSTOMER", payload: this.builder.customer(customer, customerIntegrationCode(prefix, snapshot.customerCode, snapshot.customerDocument)), issues: customer.issues, trace: customer.trace });

    const buildBase = { customerId: 0, visionOrderCode: order.visionOrderCode, visionOrder: mapped, parcels: snapshot.parcels, sendInstallments: settings.documents.sendVisionInstallments, timeZone: this.deps.timeZone };
    if (snapshot.hasProducts && settings.documents.sendSalesOrders) {
      const m = this.engine.map("SALES_ORDER", mapped, contextFor("SALES_ORDER"));
      documents.push({ type: "SALES_ORDER", payload: this.builder.salesOrder(m, { ...buildBase, integrationCode: documentIntegrationCode(prefix, "SALES_ORDER", order.visionOrderCode) }), issues: [...extra("SALES_ORDER", m), ...m.issues], trace: m.trace });
    }
    if (snapshot.hasServices && settings.documents.sendServiceOrders) {
      const m = this.engine.map("SERVICE_ORDER", mapped, contextFor("SERVICE_ORDER"));
      documents.push({ type: "SERVICE_ORDER", payload: this.builder.serviceOrder(m, { ...buildBase, integrationCode: documentIntegrationCode(prefix, "SERVICE_ORDER", order.visionOrderCode) }), issues: [...extra("SERVICE_ORDER", m), ...m.issues], trace: m.trace });
    }
    return { account: { id: account.id, name: account.name, cnpj: account.cnpj.formatted() }, routingError, documents, visionPayload: payload, fetchedFromVision };
  }
}
