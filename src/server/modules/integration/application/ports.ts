import type { LookupEntity, LookupOption } from "@/server/modules/mappings/domain/types";
import type { ErrorCategory } from "../domain/integration-error";
import type { FinancialTitleSnapshot, FiscalSnapshot } from "../domain/omie-document";
import type { SyncRun } from "../domain/repositories";
import type { VisionOrderPayload, VisionOrderSummary } from "../domain/vision-order";

/** Registro de cada chamada externa — vira linha na linha do tempo do pedido. */
export interface ExternalCallRecord {
  system: "VISION" | "OMIE";
  operation: string;
  request: unknown;
  response?: unknown;
  error?: string;
  httpStatus?: number;
  durationMs: number;
  ok: boolean;
}

export type CallRecorder = (record: ExternalCallRecord) => void;

// ── Vision (ControllerAPI) ──────────────────────────────────────────────

export interface VisionParcelPayload {
  codigoLancamento: number;
  dataCadastroLancamento: string | null;
  codigoParcela: number;
  codigoEmpresa: number;
  numeroParcela: number;
  origemParcela: number;
  valorSaldo: number;
  valorParcela: number;
  numeroDocumento: string;
  codigoCarteira: number;
  pdfBoletoBase64?: string;
}

/** Definição `AutorizacaoNF` do Swagger da ControllerAPI. */
export interface VisionAuthorizationPayload {
  codigoPedido: number;
  numeroProtocoloAutorizacao: string;
  numeroNotaFiscal: string;
  numeroRPS: string;
  especieNotaFiscal: string;
  modeloNotaFiscal: string;
  serieNotaFiscal: string;
  chaveAcesso: string;
  tipo: string;
  dataAutorizacao: string;
  pdfNotaBase64?: string;
  xmlNotaBase64?: string;
  parcelas: VisionParcelPayload[];
  codigoIntegracao: number;
  tipoNotaFiscal: number;
}

/** Definição `RejeicaoNF`. */
export interface VisionRejectionPayload {
  codigoPedido: number;
  codigoMotivoRejeicao: string;
  descricaoMotivoRejeicao: string;
  codigoIntegracao: number;
  tipo: string;
  tipoNotaFiscal: number;
}

/** Definição `CancelamentoNFe`. */
export interface VisionCancellationPayload {
  codigoPedido: number;
  justificativaCancelamento: string;
  protocoloCancelamento: string;
  pdfNotaBase64?: string;
  xmlCancelamentoBase64?: string;
  codigoIntegracao: number;
  tipo: string;
  tipoNotaFiscal: number;
  dataAutorizacao: string | null;
  chaveAcesso: string;
  numeroNotaFiscal: string;
  numeroProtocoloAutorizacao: string;
  serieNotaFiscal: string;
  numeroRPS: string;
  especieNotaFiscal: string;
  modeloNotaFiscal: string;
}

/** Definição `BaixaLancamento`. */
export interface VisionPaymentPayload {
  codigoPedido: number;
  codigoParcela: number;
  dataPagamento: string;
  valorPagamento: number;
  valorJuros: number;
  valorDesconto: number;
  codigoContaCorrente: number;
  codigoIntegracao: number;
}

/** Definição `ExclusaoBaixa`. */
export interface VisionPaymentCancellationPayload {
  codigoPedido: number;
  codigoBaixa: number;
  codigoIntegracao: number;
}

export interface VisionListQuery {
  dataInicial: string;
  dataFinal: string;
  codigoStatus?: number | null;
  pagina: number;
  linhas: number;
}

/** Página de `busca/atualizados`. O Vision devolve `{ Pagina, Linhas, TotalRegistros, TotalPaginas, Pedidos }`. */
export interface VisionOrderPage {
  orders: VisionOrderSummary[];
  /** Linhas por página que o Vision efetivamente usou (pode diferir do pedido). */
  pageSize: number | null;
  totalPages: number | null;
  totalRecords: number | null;
}

