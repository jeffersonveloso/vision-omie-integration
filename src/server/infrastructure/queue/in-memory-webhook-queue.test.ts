import { describe, expect, it, vi } from "vitest";
import { InMemoryWebhookQueue } from "./in-memory-webhook-queue";

const logger = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("fila de webhooks em memória", () => {
  it("processa, tenta de novo com espera crescente e não duplica o mesmo evento", async () => {
    const queue = new InMemoryWebhookQueue({ attempts: 3, backoffMs: 5, logger });
    const calls: Array<[string, number]> = [];
    await queue.startWorker(async (id, ctx) => {
      calls.push([id, ctx.attempt]);
      expect(ctx.maxAttempts).toBe(3);
      if (id === "instavel" && ctx.attempt < 2) throw new Error("Omie fora do ar");
    });
    await queue.enqueue("ok");
    await queue.enqueue("ok");
    await queue.enqueue("instavel");
    await queue.idle();
    expect(calls).toEqual([["ok", 1], ["instavel", 1], ["instavel", 2]]);
    expect(await queue.counts()).toMatchObject({ completed: 2, failed: 0, waiting: 0 });
  });

  it("desiste depois da última tentativa", async () => {
    const queue = new InMemoryWebhookQueue({ attempts: 2, backoffMs: 1, logger });
    await queue.startWorker(async () => {
      throw new Error("sempre falha");
    });
    await queue.enqueue("ruim");
    await queue.idle();
    expect(await queue.counts()).toMatchObject({ failed: 1, completed: 0 });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("guarda o que chegou antes do worker ligar", async () => {
    const queue = new InMemoryWebhookQueue({ attempts: 1, backoffMs: 1, logger });
    await queue.enqueue("antes");
    expect((await queue.counts()).waiting).toBe(1);
    const seen: string[] = [];
    await queue.startWorker(async (id) => void seen.push(id));
    await queue.idle();
    expect(seen).toEqual(["antes"]);
    await queue.close();
  });
});
