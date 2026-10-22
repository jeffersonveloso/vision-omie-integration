import { sleep } from "../http/json-http";

class Semaphore {
  private active = 0;
  private waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
  }

  release(): void {
    this.active--;
    this.waiting.shift()?.();
  }
}

/**
 * Controle de consumo da API Omie (artigo "Limites de Consumo da API do Omie"):
 *  - 240 req/min e 4 simultâneas por IP + App Key + método;
 *  - inclusões/alterações não devem ser simultâneas.
 * Aqui: leituras com até 2 simultâneas por método, escritas em fila única por App Key,
 * e intervalo mínimo entre inícios (≈ 200 req/min por método).
 */
export class OmieRateLimiter {
  private readonly semaphores = new Map<string, Semaphore>();
  private readonly lastStart = new Map<string, number>();

  constructor(private readonly options: { readConcurrency: number; minIntervalMs: number } = { readConcurrency: 2, minIntervalMs: 300 }) {}

  async schedule<T>(appKey: string, method: string, write: boolean, task: () => Promise<T>): Promise<T> {
    const key = write ? `${appKey}::__write__` : `${appKey}::${method}`;
    let semaphore = this.semaphores.get(key);
    if (!semaphore) {
      semaphore = new Semaphore(write ? 1 : this.options.readConcurrency);
      this.semaphores.set(key, semaphore);
    }
    await semaphore.acquire();
    try {
      const last = this.lastStart.get(key) ?? 0;
      const wait = last + this.options.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastStart.set(key, Date.now());
      return await task();
    } finally {
      semaphore.release();
    }
  }
}