export interface VisionGateway {
  listUpdatedOrders(query: VisionListQuery, recorder?: CallRecorder): Promise<VisionOrderPage>;
  getOrder(code: number, recorder?: CallRecorder): Promise<VisionOrderPayload>;
  sendInvoiceAuthorization(payload: VisionAuthorizationPayload, recorder?: CallRecorder): Promise<unknown>;
  sendInvoiceRejection(payload: VisionRejectionPayload, recorder?: CallRecorder): Promise<unknown>;
  sendInvoiceCancellation(payload: VisionCancellationPayload, recorder?: CallRecorder): Promise<unknown>;
  sendParcelPayment(payload: VisionPaymentPayload, recorder?: CallRecorder): Promise<unknown>;
  cancelParcelPayment(payload: VisionPaymentCancellationPayload, recorder?: CallRecorder): Promise<unknown>;
  testConnection(): Promise<{ message: string }>;
}

// ── Omie ────────────────────────────────────────────────────────────────

export interface OmieCredentials {
  appKey: string;
  appSecret: string;
}

export interface OmieDocumentRef {
  omieId: number;
  number: string | null;
  response?: Record<string, unknown>;
}

export interface OmieCompany {
  cnpj: string;
  name: string;
  inactive: boolean;
}

export interface OmieGateway {
  upsertCustomer(payload: Record<string, unknown>): Promise<{ customerId: number }>;
  findSalesOrder(integrationCode: string): Promise<OmieDocumentRef | null>;
  createSalesOrder(payload: Record<string, unknown>): Promise<OmieDocumentRef>;
  getSalesOrderFiscal(omieId: number): Promise<FiscalSnapshot>;
  findServiceOrder(integrationCode: string): Promise<OmieDocumentRef | null>;
  createServiceOrder(payload: Record<string, unknown>): Promise<OmieDocumentRef>;
  getServiceOrderFiscal(omieId: number): Promise<FiscalSnapshot>;
  listFinancialTitles(omieDocumentId: number): Promise<FinancialTitleSnapshot[]>;
  listLookup(entity: LookupEntity): Promise<LookupOption[]>;
  listCompanies(): Promise<OmieCompany[]>;
}

export interface OmieGatewayFactory {
  forAccount(credentials: OmieCredentials, recorder?: CallRecorder): OmieGateway;
}

export interface DocumentDownloader {
  /** Baixa PDF/XML por URL (links do Omie). Retorna null se indisponível. */
  download(url: string): Promise<Buffer | null>;
}

// ── Avisos ao fim de cada execução (alertas) ───────────────────────────

export interface RunNotice {
  run: SyncRun;
  /** Pedidos que entraram em erro (ou mudaram de erro) nesta execução. */
  failures: Array<{ orderId: string; visionOrderCode: number; category: ErrorCategory; message: string }>;
  /** Notas que passaram a ser rejeitadas nesta execução. */
  rejections: Array<{ orderId: string; visionOrderCode: number; message: string }>;
}

export interface RunNotifier {
  /** Nunca deve lançar erro: falha no aviso não pode afetar a execução. */
  notifyRun(notice: RunNotice): Promise<void>;
}

// ── Fila dos webhooks do Omie ─────────────────────────────────────────

export interface WebhookJobContext {
  /** Tentativa atual (1, 2, …) e o máximo configurado na fila. */
  attempt: number;
  maxAttempts: number;
}

export type WebhookJobProcessor = (eventId: string, context: WebhookJobContext) => Promise<void>;

export interface WebhookQueue {
  /** "redis" (BullMQ, durável e compartilhada entre instâncias) ou "memory" (desenvolvimento). */
  readonly mode: "redis" | "memory";
  /** Enfileira pelo id do evento; repetir o mesmo id não duplica o job. Lança erro se a fila estiver fora. */
  enqueue(eventId: string): Promise<void>;
  /** Liga o processamento neste processo (worker). */
  startWorker(processor: WebhookJobProcessor): Promise<void>;
  counts(): Promise<{ waiting: number; active: number; delayed: number; failed: number; completed: number } | null>;
  close(): Promise<void>;
}
