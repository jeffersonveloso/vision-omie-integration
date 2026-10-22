import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { COMPANIES, OMIE_CATALOG } from "./fixtures";
import { readJsonBody, send } from "./http-utils";

type Obj = Record<string, unknown>;

interface SimDocument {
  kind: "PV" | "OS";
  id: number;
  number: string;
  integrationCode: string;
  payload: Obj;
  checks: number;
  state: "PENDING" | "AUTHORIZED" | "REJECTED" | "CANCELLED";
  invoiceNumber?: string;
  accessKey?: string;
  titles: Array<{ id: number; parcel: number; total: number; amount: number; due: string; payments: Array<{ id: number; date: string; amount: number }> }>;
}

interface SimApp {
  appKey: string;
  appSecret: string;
  company: { name: string; cnpj: string };
  customers: Map<string, { id: number; payload: Obj }>;
  documents: SimDocument[];
}

export interface OmieSimulator {
  url: string;
  server: Server;
  apps: Map<string, SimApp>;
  calls: Array<{ appKey: string; call: string; param: Obj }>;
  /** Pedidos cuja NF será rejeitada pela "SEFAZ" (por código de integração). */
  rejectIntegrationCodes: Set<string>;
  /** Pedidos que recebem baixa da 1ª parcela logo após a autorização. */
  payIntegrationCodes: Set<string>;
  /** Simula resposta perdida (pedido criado, conexão cai) na próxima inclusão destes códigos. */
  dropResponseOnce: Set<string>;
  close(): Promise<void>;
}

const fault = (message: string, code = "SOAP-ENV:Client-102") => ({ faultstring: `ERROR: ${message}`, faultcode: code });
const br = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
const today = () => br(new Date().toISOString());
const productIds = new Set(OMIE_CATALOG.produtos.map((p) => p.codigo_produto));
const serviceIds = new Set(OMIE_CATALOG.servicos.map((s) => s.nCodServ));
const categoryCodes = new Set(OMIE_CATALOG.categorias.map((c) => c.codigo));
const accountIds = new Set(OMIE_CATALOG.contasCorrentes.map((c) => c.nCodCC));

function page<T>(items: T[], pageNumber: number, size: number) {
  const total = items.length;
  return { slice: items.slice((pageNumber - 1) * size, pageNumber * size), totalPages: Math.max(1, Math.ceil(total / size)), total };
}

/**
 * Simulador da API Omie (JSON): mesma URL/forma de chamada da API real
 * (POST /api/v1/{serviço}/ com {call, app_key, app_secret, param}) e respostas
 * com os campos documentados. O faturamento acontece na 2ª consulta de status.
 */
