import { brDateTimeToIso } from "@/server/shared/domain/dates";
import type { CallRecorder, OmieCompany, OmieCredentials, OmieDocumentRef, OmieGateway, OmieGatewayFactory } from "@/server/modules/integration/application/ports";
import { IntegrationError } from "@/server/modules/integration/domain/integration-error";
import type { FinancialTitleSnapshot, FiscalSnapshot } from "@/server/modules/integration/domain/omie-document";
import type { LookupEntity, LookupOption } from "@/server/modules/mappings/domain/types";
import { OmieApiClient, OmieCallError, type OmieClientConfig } from "./omie-api-client";
import type { OmieRateLimiter } from "./omie-rate-limiter";

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Obj[]) : v && typeof v === "object" ? [v as Obj] : []);
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function unwrap(error: unknown): never {
  if (error instanceof OmieCallError) throw error.integrationError;
  throw error;
}

function statusError(service: string, method: string, response: Obj, statusKey: string, descKey: string): IntegrationError | null {
  const status = str(response[statusKey]);
  if (status && status !== "0") {
    return new IntegrationError({
      category: "OMIE_BUSINESS",
      code: `STATUS_${status}`,
      message: `O Omie recusou a operação (${service} › ${method}): ${str(response[descKey]) ?? `status ${status}`}`,
      hint: "Corrija o cadastro/mapeamento indicado e reenvie.",
      details: { response },
    });
  }
  return null;
}

interface LookupDefinition {
  service: string;
  method: string;
  param: (page: number) => Obj;
  items: (res: Obj) => Obj[];
  pages: (res: Obj) => number;
  map: (item: Obj) => LookupOption | LookupOption[] | null;
}

const pagesStd = (res: Obj) => num(res.total_de_paginas) || 1;
const pagesN = (res: Obj) => num(res.nTotPaginas) || 1;

