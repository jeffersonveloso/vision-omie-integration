/**
 * Massa de dados dos simuladores, no formato observado na ControllerAPI real (pedido 14062, out/2026):
 *  - o pedido não traz o CNPJ da empresa, só `codigoEmpresa` → o roteamento usa a tabela "Empresa Vision → CNPJ";
 *  - serviços chegam com `codigoServico: 0` e `seq: 0`; o código do serviço está em `codigoMaterial`;
 *  - pedido "SEM FINANCEIRO" vem sem parcelas.
 * Aqui os campos estão em camelCase; o simulador responde em PascalCase, como o Vision.
 */

function dv(base: string): number {
  const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = base.split("").reduce((acc, ch, i) => acc + (ch.charCodeAt(0) - 48) * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function makeCnpj(base12: string): string {
  const d1 = dv(base12);
  return `${base12}${d1}${dv(base12 + d1)}`;
}

export const COMPANIES = {
  matriz: { code: 1, name: "Ecolife Soluções Ambientais Ltda", cnpj: makeCnpj("112223330001"), appKey: "SIM-APP-MATRIZ", appSecret: "sim-secret-matriz" },
  filial: { code: 2, name: "Ecolife Serviços Ambientais Ltda", cnpj: makeCnpj("112223330002"), appKey: "SIM-APP-FILIAL", appSecret: "sim-secret-filial" },
  semConta: { code: 3, name: "Ecolife Participações", cnpj: makeCnpj("998887770001") },
};

const customer = (code: number, name: string, doc: string, city = "Belo Horizonte", uf = "MG", payment: [number, string] = [10, "BOLETO 30 DIAS"]) => ({
  codigo: code,
  razaoSocial: name,
  nomeFantasia: "",
  endereco: "Av. Afonso Pena",
  bairro: "Centro",
  complemento: "N/A",
  cep: "30130-005",
  numero: "1500",
  cpfcnpj: doc,
  inscricaoEstadual: "0012345670089",
  inscricaoMunicipal: null,
  telefone: "31-3333-4444",
  celular: "31-3333-4444",
  email: "financeiro@cliente.com.br",
  cidade: city,
  uf,
  ie: "",
  im: "",
  rg: "",
  codigoFormaPagamento: payment[0],
  descricaoFormaPagamento: payment[1],
  xBloquearFaturamento: false,
  codigoCidade: 3399,
  entidadeClassificacao: { codigo: 0, xCupomFiscal: false, xContribuinte: true, xContribuinteFinal: false },
});

const item = (seq: number, material: number, qty: number, price: number, desc = 0) => ({
  codigo: seq,
  codigoItem: seq,
  seq,
  codigoMaterial: material,
  descricaoMaterial: `Material ${material}`,
  quantidade: qty,
  valorUnitario: price,
  valorTotal: qty * price * (1 - desc / 100),
  porcentagemDesconto: desc,
  siglaUnidadeVenda: "UN",
});

const service = (line: number, code: number, qty: number, price: number, total = Math.round(qty * price * 100) / 100, unit = "UN") => ({
  codigo: 9880 + line,
  codigoItem: line,
  seq: 0,
  codigoServico: 0,
  codigoIdentificacao: "",
  codigoMaterial: code,
  descricaoMaterial: null,
  descricaoMaterialVenda: `Serviço ${code}`,
  quantidade: qty,
  valorUnitario: price,
  valorTotal: total,
  porcentagemDesconto: 0,
  codigoCME: 1,
  descricaoCME: "VENDA DE SERVIÇOS",
  siglaUnidadeVenda: unit,
});

const parcels = (base: number, values: Array<[string, number]>) => values.map(([due, value], i) => ({ codigoParcela: base + i, dataVencimento: `${due}T00:00:00`, valorParcela: value, valorSaldo: value, nossoNumero: "" }));

function localIso(daysAgo: number, time: string): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${time}`;
}

function order(code: number, company: { code: number; name: string }, data: Record<string, unknown>) {
  return {
    codigoUsuarioCadastro: 5,
    codigo: code,
    codigoEmpresa: company.code,
    razaoSocialEmpresa: company.name.toUpperCase(),
    dataCadastro: localIso(1, "09:00:00.87"),
    dataAtualizacao: localIso(1, "09:30:00.453"),
    codigoOrigemRegistro: 1,
    codigoStatus: 2,
    descricaoStatus: "CONCLUÍDO / FATURADO",
    codigoTipoOperacao: 1,
    codigoCarteira: 3,
    codigoFormaPagamento: 10,
    codigoVendedor: 7,
    descricaoVendedor: "Marina Costa",
    valorFrete: 0,
    valorDesconto: 0,
    valorOutras: 0,
    observacao: `Pedido ${code} gerado pelo simulador`,
    itens: [],
    servicos: [],
    parcelas: [],
    ...data,
  };
}

export function buildVisionOrders() {
  const { matriz, filial, semConta } = COMPANIES;
  return [
    order(14100, matriz, { codigoCliente: 501, cliente: customer(501, "Hospital Santa Clara Ltda", "17.297.540/0001-37"), itens: [item(1, 123, 2, 150), item(2, 456, 1, 99.9)], parcelas: parcels(9001, [["2026-11-20", 199.95], ["2026-12-20", 199.95]]) }),
    order(14101, matriz, { codigoCliente: 502, cliente: customer(502, "Clínica Vida Plena", "60.701.190/0001-04", "Contagem"), servicos: [service(1, 77, 1, 850)], parcelas: parcels(9010, [["2026-11-25", 850]]) }),
    order(14102, filial, { codigoCliente: 503, cliente: customer(503, "Laboratório Analisa", "33.000.167/0001-01", "Pedro Leopoldo"), itens: [item(1, 123, 4, 150)], servicos: [service(1, 78, 2, 300)], parcelas: parcels(9020, [["2026-11-30", 1200]]) }),
    order(14103, matriz, { codigoCliente: 501, cliente: customer(501, "Hospital Santa Clara Ltda", "17.297.540/0001-37"), itens: [item(1, 999, 1, 75)], parcelas: parcels(9030, [["2026-11-15", 75]]) }),
    order(14104, semConta, { codigoCliente: 504, cliente: customer(504, "Prefeitura de Lagoa Santa", "18.715.383/0001-40", "Lagoa Santa"), itens: [item(1, 123, 1, 150)], parcelas: parcels(9040, [["2026-11-15", 150]]) }),
    order(14105, filial, { codigoCliente: 505, cliente: customer(505, "Distribuidora Minas Med", "02.558.157/0001-62"), itens: [item(1, 456, 3, 99.9)], parcelas: parcels(9050, [["2026-11-28", 299.7]]) }),
    order(14106, matriz, { codigoCliente: 502, cliente: customer(502, "Clínica Vida Plena", "60.701.190/0001-04", "Contagem"), itens: [item(1, 456, 1, 500)], parcelas: parcels(9060, [["2026-11-10", 250], ["2026-12-10", 250]]) }),
    // Igual ao pedido real 14062: coleta em KG, total que não fecha com 271 × 5,18 e "SEM FINANCEIRO" (sem parcelas).
    order(14107, matriz, {
      codigoCliente: 506,
      cliente: customer(506, "Município de Vale Verde", makeCnpj("445556660001").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5"), "Vale Verde", "MG", [2, "SEM FINANCEIRO"]),
      codigoFormaPagamento: 2,
      codigoCarteira: 11,
      observacao: "RELACAO DAS ORDENS DE SERVICOS: 58719, 58720",
      servicos: [service(1, 77, 271, 5.18, 1408.7, "KG")],
      parcelas: [],
    }),
  ];
}

/** Cadastros "do Omie" de cada base simulada. */
export const OMIE_CATALOG = {
  produtos: [
    { codigo_produto: 4422421, codigo: "PRD-123", descricao: "Coletor de resíduos 20L", valor_unitario: 150 },
    { codigo_produto: 4422456, codigo: "PRD-456", descricao: "Kit descarte perfurocortante", valor_unitario: 99.9 },
    { codigo_produto: 4422999, codigo: "PRD-999", descricao: "Saco infectante 100L", valor_unitario: 75 },
  ],
  servicos: [
    { nCodServ: 8800077, cCodigo: "SRV-77", cDescricao: "Coleta de resíduos de saúde", cCodLC116: "7.09" },
    { nCodServ: 8800078, cCodigo: "SRV-78", cDescricao: "Tratamento e destinação final", cCodLC116: "7.09" },
  ],
  categorias: [
    { codigo: "1.01", descricao: "Receitas operacionais", totalizadora: "S" },
    { codigo: "1.01.01", descricao: "Venda de produtos", natureza: "Receita" },
    { codigo: "1.01.02", descricao: "Prestação de serviços", natureza: "Receita" },
    { codigo: "1.01.03", descricao: "Revenda de mercadorias", natureza: "Receita" },
  ],
  contasCorrentes: [
    { nCodCC: 11850365, descricao: "Banco do Brasil — Cobrança", codigo_banco: "001", codigo_agencia: "1234-5", numero_conta_corrente: "98765-0" },
    { nCodCC: 11850366, descricao: "Itaú — Movimento", codigo_banco: "341", codigo_agencia: "0001", numero_conta_corrente: "12345-6" },
  ],
  departamentos: [
    { codigo: "DEP-COM", descricao: "Comercial", estrutura: "001" },
    { codigo: "DEP-OPS", descricao: "Operações", estrutura: "002" },
  ],
  projetos: [{ codigo: 501, nome: "Contratos hospitalares" }, { codigo: 502, nome: "Prefeituras" }],
  vendedores: [{ codigo: 7001, nome: "Marina Costa", email: "marina@ecolife.com.br" }],
  parcelas: [{ nCodigo: "000", cDescricao: "À vista", nParcelas: 1 }, { nCodigo: "999", cDescricao: "Parcelamento manual", nParcelas: 0 }, { nCodigo: "A30", cDescricao: "30 dias", nParcelas: 1 }],
  etapas: [
    { cCodOperacao: "11", cDescOperacao: "Venda de Produto", etapas: [{ cCodigo: "10", cDescricao: "Pedido de Venda" }, { cCodigo: "50", cDescricao: "Faturar" }] },
    { cCodOperacao: "01", cDescOperacao: "Venda de Serviço", etapas: [{ cCodigo: "10", cDescricao: "Ordem de Serviço" }, { cCodigo: "50", cDescricao: "Faturar" }] },
  ],
  cenarios: [{ nCodigo: 1, cNome: "Padrão Comércio", padrao: true }],
};
