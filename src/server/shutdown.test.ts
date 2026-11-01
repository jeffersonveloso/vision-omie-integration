import { afterEach, describe, expect, it, vi } from "vitest";
import { lifecycle } from "./infrastructure/http/lifecycle";
import { gracefulShutdown } from "./shutdown";

function target(drained = true) {
  const order: string[] = [];
  return {
    order,
    container: {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() },
      scheduler: { drain: vi.fn(async () => (order.push("rotinas"), drained)) },
      webhookQueue: { close: vi.fn(async () => void order.push("fila")) },
      database: { close: vi.fn(async () => void order.push("banco")) },
    },
  };
}

afterEach(() => lifecycle.reset());

describe("desligamento ordenado", () => {
  it("recusa requisições novas, espera rotinas e requisições e só então fecha fila e banco", async () => {
    const { container, order } = target();
    let release!: () => void;
    const request = lifecycle.track(() => new Promise<void>((r) => (release = r)));
    const done = gracefulShutdown(container as never, 2_000, "SIGTERM");
    await new Promise((r) => setTimeout(r, 50));
    expect(lifecycle.isShuttingDown()).toBe(true);
    expect(order).toEqual(["rotinas"]);
    release();
    await request;
    expect(await done).toEqual({ jobsDone: true, requestsDone: true });
    expect(order).toEqual(["rotinas", "fila", "banco"]);
  });

  it("prazo esgotado: registra o aviso e fecha mesmo assim", async () => {
    const { container, order } = target(false);
    container.webhookQueue.close.mockRejectedValueOnce(new Error("redis fora"));
    expect(await gracefulShutdown(container as never, 1_000, "SIGTERM")).toEqual({ jobsDone: false, requestsDone: true });
    expect(container.logger.warn).toHaveBeenCalledWith(expect.stringContaining("Prazo do desligamento esgotado"), expect.anything());
    expect(container.logger.warn).toHaveBeenCalledWith("Falha ao fechar a fila", expect.anything());
    expect(order).toEqual(["rotinas", "banco"]);
  });
});