/** Cadastros do Omie que alimentam os combos da tela de mapeamento (documentação oficial de cada serviço). */
const LOOKUPS: Record<LookupEntity, LookupDefinition> = {
  produtos: {
    service: "geral/produtos",
    method: "ListarProdutosResumido",
    param: (p) => ({ pagina: p, registros_por_pagina: 100, apenas_importado_api: "N", filtrar_apenas_omiepdv: "N" }),
    items: (r) => arr(r.produto_servico_resumido),
    pages: pagesStd,
    map: (i) => ({ value: String(i.codigo_produto), label: `${str(i.codigo) ?? ""} — ${str(i.descricao) ?? ""}`.trim(), description: i.valor_unitario ? `R$ ${num(i.valor_unitario).toFixed(2)}` : undefined }),
  },
  servicos: {
    service: "servicos/servico",
    method: "ListarCadastroServico",
    param: (p) => ({ nPagina: p, nRegPorPagina: 100 }),
    items: (r) => arr(r.cadastros),
    pages: pagesN,
    map: (i) => {
      const cab = arr(i.cabecalho)[0] ?? {};
      const id = (i.intListar as Obj | undefined)?.nCodServ;
      return id ? { value: String(id), label: `${str(cab.cCodigo) ?? ""} — ${str(cab.cDescricao) ?? ""}`.trim(), description: str(cab.cCodLC116) ? `LC116 ${cab.cCodLC116}` : undefined } : null;
    },
  },
  categorias: {
    service: "geral/categorias",
    method: "ListarCategorias",
    param: (p) => ({ pagina: p, registros_por_pagina: 100 }),
    items: (r) => arr(r.categoria_cadastro),
    pages: pagesStd,
    map: (i) => (str(i.totalizadora) === "S" ? null : { value: String(i.codigo), label: `${i.codigo} — ${str(i.descricao) ?? ""}`, description: str(i.natureza) ?? undefined, inactive: str(i.conta_inativa) === "S" }),
  },
  departamentos: {
    service: "geral/departamentos",
    method: "ListarDepartamentos",
    param: (p) => ({ pagina: p, registros_por_pagina: 100 }),
    items: (r) => arr(r.departamentos),
    pages: pagesStd,
    map: (i) => ({ value: String(i.codigo), label: str(i.descricao) ?? String(i.codigo), description: str(i.estrutura) ?? undefined, inactive: str(i.inativo) === "S" }),
  },
  projetos: {
    service: "geral/projetos",
    method: "ListarProjetos",
    param: (p) => ({ pagina: p, registros_por_pagina: 100, apenas_importado_api: "N" }),
    items: (r) => arr(r.cadastro),
    pages: pagesStd,
    map: (i) => ({ value: String(i.codigo), label: str(i.nome) ?? String(i.codigo), inactive: str(i.inativo) === "S" }),
  },
  contas_correntes: {
    service: "geral/contacorrente",
    method: "ListarContasCorrentes",
    param: (p) => ({ pagina: p, registros_por_pagina: 100, apenas_importado_api: "N" }),
    items: (r) => arr(r.ListarContasCorrentes),
    pages: pagesStd,
    map: (i) => ({
      value: String(i.nCodCC),
      label: str(i.descricao) ?? String(i.nCodCC),
      description: [str(i.codigo_banco) && `Banco ${i.codigo_banco}`, str(i.codigo_agencia) && `Ag. ${i.codigo_agencia}`, str(i.numero_conta_corrente) && `CC ${i.numero_conta_corrente}`].filter(Boolean).join(" · ") || undefined,
    }),
  },
  vendedores: {
    service: "geral/vendedores",
    method: "ListarVendedores",
    param: (p) => ({ pagina: p, registros_por_pagina: 100, apenas_importado_api: "N" }),
    items: (r) => arr(r.cadastro),
    pages: pagesStd,
    map: (i) => ({ value: String(i.codigo), label: str(i.nome) ?? String(i.codigo), description: str(i.email) ?? undefined, inactive: str(i.inativo) === "S" }),
  },
  parcelas: {
    service: "geral/parcelas",
    method: "ListarParcelas",
    param: (p) => ({ pagina: p, registros_por_pagina: 100 }),
    items: (r) => arr(r.cadastros),
    pages: pagesStd,
    map: (i) => ({ value: String(i.nCodigo), label: `${i.nCodigo} — ${str(i.cDescricao) ?? ""}`, description: i.nParcelas ? `${i.nParcelas} parcela(s)` : undefined }),
  },
  etapas_faturamento: {
    service: "produtos/etapafat",
    method: "ListarEtapasFaturamento",
    param: (p) => ({ pagina: p, registros_por_pagina: 100 }),
    items: (r) => arr(r.cadastros),
    pages: pagesStd,
    map: (i) =>
      arr(i.etapas).map((e) => ({
        value: String(e.cCodigo),
        label: `${e.cCodigo} — ${str(e.cDescricao) ?? str(e.cDescrPadrao) ?? ""}`,
        description: str(i.cDescOperacao) ?? undefined,
        inactive: str(e.cInativo) === "S",
      })),
  },
  cenarios_impostos: {
    service: "geral/cenarios",
    method: "ListarCenarios",
    param: (p) => ({ nPagina: p, nRegPorPagina: 100 }),
    items: (r) => arr(r.cenariosEncontrados),
    pages: pagesN,
    map: (i) => ({ value: String(i.nCodigo), label: `${i.nCodigo} — ${str(i.cNome) ?? ""}`, description: i.padrao ? "Cenário padrão" : undefined, inactive: str(i.inativo) === "S" }),
  },
};

/**
 * Adaptador Omie → portas da aplicação. Interpreta as respostas oficiais:
 *  - StatusPedido.ListaNfe   → situação da NF-e (autorizada / rejeitada / cancelada)
 *  - StatusOS.ListaRpsNfse   → situação da NFS-e
 *  - MovimentosFinanceiros   → títulos e baixas (nCodOS = pedido de venda ou OS)
 */
export class OmieGatewayAdapter implements OmieGateway {
  constructor(private readonly client: OmieApiClient) {}

