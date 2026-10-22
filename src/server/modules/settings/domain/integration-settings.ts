import type { LineTotalPolicy } from "@/server/modules/integration/domain/line-totals";

/**
 * Parâmetros operacionais da integração, editáveis pela tela de Configurações.
 * Credenciais (Vision) ficam em variáveis de ambiente, nunca aqui.
 */
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

export function mergeSettings(stored: Partial<IntegrationSettings> | null | undefined): IntegrationSettings {
  const s = stored ?? {};
  return {
    sync: { ...DEFAULT_SETTINGS.sync, ...(s.sync ?? {}) },
    retry: { ...DEFAULT_SETTINGS.retry, ...(s.retry ?? {}) },
    reconcile: { ...DEFAULT_SETTINGS.reconcile, ...(s.reconcile ?? {}) },
    routing: { ...DEFAULT_SETTINGS.routing, ...(s.routing ?? {}) },
    documents: { ...DEFAULT_SETTINGS.documents, ...(s.documents ?? {}) },
    visionReturn: { ...DEFAULT_SETTINGS.visionReturn, ...(s.visionReturn ?? {}) },
  };
}

export interface SettingsRepository {
  get(): Promise<IntegrationSettings>;
  save(settings: IntegrationSettings): Promise<void>;
}
