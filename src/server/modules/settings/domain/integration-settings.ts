import type { LineTotalPolicy } from "@/server/modules/integration/domain/line-totals";

/**
 * Parâmetros operacionais da integração, editáveis pela tela de Configurações.
 * Credenciais (Vision) ficam em variáveis de ambiente, nunca aqui.
 */
export interface PaymentFormTerm {
  /** codigoFormaPagamento do pedido no Vision. */
  visionCode: number;
  visionDescription: string;
  /** Código da condição na tabela de parcelas do Omie (ex.: "000" à vista). */
  omieCode: string;
  omieDescription: string;
}

export interface PaymentTermsSettings {
  byPaymentForm: PaymentFormTerm[];
  /** Para pedidos sem parcelas cuja forma de pagamento não está na lista. Vazio = o pedido para com pendência. */
  defaultCondition: string | null;
  defaultConditionDescription: string;
}

export interface IntegrationSettings {
  sync: {
    /** Liga/desliga a coleta automática de pedidos do Vision. */
    enabled: boolean;
    /** Expressão cron (5 campos) da coleta + envio. */
    cron: string;
    /** Na primeira execução, quantos dias para trás buscar. */
    initialLookbackDays: number;
    /** Sobreposição da janela incremental (dias) para não perder pedidos na virada de data. */
    overlapDays: number;
    /** Registros por página na consulta de atualizados. */
    pageSize: number;
    /** Situações do Vision elegíveis (vazio = todas). */
    eligibleStatusCodes: number[];
    /** Máximo de pedidos enviados por execução. */
    maxOrdersPerRun: number;
    /** Pedidos processados em paralelo (o Omie aceita 4 req. simultâneas por método). */
    concurrency: number;
  };
  retry: {
    maxAutoRetries: number;
    /** Espera (minutos) entre tentativas automáticas: 1ª, 2ª, 3ª... */
    backoffMinutes: number[];
  };
  reconcile: {
    enabled: boolean;
    cron: string;
    /** Por quantos dias acompanhar NF e títulos de um pedido enviado. */
    windowDays: number;
    maxOrdersPerRun: number;
    returnFinancial: boolean;
    attachXml: boolean;
    attachPdf: boolean;
  };
  routing: {
    /** Caminhos no pedido Vision onde procurar o CNPJ da empresa faturadora, em ordem. */
    cnpjFieldPaths: string[];
    /** Tabela de-para usada quando o CNPJ não vier no pedido (código da empresa → CNPJ). */
    companyCodeMapKey: string;
  };
  documents: {
    sendSalesOrders: boolean;
    sendServiceOrders: boolean;
    /** Prefixo dos códigos de integração no Omie (ex.: VIS-14100). */
    integrationCodePrefix: string;
    /** Envia as parcelas do Vision como parcelas manuais (código de parcela 999). */
    sendVisionInstallments: boolean;
    /** Atualiza o cadastro do cliente no Omie a cada envio (UpsertClienteCpfCnpj). */
    upsertCustomer: boolean;
    /** O que fazer quando quantidade × valor unitário não fecha o valor total da linha no Vision. */
    lineTotalMismatch: LineTotalPolicy;
  };
  /**
   * Condição de pagamento do Omie (cabecalho.codigo_parcela / Cabecalho.cCodParc).
   * Ordem: parcelas do Vision (999) → forma de pagamento → condição padrão. Uma regra na tela de
   * mapeamento para o campo substitui tudo isso.
   */
  paymentTerms: PaymentTermsSettings;
  /** Alertas no Slack (Incoming Webhook em SLACK_WEBHOOK_URL). */
  alerts: {
    enabled: boolean;
    /** Rotina de coleta/envio ou de retorno que falhou (ex.: Vision ou Omie fora do ar). */
    onJobFailure: boolean;
    /** Pedidos que entraram em erro (ou mudaram de erro) na execução. Novas tentativas do mesmo erro não repetem o alerta. */
    onOrderErrors: boolean;
    /** Notas rejeitadas pela SEFAZ/prefeitura. */
    onRejection: boolean;
    /** Intervalo mínimo entre alertas iguais de falha de rotina (minutos). */
    cooldownMinutes: number;
  };
  /** Retenção (dias). A limpeza roda todo dia às 03:17 no fuso da operação. */
  logs: {
    /** Linha do tempo (informações e avisos), execuções e webhooks recebidos. */
    retentionDays: number;
    /** Registros de erro da linha do tempo. */
    errorRetentionDays: number;
    /** Auditoria de alterações e ações manuais. */
    auditRetentionDays: number;
  };
  /** Convenções dos payloads de retorno à ControllerAPI do Vision (validar com o suporte Vision). */
  visionReturn: {
    codigoIntegracao: number;
    tipoNotaFiscalProduto: number;
    tipoNotaFiscalServico: number;
    tipoProduto: string;
    tipoServico: string;
    especieProduto: string;
    especieServico: string;
    modeloProduto: string;
    modeloServico: string;
    /** Valor enviado em `parcelas[].origemParcela` (enum 0|1|2 do Swagger; confirmar com o Vision). */
    origemParcela: number;
    /** Conta corrente do Vision usada nas baixas quando não houver de-para. */
    defaultCodigoContaCorrente: number | null;
    contaCorrenteMapKey: string;
  };
}

