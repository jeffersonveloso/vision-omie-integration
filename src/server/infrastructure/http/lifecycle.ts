/**
 * Estado do processo para o desligamento ordenado: requisições em andamento e se já está desligando.
 * Fica em globalThis porque o `instrumentation` (que instala o desligamento) e as rotas são empacotados
 * separadamente no build do Next e teriam cópias diferentes deste módulo.
 */
interface LifecycleState {
  shuttingDown: boolean;
  active: number;
}

const KEY = "__visionOmieLifecycle";
const g = globalThis as unknown as Record<string, LifecycleState | undefined>;

function state(): LifecycleState {
  return (g[KEY] ??= { shuttingDown: false, active: 0 });
}

export const lifecycle = {
  isShuttingDown: () => state().shuttingDown,
  markShuttingDown: () => {
    state().shuttingDown = true;
  },
  activeRequests: () => state().active,
  /** Conta a requisição enquanto `fn` roda. */
  async track<T>(fn: () => Promise<T>): Promise<T> {
    state().active++;
    try {
      return await fn();
    } finally {
      state().active--;
    }
  },
  /** Espera as requisições em andamento terminarem (até `timeoutMs`). */
  async waitIdle(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (state().active > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    return state().active === 0;
  },
  /** Só para testes. */
  reset: () => {
    g[KEY] = { shuttingDown: false, active: 0 };
  },
};
