/** Linguagem ubíqua do contexto de Mapeamento (Vision → Omie). */

export const DOCUMENT_TYPES = ["CUSTOMER", "SALES_ORDER", "SERVICE_ORDER"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  CUSTOMER: "Cliente",
  SALES_ORDER: "Pedido de Venda",
  SERVICE_ORDER: "Ordem de Serviço",
};

/** De onde vem o valor de um campo Omie. */
export const SOURCE_TYPES = ["VISION_FIELD", "CONSTANT", "VALUE_MAP", "IGNORE"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  VISION_FIELD: "Campo do Vision",
  CONSTANT: "Valor fixo",
  VALUE_MAP: "Tabela de-para",
  IGNORE: "Não enviar",
};

export const TRANSFORMS = [
  "TRIM",
  "UPPERCASE",
  "REMOVE_ACCENTS",
  "DIGITS_ONLY",
  "DOCUMENT",
  "DATE_BR",
  "NUMBER",
  "INTEGER",
  "BOOLEAN_SN",
  "PHONE_DDD",
  "PHONE_NUMBER",
] as const;
export type Transform = (typeof TRANSFORMS)[number];

export const TRANSFORM_LABELS: Record<Transform, string> = {
  TRIM: "Remover espaços nas pontas",
  UPPERCASE: "MAIÚSCULAS",
  REMOVE_ACCENTS: "Remover acentos",
  DIGITS_ONLY: "Somente dígitos",
  DOCUMENT: "Documento (remove . / -)",
  DATE_BR: "Data dd/mm/aaaa",
  NUMBER: "Número decimal",
  INTEGER: "Número inteiro",
  BOOLEAN_SN: "Booleano → S/N",
  PHONE_DDD: "Telefone → DDD",
  PHONE_NUMBER: "Telefone → número sem DDD",
};

/** Cadastros do Omie que podem ser carregados em listas na tela de mapeamento. */
export const LOOKUP_ENTITIES = [
  "produtos",
  "servicos",
  "categorias",
  "departamentos",
  "projetos",
  "contas_correntes",
  "vendedores",
  "parcelas",
  "etapas_faturamento",
  "cenarios_impostos",
] as const;
export type LookupEntity = (typeof LOOKUP_ENTITIES)[number];

export const LOOKUP_ENTITY_LABELS: Record<LookupEntity, string> = {
  produtos: "Produtos",
  servicos: "Serviços",
  categorias: "Categorias",
  departamentos: "Departamentos",
  projetos: "Projetos",
  contas_correntes: "Contas correntes",
  vendedores: "Vendedores",
  parcelas: "Condições de pagamento (parcelas)",
  etapas_faturamento: "Etapas de faturamento",
  cenarios_impostos: "Cenários de impostos",
};

/** Entidade de uma tabela de-para: um cadastro Omie ou texto livre. */
export type ValueMapEntity = LookupEntity | "livre";

export interface LookupOption {
  value: string;
  label: string;
  description?: string;
  inactive?: boolean;
}

/** Especificação de como obter o valor de um campo de destino. */
export interface RuleSpec {
  sourceType: SourceType;
  /** Caminho no pedido Vision (`cliente.cpfcnpj`) ou template (`{cliente.cidade} ({cliente.uf})`). */
  sourcePath?: string | null;
  /** Valor fixo. Aceita os tokens {{hoje}} e {{codigoPedido}}. */
  constantValue?: string | null;
  /** Chave da tabela de-para (ex.: `produtos`). */
  valueMapKey?: string | null;
  transforms?: Transform[];
  /** Valor usado quando o resultado ficar vazio (também aceita template/tokens). */
  defaultValue?: string | null;
}

export type ValueType = "string" | "integer" | "decimal" | "date" | "flag";

export interface TargetFieldDefinition {
  /** Caminho no payload Omie. Itens usam `det[].` (pedido) ou `ServicosPrestados[].` (OS). */
  key: string;
  documentType: DocumentType;
  scope: "header" | "item";
  group: string;
  label: string;
  description: string;
  valueType: ValueType;
  required: boolean;
  lookup?: LookupEntity;
  maxLength?: number;
  /** Campos enviados junto quando este tiver valor (ex.: percentual de rateio do departamento). */
  companions?: Array<{ key: string; value: string | number }>;
  defaultRule: RuleSpec | null;
  /** Campos preenchidos pela própria integração (somente leitura na tela). */
  system?: boolean;
}

export type RuleOrigin = "DEFAULT" | "GLOBAL" | "ACCOUNT";

export interface EffectiveRule {
  definition: TargetFieldDefinition;
  spec: RuleSpec | null;
  origin: RuleOrigin;
  ruleId: string | null;
  custom: boolean;
}

export type MappingIssueKind = "MISSING_REQUIRED" | "VALUE_MAP_MISSING" | "VALUE_MAP_NOT_FOUND" | "INVALID_VALUE" | "TRUNCATED" | "LINE_TOTAL_MISMATCH" | "NO_INSTALLMENTS";

export interface MappingIssue {
  severity: "error" | "warning";
  kind: MappingIssueKind;
  documentType: DocumentType;
  targetField: string;
  label: string;
  message: string;
  hint?: string;
  visionValue?: string;
  valueMapKey?: string;
  itemIndex?: number;
}

export interface FieldTrace {
  key: string;
  label: string;
  itemIndex?: number;
  origin: RuleOrigin | "SYSTEM";
  source: string;
  rawValue: unknown;
  value: unknown;
}