export const DEFAULT_SETTINGS: IntegrationSettings = {
  sync: {
    enabled: true,
    cron: "*/5 * * * *",
    initialLookbackDays: 7,
    overlapDays: 1,
    pageSize: 50,
    eligibleStatusCodes: [],
    maxOrdersPerRun: 100,
    concurrency: 2,
  },
  retry: {
    maxAutoRetries: 5,
    backoffMinutes: [2, 10, 30, 60, 180],
  },
  reconcile: {
    enabled: true,
    cron: "*/10 * * * *",
    windowDays: 60,
    maxOrdersPerRun: 200,
    returnFinancial: true,
    attachXml: true,
    attachPdf: false,
  },
  routing: {
    cnpjFieldPaths: ["cnpjEmpresa", "empresa.cnpj", "cnpjFaturador", "empresaCnpj"],
    companyCodeMapKey: "empresa-cnpj",
  },
  documents: {
    sendSalesOrders: true,
    sendServiceOrders: true,
    integrationCodePrefix: "VIS",
    sendVisionInstallments: true,
    upsertCustomer: true,
    lineTotalMismatch: "BLOCK",
  },
  alerts: {
    enabled: false,
    onJobFailure: true,
    onOrderErrors: true,
    onRejection: true,
    cooldownMinutes: 60,
  },
  logs: {
    retentionDays: 90,
    errorRetentionDays: 365,
    auditRetentionDays: 730,
  },
  paymentTerms: {
    byPaymentForm: [],
    defaultCondition: null,
    defaultConditionDescription: "",
  },
  visionReturn: {
    codigoIntegracao: 1,
    tipoNotaFiscalProduto: 0,
    tipoNotaFiscalServico: 1,
    tipoProduto: "NFE",
    tipoServico: "NFSE",
    especieProduto: "NF-e",
    especieServico: "NFS-e",
    modeloProduto: "55",
    modeloServico: "",
    origemParcela: 1,
    defaultCodigoContaCorrente: null,
    contaCorrenteMapKey: "conta-corrente-retorno",
  },
};

/**
 * Valores iniciais vindos do ambiente (antes de alguém salvar a tela de Configurações).
 * Ex.: SYNC_INITIAL_LOOKBACK_DAYS define quantos dias a primeira coleta busca.
 */
export function settingsDefaults(overrides: { initialLookbackDays?: number } = {}): IntegrationSettings {
  return {
    ...DEFAULT_SETTINGS,
    sync: { ...DEFAULT_SETTINGS.sync, ...(overrides.initialLookbackDays !== undefined ? { initialLookbackDays: overrides.initialLookbackDays } : {}) },
  };
}

export function mergeSettings(stored: Partial<IntegrationSettings> | null | undefined, defaults: IntegrationSettings = DEFAULT_SETTINGS): IntegrationSettings {
  const s = stored ?? {};
  return {
    sync: { ...defaults.sync, ...(s.sync ?? {}) },
    retry: { ...defaults.retry, ...(s.retry ?? {}) },
    reconcile: { ...defaults.reconcile, ...(s.reconcile ?? {}) },
    routing: { ...defaults.routing, ...(s.routing ?? {}) },
    documents: { ...defaults.documents, ...(s.documents ?? {}) },
    paymentTerms: { ...defaults.paymentTerms, ...(s.paymentTerms ?? {}) },
    logs: { ...defaults.logs, ...(s.logs ?? {}) },
    alerts: { ...defaults.alerts, ...(s.alerts ?? {}) },
    visionReturn: { ...defaults.visionReturn, ...(s.visionReturn ?? {}) },
  };
}

export interface SettingsRepository {
  get(): Promise<IntegrationSettings>;
  save(settings: IntegrationSettings): Promise<void>;
}
