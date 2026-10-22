import type { AppLogger } from "@/server/shared/application/ports";
import type { WebhookJobProcessor, WebhookQueue } from "@/server/modules/integration/application/ports";

/**
 * Fila em memória, com o mesmo contrato da fila do Redis (tentativas com espera crescente).
 * Para desenvolvimento e testes: não sobrevive a reinício e não é dividida entre instâncias —
 * em produção use REDIS_URL. Eventos pendentes continuam gravados no banco e a varredura os reenfileira.
 */
export class InMemoryWebhookQueue implements WebhookQueue {
  readonly mode = "memory" as const;
  private processor: WebhookJobProcessor | null = null;
  private readonly pending = new Map<string, number>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private active = 0;
  private delayed = 0;
  private completed = 0;
  private failed = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly options: { attempts: number; backoffMs: number; logger: AppLogger }) {}

  async enqueue(eventId: string): Promise<void> {
    if (this.pending.has(eventId)) return;
    this.pending.set(eventId, 1);
    if (this.processor) this.schedule(eventId, 1, 0);
  }

  async startWorker(processor: WebhookJobProcessor): Promise<void> {
    if (this.processor) return;
    this.processor = processor;
    for (const [eventId, attempt] of this.pending) this.schedule(eventId, attempt, 0);
  }

  async counts() {
    return { waiting: Math.max(0, this.pending.size - this.active - this.delayed), active: this.active, delayed: this.delayed, failed: this.failed, completed: this.completed };
  }

  /** Testes: espera a fila esvaziar (inclusive novas tentativas). */
  idle(): Promise<void> {
    return this.pending.size === 0 ? Promise.resolve() : new Promise((resolve) => this.waiters.push(resolve));
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.pending.clear();
    this.notifyIdle();
  }

  private schedule(eventId: string, attempt: number, delayMs: number): void {
    if (delayMs > 0) this.delayed++;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (delayMs > 0) this.delayed--;
      void this.run(eventId, attempt);
    }, delayMs);
    timer.unref?.();
    this.timers.add(timer);
  }

  private async run(eventId: string, attempt: number): Promise<void> {
    if (!this.processor || !this.pending.has(eventId)) return;
    this.active++;
    try {
      await this.processor(eventId, { attempt, maxAttempts: this.options.attempts });
      this.completed++;
      this.pending.delete(eventId);
    } catch (error) {
      if (attempt < this.options.attempts) {
        this.pending.set(eventId, attempt + 1);
        this.schedule(eventId, attempt + 1, this.options.backoffMs * 2 ** (attempt - 1));
      } else {
        this.failed++;
        this.pending.delete(eventId);
        this.options.logger.warn("Webhook do Omie falhou em todas as tentativas", { eventId, error: String(error) });
      }
    } finally {
      this.active--;
      this.notifyIdle();
    }
  }

  private notifyIdle(): void {
    if (this.pending.size > 0) return;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }
}