  async upsertCustomer(payload: Record<string, unknown>): Promise<{ customerId: number }> {
    const res = await this.client.call<Obj>("geral/clientes", "UpsertClienteCpfCnpj", payload).catch(unwrap);
    const error = statusError("geral/clientes", "UpsertClienteCpfCnpj", res, "codigo_status", "descricao_status");
    if (error) throw error;
    const id = num(res.codigo_cliente_omie);
    if (!id) throw new IntegrationError({ category: "OMIE_BUSINESS", code: "NO_CUSTOMER_ID", message: "O Omie não retornou o código do cliente.", details: { response: res } });
    return { customerId: id };
  }

  async findSalesOrder(integrationCode: string): Promise<OmieDocumentRef | null> {
    try {
      const res = await this.client.call<Obj>("produtos/pedido", "StatusPedido", { codigo_pedido_integracao: integrationCode }, { cache: false });
      const id = num(res.codigo_pedido);
      return id ? { omieId: id, number: str(res.numero_pedido), response: res } : null;
    } catch (error) {
      if (error instanceof OmieCallError && (error.kind === "NOT_FOUND" || error.kind === "EMPTY_LIST")) return null;
      return unwrap(error);
    }
  }

  async createSalesOrder(payload: Record<string, unknown>): Promise<OmieDocumentRef> {
    try {
      const res = await this.client.call<Obj>("produtos/pedido", "IncluirPedido", payload);
      const error = statusError("produtos/pedido", "IncluirPedido", res, "codigo_status", "descricao_status");
      if (error) throw error;
      return { omieId: num(res.codigo_pedido), number: str(res.numero_pedido), response: res };
    } catch (error) {
      if (error instanceof OmieCallError && error.kind === "DUPLICATE") {
        const code = String((payload.cabecalho as Obj | undefined)?.codigo_pedido_integracao ?? "");
        const existing = code ? await this.findSalesOrder(code) : null;
        if (existing) return existing;
      }
      return unwrap(error);
    }
  }

  async getSalesOrderFiscal(omieId: number): Promise<FiscalSnapshot> {
    const res = await this.client.call<Obj>("produtos/pedido", "StatusPedido", { codigo_pedido: omieId }).catch(unwrap);
    const nfes = arr(res.ListaNfe);
    const authorized = [...nfes].reverse().find((n) => /^\d{44}$/.test(str(n.chave_nfe) ?? "") && num(n.protocolo) > 0);
    const latest = nfes[nfes.length - 1];
    const base: FiscalSnapshot = {
      state: "PENDING",
      invoiceNumber: null,
      series: null,
      accessKey: null,
      protocol: null,
      rpsNumber: null,
      verificationCode: null,
      authorizedAt: null,
      cancelledAt: null,
      rejectionCode: null,
      rejectionMessage: null,
      pdfUrl: null,
      xml: null,
      omieStage: str(res.etapa),
    };
    const fromNfe = (n: Obj): Partial<FiscalSnapshot> => ({
      invoiceNumber: str(n.numero_nfe),
      series: str(n.serie_nfe),
      accessKey: str(n.chave_nfe),
      protocol: str(n.protocolo),
      authorizedAt: brDateTimeToIso(str(n.data_emissao), str(n.hora_emissao)),
      pdfUrl: str(n.danfe),
      xml: str(n.xml_distr),
    });
    if (str(res.cancelada) === "S") return { ...base, ...(authorized ? fromNfe(authorized) : {}), state: "CANCELLED" };
    if (authorized) return { ...base, ...fromNfe(authorized), state: "AUTHORIZED" };
    if (latest) {
      const messages = arr(latest.mensagens);
      const statusText = `${str(latest.status_nfe) ?? ""} ${str(latest.status_lote) ?? ""}`;
      const rejected = /rejei|deneg|erro|inválid/i.test(statusText) || (messages.length > 0 && !/process|receb|aguard/i.test(statusText));
      if (rejected) {
        const m = messages[0] ?? {};
        return { ...base, state: "REJECTED", rejectionCode: str(m.cCodigo) ?? str(latest.status_nfe), rejectionMessage: [str(m.cDescricao), str(m.cCorrecao)].filter(Boolean).join(" — ") || statusText.trim() || "NF-e rejeitada" };
      }
    }
    return base;
  }

