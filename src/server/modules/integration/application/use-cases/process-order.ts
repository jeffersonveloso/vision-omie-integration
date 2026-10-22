import type { Clock, IdGenerator } from "@/server/shared/application/ports";
import { addMinutes } from "@/server/shared/domain/dates";
import type { MappingContextFactory } from "@/server/modules/mappings/application/mapping-context-factory";
import { MappingEngine, type MappingResult } from "@/server/modules/mappings/domain/mapping-engine";
import type { DocumentType, MappingIssue } from "@/server/modules/mappings/domain/types";
import type { SettingsRepository } from "@/server/modules/settings/domain/integration-settings";
import { customerIntegrationCode, documentIntegrationCode } from "../../domain/integration-codes";
import { IntegrationError, type IntegrationStep } from "../../domain/integration-error";
import type { IntegrationOrder } from "../../domain/integration-order";
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "../../domain/omie-document";
import type { IntegrationLogRepository, IntegrationOrderRepository } from "../../domain/repositories";
import { snapshotVisionOrder, type VisionOrderSnapshot } from "../../domain/vision-order";
import type { AccountRouter } from "../account-router";
import type { CustomerSyncService } from "../customer-sync";
import { ExecutionLog } from "../execution-log";
import { OmiePayloadBuilder, splitParcels } from "../omie-payload-builder";
import { installmentIssues, prepareLines } from "../order-checks";
import type { OmieGatewayFactory, VisionGateway } from "../ports";

export type ProcessOutcome =
  | { status: "SENT"; orderId: string }
  | { status: "FAILED"; orderId: string; error: IntegrationError }
  | { status: "SKIPPED"; orderId: string; reason: string };

export interface ProcessOrderDeps {
  orders: IntegrationOrderRepository;
  vision: VisionGateway;
  omie: OmieGatewayFactory;
  router: AccountRouter;
  mappingContexts: MappingContextFactory;
  customers: CustomerSyncService;
  settings: SettingsRepository;
  logs: IntegrationLogRepository;
  ids: IdGenerator;
  clock: Clock;
  timeZone: string;
}

const CLAIM_MINUTES = 5;

/**
 * Etapas 3–6 do fluxo (Vision → Omie): consulta do pedido completo, roteamento por CNPJ,
 * mapeamento dinâmico, sincronização do cliente e inclusão idempotente de PV e/ou OS.
 * Qualquer falha é classificada e registrada no pedido com causa, dica e dados técnicos.
 */
export class ProcessOrder {
  private readonly engine = new MappingEngine();
  private readonly builder = new OmiePayloadBuilder();

  constructor(private readonly deps: ProcessOrderDeps) {}

  async execute(input: { orderId: string; runId: string | null; trigger: "SCHEDULE" | "MANUAL" }): Promise<ProcessOutcome> {
    const { orders, clock, logs } = this.deps;
    const now = clock.now();
    if (!(await orders.tryClaim(input.orderId, addMinutes(now, CLAIM_MINUTES), now))) {
      return { status: "SKIPPED", orderId: input.orderId, reason: "Pedido já está sendo processado." };
    }
    const log = new ExecutionLog({ orderId: input.orderId, runId: input.runId }, clock);
    try {
      const order = await orders.findById(input.orderId);
      if (!order) return { status: "SKIPPED", orderId: input.orderId, reason: "Pedido não encontrado." };
      if (order.ignored) return { status: "SKIPPED", orderId: input.orderId, reason: "Pedido marcado como ignorado." };
      log.step("FETCH_DETAIL").info(input.trigger === "MANUAL" ? "Reenvio manual iniciado." : "Processamento automático iniciado.");
      try {
        await this.run(order, log);
        order.recordSuccess("SEND", clock.now());
        await orders.save(order);
        return { status: "SENT", orderId: order.id };
      } catch (raw) {
        const error = IntegrationError.from(raw, log.currentStep ?? "FETCH_DETAIL");
        const settings = await this.deps.settings.get();
        order.recordFailure(error, settings.retry, clock.now());
        await orders.save(order);
        log.add("ERROR", error.message, { category: error.category, code: error.code, hint: error.hint, retryable: error.retryable, details: error.details }, error.step);
        return { status: "FAILED", orderId: order.id, error };
      }
    } finally {
      await log.flush(logs);
      await orders.release(input.orderId);
    }
  }

