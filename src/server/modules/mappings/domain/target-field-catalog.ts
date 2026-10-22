import type { DocumentType, TargetFieldDefinition } from "./types";

/**
 * Catálogo dos campos Omie suportados pela tela de mapeamento.
 *
 * As chaves são caminhos reais do payload Omie (documentação oficial):
 *  - CUSTOMER      → geral/clientes  › UpsertClienteCpfCnpj (clientes_cadastro)
 *  - SALES_ORDER   → produtos/pedido › IncluirPedido (pedido_venda_produto)
 *  - SERVICE_ORDER → servicos/os     › IncluirOS (osCadastro)
 *
 * `defaultRule` é a regra aplicada enquanto o usuário não cria uma regra própria.
 * `defaultRule: null` em campo obrigatório = precisa ser configurado (ex.: categoria).
 * Campos fora deste catálogo podem ser mapeados como "campo personalizado".
 */

const customer: TargetFieldDefinition[] = [
  { key: "razao_social", documentType: "CUSTOMER", scope: "header", group: "Identificação", label: "Razão social", description: "Razão social do cliente.", valueType: "string", required: true, maxLength: 60, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.razaoSocial", transforms: ["TRIM"] } },
  { key: "nome_fantasia", documentType: "CUSTOMER", scope: "header", group: "Identificação", label: "Nome fantasia", description: "Nome fantasia (usa a razão social quando vazio).", valueType: "string", required: false, maxLength: 100, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.nomeFantasia", transforms: ["TRIM"], defaultValue: "{cliente.razaoSocial}" } },
  { key: "cnpj_cpf", documentType: "CUSTOMER", scope: "header", group: "Identificação", label: "CNPJ/CPF", description: "Documento do cliente. É a chave do UpsertClienteCpfCnpj.", valueType: "string", required: true, maxLength: 20, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.cpfcnpj", transforms: ["DOCUMENT"] } },
  { key: "inscricao_estadual", documentType: "CUSTOMER", scope: "header", group: "Identificação", label: "Inscrição estadual", description: "IE do cliente.", valueType: "string", required: false, maxLength: 20, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.inscricaoEstadual", transforms: ["TRIM"], defaultValue: "{cliente.ie}" } },
  { key: "inscricao_municipal", documentType: "CUSTOMER", scope: "header", group: "Identificação", label: "Inscrição municipal", description: "IM do cliente.", valueType: "string", required: false, maxLength: 20, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.inscricaoMunicipal", transforms: ["TRIM"], defaultValue: "{cliente.im}" } },
  { key: "contribuinte", documentType: "CUSTOMER", scope: "header", group: "Identificação", label: "Contribuinte ICMS", description: "S/N.", valueType: "flag", required: false, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.entidadeClassificacao.xContribuinte", transforms: ["BOOLEAN_SN"] } },
  { key: "email", documentType: "CUSTOMER", scope: "header", group: "Contato", label: "E-mail", description: "E-mail do cliente.", valueType: "string", required: false, maxLength: 500, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.email", transforms: ["TRIM"] } },
  { key: "telefone1_ddd", documentType: "CUSTOMER", scope: "header", group: "Contato", label: "Telefone — DDD", description: "Extraído do telefone do Vision.", valueType: "string", required: false, maxLength: 5, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.telefone", transforms: ["PHONE_DDD"] } },
  { key: "telefone1_numero", documentType: "CUSTOMER", scope: "header", group: "Contato", label: "Telefone — número", description: "Telefone sem DDD.", valueType: "string", required: false, maxLength: 15, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.telefone", transforms: ["PHONE_NUMBER"] } },
  { key: "endereco", documentType: "CUSTOMER", scope: "header", group: "Endereço", label: "Logradouro", description: "Endereço.", valueType: "string", required: false, maxLength: 60, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.endereco", transforms: ["TRIM"] } },
  { key: "endereco_numero", documentType: "CUSTOMER", scope: "header", group: "Endereço", label: "Número", description: "Número do endereço.", valueType: "string", required: false, maxLength: 60, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.numero", transforms: ["TRIM"] } },
  { key: "complemento", documentType: "CUSTOMER", scope: "header", group: "Endereço", label: "Complemento", description: "Complemento.", valueType: "string", required: false, maxLength: 60, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.complemento", transforms: ["TRIM"] } },
  { key: "bairro", documentType: "CUSTOMER", scope: "header", group: "Endereço", label: "Bairro", description: "Bairro.", valueType: "string", required: false, maxLength: 60, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.bairro", transforms: ["TRIM"] } },
  { key: "cidade", documentType: "CUSTOMER", scope: "header", group: "Endereço", label: "Cidade", description: "Nome da cidade (ou código IBGE em cidade_ibge).", valueType: "string", required: false, maxLength: 40, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.cidade", transforms: ["TRIM"] } },
  { key: "estado", documentType: "CUSTOMER", scope: "header", group: "Endereço", label: "UF", description: "Sigla do estado.", valueType: "string", required: false, maxLength: 2, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.uf", transforms: ["TRIM", "UPPERCASE"] } },
  { key: "cep", documentType: "CUSTOMER", scope: "header", group: "Endereço", label: "CEP", description: "CEP somente dígitos.", valueType: "string", required: false, maxLength: 10, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.cep", transforms: ["DIGITS_ONLY"] } },
  { key: "codigo_cliente_integracao", documentType: "CUSTOMER", scope: "header", group: "Controle", label: "Código de integração", description: "Gerado pela integração a partir do código do cliente no Vision.", valueType: "string", required: true, defaultRule: null, system: true },
];

const salesOrder: TargetFieldDefinition[] = [
  { key: "cabecalho.codigo_cliente", documentType: "SALES_ORDER", scope: "header", group: "Cabeçalho", label: "Cliente", description: "ID do cliente no Omie, obtido na sincronização do cliente.", valueType: "integer", required: true, defaultRule: null, system: true },
  { key: "cabecalho.codigo_pedido_integracao", documentType: "SALES_ORDER", scope: "header", group: "Cabeçalho", label: "Código de integração", description: "Chave de idempotência gerada a partir do código do pedido Vision.", valueType: "string", required: true, defaultRule: null, system: true },
  { key: "cabecalho.data_previsao", documentType: "SALES_ORDER", scope: "header", group: "Cabeçalho", label: "Previsão de faturamento", description: "Data de previsão (dd/mm/aaaa).", valueType: "date", required: true, defaultRule: { sourceType: "CONSTANT", constantValue: "{{hoje}}" } },
  { key: "cabecalho.etapa", documentType: "SALES_ORDER", scope: "header", group: "Cabeçalho", label: "Etapa", description: "Etapa do pedido no Omie (10 = Pedido de venda; 00 = Orçamento).", valueType: "string", required: true, lookup: "etapas_faturamento", defaultRule: { sourceType: "CONSTANT", constantValue: "10" } },
  { key: "cabecalho.codigo_parcela", documentType: "SALES_ORDER", scope: "header", group: "Cabeçalho", label: "Condição de pagamento", description: "Código da parcela. 999 = parcelas informadas manualmente (enviadas a partir das parcelas do Vision).", valueType: "string", required: true, lookup: "parcelas", defaultRule: { sourceType: "CONSTANT", constantValue: "999" } },
  { key: "cabecalho.codigo_cenario_impostos", documentType: "SALES_ORDER", scope: "header", group: "Cabeçalho", label: "Cenário de impostos", description: "Quando vazio o Omie usa o cenário padrão.", valueType: "integer", required: false, lookup: "cenarios_impostos", defaultRule: null },
  { key: "cabecalho.quantidade_itens", documentType: "SALES_ORDER", scope: "header", group: "Cabeçalho", label: "Quantidade de itens", description: "Calculado pela integração.", valueType: "integer", required: true, defaultRule: null, system: true },
  { key: "informacoes_adicionais.codigo_categoria", documentType: "SALES_ORDER", scope: "header", group: "Informações adicionais", label: "Categoria", description: "Categoria financeira da venda (obrigatória).", valueType: "string", required: true, lookup: "categorias", defaultRule: null },
  { key: "informacoes_adicionais.codigo_conta_corrente", documentType: "SALES_ORDER", scope: "header", group: "Informações adicionais", label: "Conta corrente", description: "Conta corrente que receberá os títulos (obrigatória).", valueType: "integer", required: true, lookup: "contas_correntes", defaultRule: null },
  { key: "informacoes_adicionais.consumidor_final", documentType: "SALES_ORDER", scope: "header", group: "Informações adicionais", label: "Consumidor final", description: "S/N.", valueType: "flag", required: false, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "cliente.entidadeClassificacao.xContribuinteFinal", transforms: ["BOOLEAN_SN"], defaultValue: "N" } },
  { key: "informacoes_adicionais.enviar_email", documentType: "SALES_ORDER", scope: "header", group: "Informações adicionais", label: "Enviar boleto por e-mail", description: "S/N.", valueType: "flag", required: false, defaultRule: { sourceType: "CONSTANT", constantValue: "N" } },
  { key: "informacoes_adicionais.codVend", documentType: "SALES_ORDER", scope: "header", group: "Informações adicionais", label: "Vendedor", description: "Vendedor no Omie.", valueType: "integer", required: false, lookup: "vendedores", defaultRule: null },
  { key: "informacoes_adicionais.codProj", documentType: "SALES_ORDER", scope: "header", group: "Informações adicionais", label: "Projeto", description: "Projeto no Omie.", valueType: "integer", required: false, lookup: "projetos", defaultRule: null },
  { key: "informacoes_adicionais.numero_pedido_cliente", documentType: "SALES_ORDER", scope: "header", group: "Informações adicionais", label: "Nº do pedido do cliente", description: "Por padrão o código do pedido no Vision (rastreabilidade na NF).", valueType: "string", required: false, maxLength: 30, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "codigo" } },
  { key: "informacoes_adicionais.dados_adicionais_nf", documentType: "SALES_ORDER", scope: "header", group: "Informações adicionais", label: "Dados adicionais da NF", description: "Texto impresso na NF-e.", valueType: "string", required: false, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "observacao", transforms: ["TRIM"] } },
  { key: "departamentos[0].cCodDepto", documentType: "SALES_ORDER", scope: "header", group: "Rateio", label: "Departamento", description: "Departamento com 100% de rateio.", valueType: "string", required: false, lookup: "departamentos", companions: [{ key: "departamentos[0].nPerc", value: 100 }], defaultRule: null },
  { key: "observacoes.obs_venda", documentType: "SALES_ORDER", scope: "header", group: "Observações", label: "Observação interna", description: "Não é impressa na NF.", valueType: "string", required: false, defaultRule: null },
  { key: "frete.modalidade", documentType: "SALES_ORDER", scope: "header", group: "Frete", label: "Modalidade do frete", description: "0=Emitente, 1=Destinatário, 2=Terceiros, 9=Sem frete.", valueType: "string", required: false, defaultRule: { sourceType: "CONSTANT", constantValue: "9" } },
  { key: "frete.valor_frete", documentType: "SALES_ORDER", scope: "header", group: "Frete", label: "Valor do frete", description: "Valor do frete.", valueType: "decimal", required: false, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "valorFrete", transforms: ["NUMBER"] } },
  { key: "frete.outras_despesas", documentType: "SALES_ORDER", scope: "header", group: "Frete", label: "Outras despesas", description: "Despesas acessórias.", valueType: "decimal", required: false, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "valorOutras", transforms: ["NUMBER"] } },
  { key: "det[].produto.codigo_produto", documentType: "SALES_ORDER", scope: "item", group: "Itens", label: "Produto", description: "ID do produto no Omie. Use a tabela de-para Produtos.", valueType: "integer", required: true, lookup: "produtos", defaultRule: { sourceType: "VALUE_MAP", sourcePath: "codigoMaterial", valueMapKey: "produtos" } },
  { key: "det[].produto.quantidade", documentType: "SALES_ORDER", scope: "item", group: "Itens", label: "Quantidade", description: "Quantidade do item.", valueType: "decimal", required: true, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "quantidade", transforms: ["NUMBER"] } },
  { key: "det[].produto.valor_unitario", documentType: "SALES_ORDER", scope: "item", group: "Itens", label: "Valor unitário", description: "Preço unitário.", valueType: "decimal", required: true, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "valorUnitario", transforms: ["NUMBER"] } },
  { key: "det[].produto.tipo_desconto", documentType: "SALES_ORDER", scope: "item", group: "Itens", label: "Tipo de desconto", description: "P = percentual, V = valor.", valueType: "string", required: false, defaultRule: { sourceType: "CONSTANT", constantValue: "P" } },
  { key: "det[].produto.percentual_desconto", documentType: "SALES_ORDER", scope: "item", group: "Itens", label: "% de desconto", description: "Percentual de desconto do item.", valueType: "decimal", required: false, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "porcentagemDesconto", transforms: ["NUMBER"] } },
  { key: "det[].produto.cfop", documentType: "SALES_ORDER", scope: "item", group: "Itens", label: "CFOP", description: "Quando vazio o Omie usa o cenário de impostos.", valueType: "string", required: false, maxLength: 10, defaultRule: null },
  { key: "det[].inf_adic.codigo_categoria_item", documentType: "SALES_ORDER", scope: "item", group: "Itens", label: "Categoria do item", description: "Categoria específica por item.", valueType: "string", required: false, lookup: "categorias", defaultRule: null },
  { key: "det[].inf_adic.dados_adicionais_item", documentType: "SALES_ORDER", scope: "item", group: "Itens", label: "Informações do item na NF", description: "Texto do item na NF.", valueType: "string", required: false, defaultRule: null },
  { key: "det[].ide.codigo_item_integracao", documentType: "SALES_ORDER", scope: "item", group: "Itens", label: "Código de integração do item", description: "Gerado pela integração (pedido + sequência).", valueType: "string", required: true, defaultRule: null, system: true },
];

const serviceOrder: TargetFieldDefinition[] = [
  { key: "Cabecalho.nCodCli", documentType: "SERVICE_ORDER", scope: "header", group: "Cabeçalho", label: "Cliente", description: "ID do cliente no Omie, obtido na sincronização do cliente.", valueType: "integer", required: true, defaultRule: null, system: true },
  { key: "Cabecalho.cCodIntOS", documentType: "SERVICE_ORDER", scope: "header", group: "Cabeçalho", label: "Código de integração", description: "Chave de idempotência gerada a partir do código do pedido Vision.", valueType: "string", required: true, defaultRule: null, system: true },
  { key: "Cabecalho.dDtPrevisao", documentType: "SERVICE_ORDER", scope: "header", group: "Cabeçalho", label: "Data de previsão", description: "dd/mm/aaaa.", valueType: "date", required: true, defaultRule: { sourceType: "CONSTANT", constantValue: "{{hoje}}" } },
  { key: "Cabecalho.cEtapa", documentType: "SERVICE_ORDER", scope: "header", group: "Cabeçalho", label: "Etapa", description: "Etapa da OS (10 = primeira etapa; 50 = Faturar).", valueType: "string", required: true, lookup: "etapas_faturamento", defaultRule: { sourceType: "CONSTANT", constantValue: "10" } },
  { key: "Cabecalho.cCodParc", documentType: "SERVICE_ORDER", scope: "header", group: "Cabeçalho", label: "Condição de pagamento", description: "999 = parcelas manuais (enviadas a partir do Vision).", valueType: "string", required: true, lookup: "parcelas", defaultRule: { sourceType: "CONSTANT", constantValue: "999" } },
  { key: "Cabecalho.nCodVend", documentType: "SERVICE_ORDER", scope: "header", group: "Cabeçalho", label: "Vendedor", description: "Vendedor no Omie.", valueType: "integer", required: false, lookup: "vendedores", defaultRule: null },
  { key: "Cabecalho.nQtdeParc", documentType: "SERVICE_ORDER", scope: "header", group: "Cabeçalho", label: "Quantidade de parcelas", description: "Calculado pela integração.", valueType: "integer", required: false, defaultRule: null, system: true },
  { key: "InformacoesAdicionais.cCodCateg", documentType: "SERVICE_ORDER", scope: "header", group: "Informações adicionais", label: "Categoria", description: "Categoria financeira (obrigatória).", valueType: "string", required: true, lookup: "categorias", defaultRule: null },
  { key: "InformacoesAdicionais.nCodCC", documentType: "SERVICE_ORDER", scope: "header", group: "Informações adicionais", label: "Conta corrente", description: "Conta corrente (obrigatória).", valueType: "integer", required: true, lookup: "contas_correntes", defaultRule: null },
  { key: "InformacoesAdicionais.cCidPrestServ", documentType: "SERVICE_ORDER", scope: "header", group: "Informações adicionais", label: "Cidade da prestação", description: "Formato \"CIDADE (UF)\".", valueType: "string", required: false, maxLength: 40, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "{cliente.cidade} ({cliente.uf})", transforms: ["UPPERCASE", "REMOVE_ACCENTS"] } },
  { key: "InformacoesAdicionais.cNumPedido", documentType: "SERVICE_ORDER", scope: "header", group: "Informações adicionais", label: "Nº do pedido do cliente", description: "Por padrão o código do pedido no Vision.", valueType: "string", required: false, maxLength: 30, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "codigo" } },
  { key: "InformacoesAdicionais.cDadosAdicNF", documentType: "SERVICE_ORDER", scope: "header", group: "Informações adicionais", label: "Dados adicionais da NFS-e", description: "Texto impresso na NFS-e.", valueType: "string", required: false, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "observacao", transforms: ["TRIM"] } },
  { key: "InformacoesAdicionais.nCodProj", documentType: "SERVICE_ORDER", scope: "header", group: "Informações adicionais", label: "Projeto", description: "Projeto no Omie.", valueType: "integer", required: false, lookup: "projetos", defaultRule: null },
  { key: "Departamentos[0].cCodDepto", documentType: "SERVICE_ORDER", scope: "header", group: "Rateio", label: "Departamento", description: "Departamento com 100% de rateio.", valueType: "string", required: false, lookup: "departamentos", companions: [{ key: "Departamentos[0].nPerc", value: 100 }], defaultRule: null },
  { key: "Email.cEnvBoleto", documentType: "SERVICE_ORDER", scope: "header", group: "E-mail", label: "Enviar boleto por e-mail", description: "S/N.", valueType: "flag", required: false, defaultRule: { sourceType: "CONSTANT", constantValue: "N" } },
  { key: "Email.cEnvLink", documentType: "SERVICE_ORDER", scope: "header", group: "E-mail", label: "Enviar link da NFS-e", description: "S/N.", valueType: "flag", required: false, defaultRule: { sourceType: "CONSTANT", constantValue: "N" } },
  { key: "Observacoes.cObsOS", documentType: "SERVICE_ORDER", scope: "header", group: "Observações", label: "Observação interna", description: "Não é impressa na NFS-e.", valueType: "string", required: false, defaultRule: null },
  { key: "ServicosPrestados[].nCodServico", documentType: "SERVICE_ORDER", scope: "item", group: "Serviços", label: "Serviço", description: "ID do serviço no Omie. Use a tabela de-para Serviços.", valueType: "integer", required: true, lookup: "servicos", defaultRule: { sourceType: "VALUE_MAP", sourcePath: "codigoServico", valueMapKey: "servicos" } },
  { key: "ServicosPrestados[].nQtde", documentType: "SERVICE_ORDER", scope: "item", group: "Serviços", label: "Quantidade", description: "Quantidade.", valueType: "decimal", required: true, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "quantidade", transforms: ["NUMBER"] } },
  { key: "ServicosPrestados[].nValUnit", documentType: "SERVICE_ORDER", scope: "item", group: "Serviços", label: "Valor unitário", description: "Valor unitário.", valueType: "decimal", required: true, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "valorUnitario", transforms: ["NUMBER"] } },
  { key: "ServicosPrestados[].cTpDesconto", documentType: "SERVICE_ORDER", scope: "item", group: "Serviços", label: "Tipo de desconto", description: "P = percentual, V = valor.", valueType: "string", required: false, defaultRule: { sourceType: "CONSTANT", constantValue: "P" } },
  { key: "ServicosPrestados[].nAliqDesconto", documentType: "SERVICE_ORDER", scope: "item", group: "Serviços", label: "% de desconto", description: "Alíquota de desconto.", valueType: "decimal", required: false, defaultRule: { sourceType: "VISION_FIELD", sourcePath: "porcentagemDesconto", transforms: ["NUMBER"] } },
  { key: "ServicosPrestados[].cDescServ", documentType: "SERVICE_ORDER", scope: "item", group: "Serviços", label: "Descrição", description: "Quando vazio o Omie usa a descrição do cadastro do serviço.", valueType: "string", required: false, defaultRule: null },
  { key: "ServicosPrestados[].cRetemISS", documentType: "SERVICE_ORDER", scope: "item", group: "Serviços", label: "Retém ISS", description: "S/N.", valueType: "flag", required: false, defaultRule: null },
  { key: "ServicosPrestados[].cTribServ", documentType: "SERVICE_ORDER", scope: "item", group: "Serviços", label: "Tributação do serviço", description: "Código de tributação (ex.: 01).", valueType: "string", required: false, maxLength: 2, defaultRule: null },
  { key: "ServicosPrestados[].cCodCategItem", documentType: "SERVICE_ORDER", scope: "item", group: "Serviços", label: "Categoria do item", description: "Categoria específica por item.", valueType: "string", required: false, lookup: "categorias", defaultRule: null },
];

export const TARGET_FIELD_CATALOG: readonly TargetFieldDefinition[] = [...customer, ...salesOrder, ...serviceOrder];

export function catalogFor(documentType: DocumentType): TargetFieldDefinition[] {
  return TARGET_FIELD_CATALOG.filter((f) => f.documentType === documentType);
}

export function findTargetDefinition(documentType: DocumentType, key: string): TargetFieldDefinition | undefined {
  return TARGET_FIELD_CATALOG.find((f) => f.documentType === documentType && f.key === key);
}

/** Prefixo das chaves de item e coleção de origem no pedido Vision. */
export const ITEM_COLLECTIONS: Record<DocumentType, { targetPrefix: string; visionCollection: string } | null> = {
  CUSTOMER: null,
  SALES_ORDER: { targetPrefix: "det[].", visionCollection: "itens" },
  SERVICE_ORDER: { targetPrefix: "ServicosPrestados[].", visionCollection: "servicos" },
};

/** Define um campo personalizado (fora do catálogo) a partir da chave informada pelo usuário. */
export function customDefinition(documentType: DocumentType, key: string): TargetFieldDefinition {
  const items = ITEM_COLLECTIONS[documentType];
  const scope = items && key.startsWith(items.targetPrefix) ? "item" : "header";
  return {
    key,
    documentType,
    scope,
    group: "Personalizados",
    label: key,
    description: "Campo personalizado definido na tela de mapeamento.",
    valueType: "string",
    required: false,
    defaultRule: null,
  };
}

/** Valida a chave de um campo personalizado (caminho Omie). */
export function isValidTargetKey(documentType: DocumentType, key: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\[(\d+)?\])?(\.[A-Za-z_][A-Za-z0-9_]*(\[(\d+)?\])?)*$/.test(key)) return false;
  const items = ITEM_COLLECTIONS[documentType];
  if (key.includes("[]")) return Boolean(items && key.startsWith(items.targetPrefix) && key.indexOf("[]") === items.targetPrefix.length - 3);
  return true;
}
