import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import type { AppLogger } from "@/server/shared/application/ports";
import type { WebhookJobProcessor, WebhookQueue } from "@/server/modules/integration/application/ports";

export const WEBHOOK_QUEUE_NAME = "omie-webhooks";
/** A rota do webhook tem 7 s para responder ao Omie: a fila nunca pode segurar mais que isso. */
const ENQUEUE_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))]).finally(() => clearTimeout(timer));
}

export interface BullMqQueueOptions {
  /** Prefixo das chaves no Redis (permite dividir o Redis com outros sistemas). */
  prefix: string;
  attempts: number;
  /** Espera inicial entre tentativas; dobra a cada falha. */
  backoffMs: number;
  concurrency: number;
  logger: AppLogger;
}

/**
 * Fila de webhooks no Redis com BullMQ (sucessor do Bull; o NestJS usa o mesmo via @nestjs/bullmq).
 * O job carrega só o id do evento — o conteúdo fica no banco. O id do job é o id do evento, então
 * enfileirar de novo (varredura, reprocessamento) não duplica.
 */
export class BullMqWebhookQueue implements WebhookQueue {
  readonly mode = "redis" as const;
  private readonly producer: IORedis;
  private readonly queue: Queue;
  private worker: Worker | null = null;
  private workerConnection: IORedis | null = null;
  private redisDown = false;

  constructor(
    private readonly url: string,
    private readonly options: BullMqQueueOptions,
  ) {
    // Produtor falha rápido com o Redis fora do ar: a rota do webhook não pode esperar (o Omie dá 7 s).
    this.producer = new IORedis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 3_000 });
    this.producer.on("error", (error) => {
      if (!this.redisDown) options.logger.warn("Redis indisponível para a fila de webhooks", { error: String(error) });
      this.redisDown = true;
    });
    this.producer.on("ready", () => {
      if (this.redisDown) options.logger.info("Redis disponível de novo para a fila de webhooks");
      this.redisDown = false;
    });
    this.queue = new Queue(WEBHOOK_QUEUE_NAME, { connection: this.producer, prefix: options.prefix });
  }

  async enqueue(eventId: string): Promise<void> {
    await this.ensureReady();
    await withTimeout(this.add(eventId), ENQUEUE_TIMEOUT_MS, `A fila de webhooks não respondeu em ${ENQUEUE_TIMEOUT_MS / 1000} s.`);
  }

  /** Com o Redis fora do ar o BullMQ esperaria a reconexão indefinidamente: aqui falha rápido. */
  private async ensureReady(): Promise<void> {
    if (this.producer.status === "ready") return;
    if (this.producer.status !== "connecting" && this.producer.status !== "connect") throw new Error(`Redis indisponível (${this.producer.status}).`);
    await withTimeout(new Promise<void>((resolve) => this.producer.once("ready", () => resolve())), 1_000, "Redis indisponível (sem conexão).");
  }

  private async add(eventId: string): Promise<void> {
    const existing = await this.queue.getJob(eventId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed") return void (await existing.retry());
      if (state !== "completed" && state !== "unknown") return; // já está na fila, atrasado ou rodando
      await existing.remove();
    }
    await this.queue.add(
      "process",
      { eventId },
      {
        jobId: eventId,
        attempts: this.options.attempts,
        backoff: { type: "exponential", delay: this.options.backoffMs },
        removeOnComplete: { age: 24 * 3600, count: 5000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
  }

  async startWorker(processor: WebhookJobProcessor): Promise<void> {
    if (this.worker) return;
    this.workerConnection = new IORedis(this.url, { maxRetriesPerRequest: null });
    this.workerConnection.on("error", () => {}); // o produtor já registra a indisponibilidade
    this.worker = new Worker(WEBHOOK_QUEUE_NAME, (job) => processor(String(job.data.eventId), { attempt: job.attemptsMade + 1, maxAttempts: job.opts.attempts ?? 1 }), {
      connection: this.workerConnection,
      prefix: this.options.prefix,
      concurrency: this.options.concurrency,
    });
    this.worker.on("failed", (job, error) => this.options.logger.warn("Falha ao processar webhook do Omie", { eventId: job?.data?.eventId, tentativa: job ? job.attemptsMade : null, error: error.message }));
    this.worker.on("error", (error) => this.options.logger.error("Erro no worker da fila de webhooks", { error: String(error) }));
    this.options.logger.info("Worker da fila de webhooks iniciado", { fila: WEBHOOK_QUEUE_NAME, concorrencia: this.options.concurrency });
  }

  async counts() {
    try {
      await this.ensureReady();
      const c = await withTimeout(this.queue.getJobCounts("waiting", "active", "delayed", "failed", "completed"), ENQUEUE_TIMEOUT_MS, "timeout");
      return { waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0, completed: c.completed ?? 0 };
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    await withTimeout(Promise.all([this.worker?.close(), this.queue.close()]), 5_000, "timeout").catch(() => undefined);
    this.workerConnection?.disconnect();
    this.producer.disconnect();
  }
}
