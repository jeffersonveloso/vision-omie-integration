import type { LookupEntity, LookupOption } from "@/server/modules/mappings/domain/types";
import type { FinancialTitleSnapshot, FiscalSnapshot } from "../domain/omie-document";
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

export interface VisionGateway {
  listUpdatedOrders(query: VisionListQuery, recorder?: CallRecorder): Promise<VisionOrderSummary[]>;
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
