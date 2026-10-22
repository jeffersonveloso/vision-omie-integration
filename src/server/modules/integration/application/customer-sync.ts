import { createHash } from "node:crypto";
import type { Clock } from "@/server/shared/application/ports";
import type { CustomerLinkRepository } from "../domain/repositories";
import type { ExecutionLog } from "./execution-log";
import type { OmieGateway } from "./ports";

/**
 * Garante o cliente no Omie (UpsertClienteCpfCnpj) e guarda o vínculo
 * cliente Vision ↔ cliente Omie por conta. Se o cadastro não mudou desde a última
 * sincronização, reaproveita o código sem chamar a API (economiza consumo).
 */
export class CustomerSyncService {
  constructor(
    private readonly links: CustomerLinkRepository,
    private readonly clock: Clock,
  ) {}

  async ensure(params: {
    accountId: string;
    visionCustomerKey: string;
    payload: Record<string, unknown>;
    gateway: OmieGateway;
    upsertEveryTime: boolean;
    log: ExecutionLog;
  }): Promise<number> {
    const hash = createHash("sha1").update(JSON.stringify(params.payload)).digest("hex");
    const link = await this.links.find(params.accountId, params.visionCustomerKey);
    if (link && (link.payloadHash === hash || !params.upsertEveryTime)) {
      params.log.info(`Cliente já sincronizado no Omie (código ${link.omieCustomerId}).`);
      return link.omieCustomerId;
    }
    const { customerId } = await params.gateway.upsertCustomer(params.payload);
    await this.links.save({
      omieAccountId: params.accountId,
      visionCustomerKey: params.visionCustomerKey,
      omieCustomerId: customerId,
      payloadHash: hash,
      syncedAt: this.clock.now(),
    });
    params.log.info(link ? `Cadastro do cliente atualizado no Omie (código ${customerId}).` : `Cliente sincronizado no Omie (código ${customerId}).`);
    return customerId;
  }
}