  async findServiceOrder(integrationCode: string): Promise<OmieDocumentRef | null> {
    try {
      const res = await this.client.call<Obj>("servicos/os", "StatusOS", { cCodIntOS: integrationCode }, { cache: false });
      const id = num(res.nCodOS);
      return id ? { omieId: id, number: str(res.cNumOS), response: res } : null;
    } catch (error) {
      if (error instanceof OmieCallError && (error.kind === "NOT_FOUND" || error.kind === "EMPTY_LIST")) return null;
      return unwrap(error);
    }
  }

  async createServiceOrder(payload: Record<string, unknown>): Promise<OmieDocumentRef> {
    try {
      const res = await this.client.call<Obj>("servicos/os", "IncluirOS", payload);
      const error = statusError("servicos/os", "IncluirOS", res, "cCodStatus", "cDescStatus");
      if (error) throw error;
      return { omieId: num(res.nCodOS), number: str(res.cNumOS), response: res };
    } catch (error) {
      if (error instanceof OmieCallError && error.kind === "DUPLICATE") {
        const code = String((payload.Cabecalho as Obj | undefined)?.cCodIntOS ?? "");
        const existing = code ? await this.findServiceOrder(code) : null;
        if (existing) return existing;
      }
      return unwrap(error);
    }
  }

  async getServiceOrderFiscal(omieId: number): Promise<FiscalSnapshot> {
    const res = await this.client.call<Obj>("servicos/os", "StatusOS", { nCodOS: omieId, lPdfDest: true, lMsg: true }).catch(unwrap);
    const list = arr(res.ListaRpsNfse);
    const issued = [...list].reverse().find((x) => (str(x.nNfse) ?? "0") !== "0");
    const latest = list[list.length - 1];
    const base: FiscalSnapshot = {
      state: "PENDING",
      invoiceNumber: null,
      series: null,
      accessKey: null,
      protocol: null,
      rpsNumber: null,
      verificationCode: null,
      authorizedAt: null,
      cancelledAt: null,
      rejectionCode: null,
      rejectionMessage: null,
      pdfUrl: null,
      xml: null,
      omieStage: str(res.cEtapa),
    };
    const fromRps = (x: Obj): Partial<FiscalSnapshot> => ({
      invoiceNumber: str(x.nNfse),
      rpsNumber: str(x.nRps),
      verificationCode: str(x.cCodVerif),
      protocol: str(x.cProtocolo),
      authorizedAt: brDateTimeToIso(str(res.dDtFat), str(res.cHrFat)),
      pdfUrl: str(x.cUrlPdfDest) ?? str(x.cUrlNfse) ?? str(x.danfe),
      xml: str(x.xml_distr),
    });
    if (str(res.cCancelada) === "S") return { ...base, ...(issued ? fromRps(issued) : {}), state: "CANCELLED", cancelledAt: brDateTimeToIso(str(res.dDtCanc), str(res.cHrCanc)) };
    if (issued) return { ...base, ...fromRps(issued), state: "AUTHORIZED" };
    if (latest) {
      const messages = arr(latest.mensagens);
      const statusText = `${str(latest.cStatusRps) ?? ""} ${str(latest.cStatusLote) ?? ""}`;
      const errorMessage = messages.find((m) => /erro|rejei|inválid/i.test(`${str(m.cSituacao) ?? ""} ${str(m.cDescricao) ?? ""}`)) ?? (messages.length && !/process|aguard|envi/i.test(statusText) ? messages[0] : undefined);
      if (errorMessage || /rejei|erro/i.test(statusText)) {
        const m = errorMessage ?? {};
        return { ...base, state: "REJECTED", rpsNumber: str(latest.nRps), rejectionCode: str(m.cCodigo) ?? str(latest.cStatusRps), rejectionMessage: [str(m.cDescricao), str(m.cCorrecao)].filter(Boolean).join(" — ") || "NFS-e rejeitada pela prefeitura" };
      }
    }
    return base;
  }

