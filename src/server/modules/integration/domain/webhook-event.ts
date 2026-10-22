/**
 * Evento de webhook recebido do Omie.
 *
 * O Omie espera resposta 2xx em até 7 s e entrega os eventos de cada aplicativo em fila (FIFO): um POST
 * que falha segura os seguintes. Por isso o recebimento só grava o evento e enfileira; o processamento
 * (achar o pedido e consultar o Omie) roda no worker, com novas tentativas.
 */
export const WEBHOOK_EVENT_STATUSES = ["RECEIVED", "QUEUED", "PROCESSING", "DONE", "IGNORED", "FAILED"] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

export const WEBHOOK_EVENT_STATUS_LABELS: Record<WebhookEventStatus, string> = {
  RECEIVED: "Recebido",
  QUEUED: "Na fila",
  PROCESSING: "Processando",
  DONE: "Processado",
  IGNORED: "Sem pedido relacionado",
  FAILED: "Falhou",
};

export interface WebhookEvent {
  id: string;
  source: string;
  messageId: string | null;
  topic: string | null;
  appKey: string | null;
  omieAccountId: string | null;
  payload: unknown;
  status: WebhookEventStatus;
  attempts: number;
  note: string | null;
  lastError: string | null;
  relatedOrderId: string | null;
  receivedAt: Date;
  enqueuedAt: Date | null;
  processedAt: Date | null;
}

/** Evento com o pedido e a conta já resolvidos, para a tela. */
export type WebhookEventView = WebhookEvent & { visionOrderCode: number | null; accountName: string | null };

export interface WebhookEventListFilter {
  status?: WebhookEventStatus | null;
  page: number;
  pageSize: number;
}

export interface WebhookEventRepository {
  /** Grava o evento; com `messageId` repetido devolve o existente (`inserted: false`). */
  insert(event: WebhookEvent): Promise<{ inserted: boolean; id: string }>;
  findById(id: string): Promise<WebhookEvent | null>;
  markQueued(ids: string[], at: Date): Promise<void>;
  /** Marca em processamento e soma uma tentativa. */
  markProcessing(id: string, at: Date): Promise<void>;
  markFinished(id: string, input: { status: "DONE" | "IGNORED"; note: string | null; relatedOrderId: string | null; omieAccountId: string | null }, at: Date): Promise<void>;
  /** `final`: esgotou as tentativas (FAILED); senão volta para a fila aguardando nova tentativa. */
  markError(id: string, error: string, final: boolean): Promise<void>;
  /** Eventos que ficaram sem chegar ao worker (Redis fora do ar, job perdido). */
  listStale(before: Date, limit: number): Promise<string[]>;
  listIdsByStatus(status: WebhookEventStatus, limit: number): Promise<string[]>;
  list(filter: WebhookEventListFilter): Promise<{ items: WebhookEventView[]; total: number; counts: Partial<Record<WebhookEventStatus, number>> }>;
  purgeBefore(date: Date): Promise<number>;
}

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

/** Campos de controle do corpo do webhook do Omie (messageId, topic, appKey), quando presentes. */
export function readWebhookEnvelope(payload: unknown): { messageId: string | null; topic: string | null; appKey: string | null } {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return { messageId: str(p.messageId ?? p.message_id), topic: str(p.topic), appKey: str(p.appKey ?? p.app_key) };
}

const ID_KEYS = ["idPedido", "codigo_pedido", "nCodPed", "nCodPedido", "idOrdemServico", "nCodOS", "codigoPedido"];

/** Ids de pedido/OS do Omie citados no evento (procura em qualquer nível do corpo). */
export function findOmieDocumentIds(value: unknown, depth = 0, out = new Set<number>()): Set<number> {
  if (depth > 5 || !value || typeof value !== "object") return out;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (ID_KEYS.includes(key)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out.add(n);
    } else if (v && typeof v === "object") findOmieDocumentIds(v, depth + 1, out);
  }
  return out;
}
