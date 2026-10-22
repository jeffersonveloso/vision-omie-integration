import type { Clock } from "@/server/shared/application/ports";
import type { SettingsRepository } from "@/server/modules/settings/domain/integration-settings";
import type { CheckpointRepository } from "../domain/repositories";
import { type CollectionCheckpoint, nextWindowFrom, VISION_CHECKPOINT_KEY } from "./use-cases/collect-vision-orders";

export interface CollectionWindowStatus {
  /** A coleta já rodou ao menos uma vez (existe ponto de continuação). */
  started: boolean;
  /** Maior data de atualização de pedido já coletada. */
  lastUpdatedAt: string | null;
  /** Data final da última janela consultada (aaaa-mm-dd). */
  lastRunTo: string | null;
  /** De onde a próxima coleta vai começar (aaaa-mm-dd). */
  nextFrom: string;
  initialLookbackDays: number;
}

/**
 * Ponto de continuação da coleta incremental. "Recomeçar" apaga o ponto: a próxima coleta volta a buscar
 * os últimos `initialLookbackDays` dias. Pedidos que já estão na integração não são duplicados
 * (um agregado por código do pedido no Vision).
 */
export class CollectionWindowService {
  constructor(private readonly deps: { checkpoints: CheckpointRepository; settings: SettingsRepository; clock: Clock; timeZone: string }) {}

  async status(): Promise<CollectionWindowStatus> {
    const [checkpoint, settings] = await Promise.all([this.deps.checkpoints.get<CollectionCheckpoint>(VISION_CHECKPOINT_KEY), this.deps.settings.get()]);
    return {
      started: checkpoint !== null,
      lastUpdatedAt: checkpoint?.lastUpdatedAt ?? null,
      lastRunTo: checkpoint?.lastRunTo ?? null,
      nextFrom: nextWindowFrom(checkpoint, settings.sync, this.deps.clock.now(), this.deps.timeZone),
      initialLookbackDays: settings.sync.initialLookbackDays,
    };
  }

  async restart(): Promise<CollectionWindowStatus> {
    await this.deps.checkpoints.delete(VISION_CHECKPOINT_KEY);
    return this.status();
  }
}