  async listFinancialTitles(omieDocumentId: number): Promise<FinancialTitleSnapshot[]> {
    const titles = new Map<number, FinancialTitleSnapshot>();
    for (let page = 1; page <= 10; page++) {
      let res: Obj;
      try {
        res = await this.client.call<Obj>("financas/mf", "ListarMovimentos", { nPagina: page, nRegPorPagina: 100, nCodOS: omieDocumentId, cNatureza: "R" });
      } catch (error) {
        if (error instanceof OmieCallError && (error.kind === "EMPTY_LIST" || error.kind === "NOT_FOUND")) break;
        return unwrap(error);
      }
      for (const movement of arr(res.movimentos)) {
        const d = (movement.detalhes ?? {}) as Obj;
        const r = (movement.resumo ?? {}) as Obj;
        const titleId = num(d.nCodTitulo);
        if (!titleId) continue;
        const parcel = /^(\d+)\//.exec(str(d.cNumParcela) ?? "");
        const title = titles.get(titleId) ?? {
          omieTitleId: titleId,
          titleNumber: str(d.cNumTitulo),
          parcelLabel: str(d.cNumParcela),
          parcelNumber: parcel ? Number(parcel[1]) : null,
          amount: num(d.nValorTitulo),
          openAmount: r.nValAberto !== undefined ? num(r.nValAberto) : null,
          dueDate: str(d.dDtVenc),
          status: str(d.cStatus),
          createdAt: brDateTimeToIso(str(d.dDtInc), str(d.cHrInc)),
          payments: [],
        };
        const paymentId = num(d.nCodBaixa);
        if (paymentId && str(d.dDtPagamento) && !title.payments.some((p) => p.omieBaixaId === paymentId)) {
          title.payments.push({
            omieBaixaId: paymentId,
            paidAt: brDateTimeToIso(str(d.dDtPagamento), null),
            amount: num(d.nValorMovCC) || num(r.nValPago),
            interest: num(d.nJuros),
            discount: num(d.nDesconto),
            fine: num(d.nMulta),
            bankAccountId: num(d.nCodCC) || null,
          });
        }
        titles.set(titleId, title);
      }
      if (page >= (num(res.nTotPaginas) || 1)) break;
    }
    return [...titles.values()].sort((a, b) => (a.parcelNumber ?? 0) - (b.parcelNumber ?? 0));
  }

  async listLookup(entity: LookupEntity): Promise<LookupOption[]> {
    const def = LOOKUPS[entity];
    const options: LookupOption[] = [];
    for (let page = 1; page <= 50; page++) {
      let res: Obj;
      try {
        res = await this.client.call<Obj>(def.service, def.method, def.param(page));
      } catch (error) {
        if (error instanceof OmieCallError && error.kind === "EMPTY_LIST") break;
        return unwrap(error);
      }
      for (const item of def.items(res)) {
        const mapped = def.map(item);
        if (Array.isArray(mapped)) options.push(...mapped);
        else if (mapped) options.push(mapped);
      }
      if (page >= def.pages(res)) break;
    }
    const seen = new Set<string>();
    return options.filter((o) => {
      const key = `${o.value}|${o.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async listCompanies(): Promise<OmieCompany[]> {
    const res = await this.client.call<Obj>("geral/empresas", "ListarEmpresas", { pagina: 1, registros_por_pagina: 50, apenas_importado_api: "N" }, { cache: false }).catch(unwrap);
    return arr(res.empresas_cadastro).map((e) => ({ cnpj: (str(e.cnpj) ?? "").replace(/[.\-/\s]/g, "").toUpperCase(), name: str(e.razao_social) ?? str(e.nome_fantasia) ?? "", inactive: str(e.inativa) === "S" }));
  }
}

export class OmieGatewayFactoryImpl implements OmieGatewayFactory {
  constructor(
    private readonly config: OmieClientConfig,
    private readonly limiter: OmieRateLimiter,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  forAccount(credentials: OmieCredentials, recorder?: CallRecorder): OmieGateway {
    return new OmieGatewayAdapter(new OmieApiClient(this.config, this.limiter, credentials, recorder, this.fetchImpl));
  }
}
