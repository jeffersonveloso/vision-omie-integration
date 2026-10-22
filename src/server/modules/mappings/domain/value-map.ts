import { fail, ok, type Result, ValidationError } from "@/server/shared/domain/result";
import { LOOKUP_ENTITIES, type ValueMapEntity } from "./types";

export interface ValueMapProps {
  id: string;
  /** Identificador estável usado nas regras (ex.: `produtos`). */
  key: string;
  name: string;
  omieEntity: ValueMapEntity;
  description: string | null;
  /** Dica do campo do Vision normalmente usado como chave (ex.: `itens[].codigoMaterial`). */
  visionSourceHint: string | null;
  /** Tabelas do sistema (produtos, serviços, roteamento) não podem ser excluídas. */
  system: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ValueMapInput = Pick<ValueMapProps, "key" | "name" | "omieEntity" | "description" | "visionSourceHint">;

/**
 * Definição de uma tabela de-para (ex.: "Produto Vision 123 → Produto Omie 4422421").
 * As linhas (entradas) são mantidas por conta Omie, pois os códigos do Omie são de cada base.
 */
export class ValueMap {
  private constructor(private props: ValueMapProps) {}

  static create(input: ValueMapInput, id: string, now: Date, system = false): Result<ValueMap, ValidationError> {
    const v = ValueMap.validate(input);
    if (!v.ok) return v;
    return ok(new ValueMap({ ...ValueMap.normalize(input), id, system, createdAt: now, updatedAt: now }));
  }

  static restore(props: ValueMapProps): ValueMap {
    return new ValueMap(props);
  }

  update(input: Omit<ValueMapInput, "key">, now: Date): Result<void, ValidationError> {
    const v = ValueMap.validate({ ...input, key: this.props.key });
    if (!v.ok) return v;
    this.props = { ...this.props, ...ValueMap.normalize({ ...input, key: this.props.key }), updatedAt: now };
    return ok(undefined);
  }

  private static normalize(input: ValueMapInput): ValueMapInput {
    return {
      key: input.key.trim().toLowerCase(),
      name: input.name.trim(),
      omieEntity: input.omieEntity,
      description: input.description?.trim() || null,
      visionSourceHint: input.visionSourceHint?.trim() || null,
    };
  }

  private static validate(input: ValueMapInput): Result<void, ValidationError> {
    const errors: Record<string, string> = {};
    if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(input.key?.trim().toLowerCase() ?? "")) errors.key = "Use letras minúsculas, números e hífen (2 a 50).";
    if (!input.name?.trim()) errors.name = "Informe o nome.";
    if (input.omieEntity !== "livre" && !LOOKUP_ENTITIES.includes(input.omieEntity)) errors.omieEntity = "Entidade Omie inválida.";
    if (Object.keys(errors).length > 0) return fail(new ValidationError("Tabela de-para inválida.", errors));
    return ok(undefined);
  }

  get id() { return this.props.id; }
  get key() { return this.props.key; }
  get name() { return this.props.name; }
  get omieEntity() { return this.props.omieEntity; }
  get system() { return this.props.system; }

  toSnapshot(): ValueMapProps {
    return { ...this.props };
  }
}

export interface ValueMapEntry {
  id: string;
  valueMapId: string;
  omieAccountId: string;
  visionValue: string;
  visionLabel: string | null;
  omieValue: string;
  omieLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Normaliza a chave Vision para comparação (evita "123" ≠ "123 " ≠ 123). */
export function normalizeVisionKey(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().toUpperCase();
}

/** Tabelas criadas automaticamente na inicialização. */
export const SYSTEM_VALUE_MAPS: ValueMapInput[] = [
  { key: "produtos", name: "Produtos", omieEntity: "produtos", description: "Material/produto do Vision → produto do Omie (itens do pedido de venda).", visionSourceHint: "itens[].codigoMaterial" },
  { key: "servicos", name: "Serviços", omieEntity: "servicos", description: "Serviço do Vision → serviço do Omie (itens da ordem de serviço).", visionSourceHint: "servicos[].codigoServico" },
  { key: "empresa-cnpj", name: "Empresa Vision → CNPJ", omieEntity: "livre", description: "Roteamento alternativo: quando o pedido não trouxer o CNPJ, o código da empresa no Vision indica a conta Omie. Valor Omie = CNPJ da conta.", visionSourceHint: "codigoEmpresa" },
  { key: "conta-corrente-retorno", name: "Conta corrente (retorno de baixas)", omieEntity: "contas_correntes", description: "Conta corrente do Vision ↔ conta corrente do Omie. Usada para informar ao Vision a conta das baixas.", visionSourceHint: "codigoContaCorrente" },
];