  private async run(order: IntegrationOrder, log: ExecutionLog): Promise<void> {
    const { vision, router, omie, mappingContexts, customers, ids, clock, timeZone, orders } = this.deps;
    const settings = await this.deps.settings.get();

    // 1. Pedido completo (sempre atualizado: um reenvio usa os dados corrigidos no Vision)
    log.step("FETCH_DETAIL");
    const payload = await vision.getOrder(order.visionOrderCode, log.recorder());
    const snapshot = snapshotVisionOrder(payload);
    order.attachVisionPayload(payload, snapshot, clock.now());
    if (!order.hasSentDocuments()) order.acknowledgeVisionUpdate(clock.now());

    // 2. Roteamento (CNPJ da empresa, ou código da empresa pela tabela Empresa Vision → CNPJ)
    log.step("ROUTE");
    const route = await router.resolve(payload, settings);
    if (order.omieAccountId && order.omieAccountId !== route.account.id && order.hasSentDocuments()) {
      throw new IntegrationError({
        category: "ROUTING",
        code: "ACCOUNT_CHANGED",
        message: `O CNPJ do pedido passou a indicar a conta "${route.account.name}", mas o pedido já foi enviado para outra conta Omie.`,
        hint: "Ajuste manualmente no Omie ou ignore este pedido.",
      });
    }
    order.routeTo(route.account.id, route.cnpj, clock.now());
    log.info(`Pedido direcionado para a conta Omie "${route.account.name}" (${route.account.cnpj.formatted()}) via ${route.via === "CNPJ" ? "CNPJ do pedido" : "código da empresa"}.`);

    // 3. Documentos a gerar
    const kinds = this.documentKinds(snapshot, settings.documents);
    if (kinds.length === 0) {
      throw new IntegrationError({
        category: "VALIDATION",
        code: "NO_LINES",
        message: "O pedido não possui itens (produtos) nem serviços elegíveis para envio.",
        hint: "Confira o pedido no Vision ou as opções de documentos em Configurações.",
        step: "ROUTE",
      });
    }
    const prefix = settings.documents.integrationCodePrefix;
    order.ensureDocuments(kinds.map((kind) => ({ kind, integrationCode: documentIntegrationCode(prefix, kind, order.visionOrderCode) })), () => ids.next(), clock.now());
    const pending = order.documents.filter((d) => !d.isSent() && kinds.includes(d.kind));
    if (pending.length === 0) {
      log.info("Todos os documentos deste pedido já existem no Omie.");
      return;
    }

    // 4. Mapeamento (tudo é validado antes de enviar qualquer coisa ao Omie)
    log.step("MAP");
    const pendingTypes = new Set<string>(pending.map((d) => d.kind));
    const lines = prepareLines(payload, settings.documents.lineTotalMismatch);
    const lineIssues = lines.issues.filter((i) => pendingTypes.has(i.documentType));
    const lineErrors = lineIssues.filter((i) => i.severity === "error");
    if (lineErrors.length) {
      throw new IntegrationError({
        category: "VALIDATION",
        code: "LINE_TOTAL_MISMATCH",
        message: lineErrors.length === 1 ? lineErrors[0].message : `${lineErrors[0].message} (+${lineErrors.length - 1} linha(s) com a mesma divergência)`,
        hint: lineErrors[0].hint ?? null,
        retryable: false,
        step: "MAP",
        details: { linhas: lineErrors },
      });
    }
    for (const warning of lineIssues) log.warn(warning.message);
    const mappingPayload = lines.payload;

    const contextFor = await mappingContexts.build({ id: route.account.id, name: route.account.name }, { codigoPedido: String(order.visionOrderCode) });
    const customerMapping = this.engine.map("CUSTOMER", mappingPayload, contextFor("CUSTOMER"));
    const docMappings = new Map<DocumentKind, MappingResult>();
    for (const doc of pending) docMappings.set(doc.kind, this.engine.map(doc.kind as DocumentType, mappingPayload, contextFor(doc.kind as DocumentType)));
    const issues = [customerMapping, ...docMappings.values()].flatMap((m) => m.issues);
    for (const [kind, mapping] of docMappings) issues.push(...installmentIssues(kind as DocumentType, mapping, snapshot, mappingPayload, settings.documents.sendVisionInstallments));
    this.assertMapping(issues, log);
    for (const warning of issues.filter((i) => i.severity === "warning")) log.warn(warning.message, { campo: warning.targetField });

    // 5. Cliente
    log.step("CUSTOMER_SYNC");
    const gateway = omie.forAccount(route.account.credentials(), log.recorder());
    const customerCode = customerIntegrationCode(prefix, snapshot.customerCode, snapshot.customerDocument);
    const customerId = await customers.ensure({
      accountId: route.account.id,
      visionCustomerKey: String(snapshot.customerCode ?? snapshot.customerDocument ?? "sem-cliente"),
      payload: this.builder.customer(customerMapping, customerCode),
      gateway,
      upsertEveryTime: settings.documents.upsertCustomer,
      log,
    });

    // 6. Inclusão idempotente de cada documento
    const totals = this.lineTotals(mappingPayload);
    for (const doc of pending) {
      const step: IntegrationStep = doc.kind === "SALES_ORDER" ? "SEND_SALES_ORDER" : "SEND_SERVICE_ORDER";
      log.step(step);
      const share = totals.all > 0 ? (doc.kind === "SALES_ORDER" ? totals.products : totals.services) / totals.all : 1;
      const buildCtx = {
        customerId,
        integrationCode: doc.integrationCode,
        visionOrderCode: order.visionOrderCode,
        visionOrder: mappingPayload,
        parcels: splitParcels(snapshot.parcels, kinds.length > 1 ? share : 1),
        sendInstallments: settings.documents.sendVisionInstallments,
        timeZone,
      };
      const mapping = docMappings.get(doc.kind)!;
      const body = doc.kind === "SALES_ORDER" ? this.builder.salesOrder(mapping, buildCtx) : this.builder.serviceOrder(mapping, buildCtx);
      doc.recordRequest(body, clock.now());

      const existing = doc.kind === "SALES_ORDER" ? await gateway.findSalesOrder(doc.integrationCode) : await gateway.findServiceOrder(doc.integrationCode);
      if (existing) {
        doc.markSent(existing.omieId, existing.number, existing.response ?? null, clock.now());
        log.warn(`${DOCUMENT_KIND_LABELS[doc.kind]} já existia no Omie com o código ${doc.integrationCode} (nº ${existing.number ?? existing.omieId}). Vinculado sem duplicar.`);
      } else {
        const created = doc.kind === "SALES_ORDER" ? await gateway.createSalesOrder(body) : await gateway.createServiceOrder(body);
        doc.markSent(created.omieId, created.number, created.response ?? null, clock.now());
        log.info(`${DOCUMENT_KIND_LABELS[doc.kind]} incluído no Omie: nº ${created.number ?? "-"} (ID ${created.omieId}).`);
      }
      await orders.save(order); // persiste o progresso: um PV enviado nunca é reenviado
    }
  }