export async function startOmieSimulator(port = 0): Promise<OmieSimulator> {
  const apps = new Map<string, SimApp>();
  for (const company of [COMPANIES.matriz, COMPANIES.filial]) {
    apps.set(company.appKey, { appKey: company.appKey, appSecret: company.appSecret, company: { name: company.name, cnpj: company.cnpj }, customers: new Map(), documents: [] });
  }
  let seq = 1000;
  const calls: OmieSimulator["calls"] = [];
  const rejectIntegrationCodes = new Set<string>();
  const payIntegrationCodes = new Set<string>();
  const dropResponseOnce = new Set<string>();

  function advance(app: SimApp, doc: SimDocument) {
    doc.checks++;
    if (doc.state === "PENDING" && doc.checks >= 2) {
      if (rejectIntegrationCodes.has(doc.integrationCode)) {
        doc.state = "REJECTED";
        return;
      }
      doc.state = "AUTHORIZED";
      doc.invoiceNumber = String(++seq);
      doc.accessKey = `3126${String(Date.now()).padStart(13, "0")}${String(doc.id).padStart(27, "0")}`.slice(0, 44);
      const parcelList = doc.kind === "PV" ? ((doc.payload.lista_parcelas as Obj | undefined)?.parcela as Obj[] | undefined) : (doc.payload.Parcelas as Obj[] | undefined);
      const parcels = parcelList?.length ? parcelList : [{ valor: 100, data_vencimento: today() }];
      doc.titles = parcels.map((p, i) => ({
        id: ++seq,
        parcel: i + 1,
        total: parcels.length,
        amount: Number(p.valor ?? p.nValor ?? 0),
        due: String(p.data_vencimento ?? p.dDtVenc ?? today()),
        payments: [],
      }));
    } else if (doc.state === "AUTHORIZED" && payIntegrationCodes.has(doc.integrationCode) && doc.titles[0] && doc.titles[0].payments.length === 0) {
      doc.titles[0].payments.push({ id: ++seq, date: today(), amount: doc.titles[0].amount });
    }
    void app;
  }

  function handle(app: SimApp, call: string, p: Obj): [number, unknown] {
    switch (call) {
      case "ListarEmpresas":
        return [200, { pagina: 1, total_de_paginas: 1, registros: 1, total_de_registros: 1, empresas_cadastro: [{ codigo_empresa: 1, cnpj: app.company.cnpj, razao_social: app.company.name, nome_fantasia: "Ecolife", inativa: "N" }] }];
      case "UpsertClienteCpfCnpj": {
        const doc = String(p.cnpj_cpf ?? "").replace(/\D/g, "");
        if (!doc) return [500, fault("O preenchimento da tag [cnpj_cpf] é obrigatório!")];
        if (!p.razao_social) return [500, fault("O preenchimento da tag [razao_social] é obrigatório!")];
        const existing = app.customers.get(doc);
        const id = existing?.id ?? ++seq;
        app.customers.set(doc, { id, payload: p });
        return [200, { codigo_cliente_omie: id, codigo_cliente_integracao: p.codigo_cliente_integracao, codigo_status: "0", descricao_status: existing ? "Cliente alterado com sucesso!" : "Cliente cadastrado com sucesso!" }];
      }
      case "IncluirPedido":
      case "IncluirOS": {
        const isPV = call === "IncluirPedido";
        const header = (isPV ? p.cabecalho : p.Cabecalho) as Obj | undefined;
        const code = String((isPV ? header?.codigo_pedido_integracao : header?.cCodIntOS) ?? "");
        if (app.documents.some((d) => d.integrationCode === code)) return [500, fault(`${isPV ? "Pedido" : "Ordem de Serviço"} já cadastrado para o Código de Integração [${code}] !`, "SOAP-ENV:Client-102")];
        const customerId = Number(isPV ? header?.codigo_cliente : header?.nCodCli);
        if (![...app.customers.values()].some((c) => c.id === customerId)) return [500, fault(`Cliente não cadastrado para o Código [${customerId}] !`)];
        const info = (isPV ? p.informacoes_adicionais : p.InformacoesAdicionais) as Obj | undefined;
        const category = String((isPV ? info?.codigo_categoria : info?.cCodCateg) ?? "");
        if (!category) return [500, fault(`O preenchimento da tag [${isPV ? "codigo_categoria" : "cCodCateg"}] é obrigatório!`)];
        if (!categoryCodes.has(category)) return [500, fault(`Categoria não cadastrada para o Código [${category}] !`)];
        const cc = Number(isPV ? info?.codigo_conta_corrente : info?.nCodCC);
        if (!accountIds.has(cc)) return [500, fault(`Conta Corrente não cadastrada para o Código [${cc}] !`)];
        const lines = (isPV ? p.det : p.ServicosPrestados) as Obj[] | undefined;
        if (!lines?.length) return [500, fault(`O preenchimento da tag [${isPV ? "det" : "ServicosPrestados"}] é obrigatório!`)];
        for (const line of lines) {
          const id = Number(isPV ? (line.produto as Obj | undefined)?.codigo_produto : line.nCodServico);
          if (isPV && !productIds.has(id)) return [500, fault(`Produto não cadastrado para o Código [${id}] !`)];
          if (!isPV && !serviceIds.has(id)) return [500, fault(`Serviço não cadastrado para o Código [${id}] !`)];
        }
        const doc: SimDocument = { kind: isPV ? "PV" : "OS", id: ++seq, number: String(seq).padStart(6, "0"), integrationCode: code, payload: p, checks: 0, state: "PENDING", titles: [] };
        app.documents.push(doc);
        if (dropResponseOnce.has(code)) {
          dropResponseOnce.delete(code);
          return [-1, null];
        }
        return isPV
          ? [200, { codigo_pedido: doc.id, codigo_pedido_integracao: code, codigo_status: "0", descricao_status: "Pedido cadastrado com sucesso!", numero_pedido: doc.number }]
          : [200, { nCodOS: doc.id, cCodIntOS: code, cNumOS: doc.number, cCodStatus: "0", cDescStatus: "Ordem de Serviço cadastrada com sucesso!" }];
      }
      case "StatusPedido": {
        const doc = app.documents.find((d) => d.kind === "PV" && (d.id === Number(p.codigo_pedido) || (p.codigo_pedido_integracao && d.integrationCode === p.codigo_pedido_integracao)));
        if (!doc) return [500, fault(`Pedido não cadastrado para o Código de Integração [${p.codigo_pedido_integracao ?? p.codigo_pedido}] !`, "SOAP-ENV:Client-103")];
        if (p.codigo_pedido) advance(app, doc);
        const nfe =
          doc.state === "AUTHORIZED" || doc.state === "CANCELLED"
            ? [{ numero_lote: 1, status_lote: "104", numero_nfe: doc.invoiceNumber, serie_nfe: "1", status_nfe: "Autorizada", chave_nfe: doc.accessKey, protocolo: 131260000000000 + doc.id, data_emissao: today(), hora_emissao: "10:15:00", xml_distr: `<nfeProc><NFe><infNFe Id="NFe${doc.accessKey}"/></NFe></nfeProc>`, danfe: `https://simulador.omie/danfe/${doc.accessKey}.pdf`, mensagens: [] }]
            : doc.state === "REJECTED"
              ? [{ numero_lote: 1, status_lote: "104", status_nfe: "Rejeitada", chave_nfe: "", mensagens: [{ cCodigo: "539", cDescricao: "Rejeição: Duplicidade de NF-e, com diferença na Chave de Acesso", cCorrecao: "Verifique a numeração da NF-e." }] }]
              : [];
        return [200, { codigo_pedido: doc.id, codigo_pedido_integracao: doc.integrationCode, numero_pedido: doc.number, etapa: doc.state === "PENDING" ? "50" : "60", cancelada: doc.state === "CANCELLED" ? "S" : "N", faturada: doc.state === "AUTHORIZED" ? "S" : "N", ambiente: "H", ListaNfe: nfe }];
      }
      case "StatusOS": {
        const doc = app.documents.find((d) => d.kind === "OS" && (d.id === Number(p.nCodOS) || (p.cCodIntOS && d.integrationCode === p.cCodIntOS)));
        if (!doc) return [500, fault(`Ordem de Serviço não cadastrada para o Código de Integração [${p.cCodIntOS ?? p.nCodOS}] !`, "SOAP-ENV:Client-103")];
        if (p.nCodOS) advance(app, doc);
        const rps = doc.state === "AUTHORIZED" ? [{ nLote: 1, cStatusLote: "100", cProtocolo: `PROT${doc.id}`, nRps: String(doc.id), cStatusRps: "100", nNfse: doc.invoiceNumber, cCodVerif: `VER${doc.id}`, cUrlPdfDest: `https://simulador.omie/nfse/${doc.id}.pdf`, xml_distr: `<CompNfse><Nfse><Numero>${doc.invoiceNumber}</Numero></Nfse></CompNfse>`, mensagens: [] }] : [];
        return [200, { nCodOS: doc.id, cCodIntOS: doc.integrationCode, cNumOS: doc.number, cEtapa: doc.state === "PENDING" ? "50" : "60", cCancelada: "N", cFaturada: doc.state === "AUTHORIZED" ? "S" : "N", dDtFat: doc.state === "AUTHORIZED" ? today() : "", cHrFat: "11:00:00", ListaRpsNfse: rps }];
      }
      case "ListarMovimentos": {
        const doc = app.documents.find((d) => d.id === Number(p.nCodOS));
        const movements = (doc?.titles ?? []).flatMap((t) => {
          const paid = t.payments.reduce((a, x) => a + x.amount, 0);
          const detalhes = { nCodTitulo: t.id, cNumTitulo: `${doc!.number}/${t.parcel}`, cNumParcela: `${String(t.parcel).padStart(3, "0")}/${String(t.total).padStart(3, "0")}`, dDtVenc: t.due, nValorTitulo: t.amount, cStatus: paid >= t.amount ? "RECEBIDO" : "A VENCER", cNatureza: "R", nCodCC: 11850365, dDtInc: today(), cHrInc: "10:00:00" };
          const resumo = { cLiquidado: paid >= t.amount ? "S" : "N", nValPago: paid, nValAberto: Math.max(0, t.amount - paid) };
          if (t.payments.length === 0) return [{ detalhes, resumo }];
          return t.payments.map((pay) => ({ detalhes: { ...detalhes, nCodBaixa: pay.id, dDtPagamento: pay.date, nValorMovCC: pay.amount, nJuros: 0, nDesconto: 0, nMulta: 0 }, resumo }));
        });
        if (movements.length === 0) return [500, fault("Não existem registros para a página [1]!", "SOAP-ENV:Client-5113")];
        return [200, { nPagina: 1, nTotPaginas: 1, nRegistros: movements.length, nTotRegistros: movements.length, movimentos: movements }];
      }
      case "ListarProdutosResumido": {
        const pg = page(OMIE_CATALOG.produtos, Number(p.pagina ?? 1), Number(p.registros_por_pagina ?? 50));
        return [200, { pagina: p.pagina, total_de_paginas: pg.totalPages, registros: pg.slice.length, total_de_registros: pg.total, produto_servico_resumido: pg.slice }];
      }
      case "ListarCadastroServico":
        return [200, { nPagina: 1, nTotPaginas: 1, nRegistros: OMIE_CATALOG.servicos.length, nTotRegistros: OMIE_CATALOG.servicos.length, cadastros: OMIE_CATALOG.servicos.map((s) => ({ intListar: { nCodServ: s.nCodServ, cCodIntServ: "" }, cabecalho: { cCodigo: s.cCodigo, cDescricao: s.cDescricao, cCodLC116: s.cCodLC116 } })) }];
      case "ListarCategorias":
        return [200, { pagina: 1, total_de_paginas: 1, registros: OMIE_CATALOG.categorias.length, total_de_registros: OMIE_CATALOG.categorias.length, categoria_cadastro: OMIE_CATALOG.categorias.map((c) => ({ conta_inativa: "N", totalizadora: "N", ...c })) }];
      case "ListarDepartamentos":
        return [200, { pagina: 1, total_de_paginas: 1, departamentos: OMIE_CATALOG.departamentos.map((d) => ({ ...d, inativo: "N" })) }];
      case "ListarProjetos":
        return [200, { pagina: 1, total_de_paginas: 1, cadastro: OMIE_CATALOG.projetos.map((d) => ({ ...d, inativo: "N" })) }];
      case "ListarContasCorrentes":
        return [200, { pagina: 1, total_de_paginas: 1, ListarContasCorrentes: OMIE_CATALOG.contasCorrentes }];
      case "ListarVendedores":
        return [200, { pagina: 1, total_de_paginas: 1, cadastro: OMIE_CATALOG.vendedores.map((v) => ({ ...v, inativo: "N" })) }];
      case "ListarParcelas":
        return [200, { pagina: 1, total_de_paginas: 1, cadastros: OMIE_CATALOG.parcelas }];
      case "ListarEtapasFaturamento":
        return [200, { pagina: 1, total_de_paginas: 1, cadastros: OMIE_CATALOG.etapas }];
      case "ListarCenarios":
        return [200, { nPagina: 1, nTotPaginas: 1, cenariosEncontrados: OMIE_CATALOG.cenarios }];
      default:
        return [500, fault(`Método [${call}] não suportado pelo simulador.`, "SOAP-ENV:Client-100")];
    }
  }

  const server = createServer(async (req, res) => {
    if (req.method !== "POST") return send(res, 400, { status: "400", message: `Consumo indevido [${req.method}]` });
    const body = ((await readJsonBody(req)) ?? {}) as { call?: string; app_key?: string; app_secret?: string; param?: Obj[] };
    const app = apps.get(String(body.app_key ?? ""));
    if (!app || app.appSecret !== body.app_secret) return send(res, 500, fault("A chave de acesso não está preenchida ou não é válida. (Application key not found)", "SOAP-ENV:Client-8000"));
    const param = body.param?.[0] ?? {};
    calls.push({ appKey: app.appKey, call: String(body.call), param });
    const [status, payload] = handle(app, String(body.call), param);
    if (status === -1) {
      req.socket.destroy();
      return;
    }
    send(res, status, payload);
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}/api/v1`,
    server,
    apps,
    calls,
    rejectIntegrationCodes,
    payIntegrationCodes,
    dropResponseOnce,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
