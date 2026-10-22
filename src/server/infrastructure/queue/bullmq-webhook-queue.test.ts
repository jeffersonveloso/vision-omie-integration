import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { BullMqWebhookQueue } from "./bullmq-webhook-queue";

/** Roda com um Redis de verdade: TEST_REDIS_URL=redis://localhost:6379 (no CI há um serviço Redis). */
const url = process.env.TEST_REDIS_URL;
const logger = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const until = async (check: () => boolean | Promise<boolean>, timeoutMs = 10_000) => {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("tempo esgotado esperando a fila");
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe.skipIf(!url)("fila de webhooks no Redis (BullMQ)", () => {
  const queues: BullMqWebhookQueue[] = [];
  const create = (attempts = 3) => {
    const q = new BullMqWebhookQueue(url!, { prefix: `teste-${randomUUID().slice(0, 8)}`, attempts, backoffMs: 50, concurrency: 2, logger });
    queues.push(q);
    return q;
  };
  afterAll(async () => {
    for (const q of queues) await q.close();
  });

  it("processa com novas tentativas e o mesmo id não vira dois jobs", async () => {
    const queue = create();
    const calls: Array<[string, number, number]> = [];
    await queue.enqueue("evento-1");
    await queue.enqueue("evento-1");
    await queue.enqueue("evento-2");
    await queue.startWorker(async (id, ctx) => {
      calls.push([id, ctx.attempt, ctx.maxAttempts]);
      if (id === "evento-2" && ctx.attempt === 1) throw new Error("instável");
    });
    await until(() => calls.filter(([id]) => id === "evento-2").length === 2 && calls.length === 3);
    expect(calls.filter(([id]) => id === "evento-1")).toEqual([["evento-1", 1, 3]]);
    expect(calls.filter(([id]) => id === "evento-2").map(([, attempt]) => attempt)).toEqual([1, 2]);
    await until(async () => (await queue.counts())?.completed === 2);
  });

  it("job que esgotou as tentativas volta a rodar quando reenfileirado", async () => {
    const queue = create(1);
    let fail = true;
    const runs: number[] = [];
    await queue.startWorker(async (_id, ctx) => {
      runs.push(ctx.attempt);
      if (fail) throw new Error("falha");
    });
    await queue.enqueue("evento-3");
    await until(async () => (await queue.counts())?.failed === 1);
    fail = false;
    await queue.enqueue("evento-3");
    await until(async () => (await queue.counts())?.completed === 1);
    expect(runs.length).toBe(2);
  });

  it("Redis fora do ar: enfileirar falha rápido em vez de travar a resposta ao Omie", async () => {
    const down = new BullMqWebhookQueue("redis://127.0.0.1:1", { prefix: "teste-off", attempts: 1, backoffMs: 10, concurrency: 1, logger });
    const started = Date.now();
    await expect(down.enqueue("x")).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await down.counts()).toBeNull();
    await down.close();
  });
});