  private documentKinds(snapshot: VisionOrderSnapshot, options: { sendSalesOrders: boolean; sendServiceOrders: boolean }): DocumentKind[] {
    const kinds: DocumentKind[] = [];
    if (snapshot.hasProducts && options.sendSalesOrders) kinds.push("SALES_ORDER");
    if (snapshot.hasServices && options.sendServiceOrders) kinds.push("SERVICE_ORDER");
    return kinds;
  }

  private lineTotals(payload: Record<string, unknown>): { products: number; services: number; all: number } {
    const sum = (lines: unknown) =>
      (Array.isArray(lines) ? lines : []).reduce((acc: number, l: Record<string, unknown>) => {
        const total = Number(l.valorTotal);
        return acc + (Number.isFinite(total) && total > 0 ? total : Number(l.quantidade ?? 0) * Number(l.valorUnitario ?? 0));
      }, 0);
    const products = sum(payload.itens);
    const services = sum(payload.servicos);
    return { products, services, all: products + services };
  }

  private assertMapping(issues: MappingIssue[], log: ExecutionLog): void {
    const errors = issues.filter((i) => i.severity === "error");
    if (errors.length === 0) {
      log.info("Mapeamento validado sem pendências.");
      return;
    }
    const [first] = errors;
    throw new IntegrationError({
      category: "MAPPING",
      code: first.kind,
      message: errors.length === 1 ? capitalize(first.message) : `${capitalize(first.message)} (+${errors.length - 1} pendência(s) de mapeamento)`,
      hint: first.hint ?? null,
      retryable: false,
      step: "MAP",
      details: { issues: errors },
    });
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
