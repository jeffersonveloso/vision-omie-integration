import { fail, ok, type Result, ValidationError } from "@/server/shared/domain/result";
import { findTargetDefinition, isValidTargetKey } from "./target-field-catalog";
import { DOCUMENT_TYPES, type DocumentType, type RuleSpec, SOURCE_TYPES, TRANSFORMS } from "./types";

export interface FieldRuleProps extends RuleSpec {
  id: string;
  /** null = regra padrão para todas as contas Omie. */
  omieAccountId: string | null;
  documentType: DocumentType;
  targetField: string;
  active: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type FieldRuleInput = Omit<FieldRuleProps, "id" | "createdAt" | "updatedAt">;

/**
 * Regra de mapeamento de um campo Omie. Uma regra de conta sobrepõe a regra global,
 * que por sua vez sobrepõe o padrão do catálogo.
 */
export class FieldRule {
  private constructor(private props: FieldRuleProps) {}

  static create(input: FieldRuleInput, id: string, now: Date): Result<FieldRule, ValidationError> {
    const validation = FieldRule.validate(input);
    if (!validation.ok) return validation;
    return ok(new FieldRule({ ...FieldRule.normalize(input), id, createdAt: now, updatedAt: now }));
  }

  static restore(props: FieldRuleProps): FieldRule {
    return new FieldRule(props);
  }

  update(input: FieldRuleInput, now: Date): Result<void, ValidationError> {
    const validation = FieldRule.validate(input);
    if (!validation.ok) return validation;
    this.props = { ...this.props, ...FieldRule.normalize(input), updatedAt: now };
    return ok(undefined);
  }

  private static normalize(input: FieldRuleInput): FieldRuleInput {
    return {
      ...input,
      sourcePath: input.sourcePath?.trim() || null,
      constantValue: input.constantValue ?? null,
      valueMapKey: input.valueMapKey?.trim() || null,
      transforms: input.transforms ?? [],
      defaultValue: input.defaultValue === "" ? null : (input.defaultValue ?? null),
      notes: input.notes?.trim() || null,
    };
  }

  static validate(input: FieldRuleInput): Result<void, ValidationError> {
    const errors: Record<string, string> = {};
    if (!DOCUMENT_TYPES.includes(input.documentType)) errors.documentType = "Tipo de documento inválido.";
    if (!SOURCE_TYPES.includes(input.sourceType)) errors.sourceType = "Origem inválida.";
    if (!input.targetField?.trim()) errors.targetField = "Informe o campo Omie.";
    else if (!isValidTargetKey(input.documentType, input.targetField.trim())) errors.targetField = "Caminho de campo Omie inválido.";
    const definition = input.targetField ? findTargetDefinition(input.documentType, input.targetField) : undefined;
    if (definition?.system) errors.targetField = "Este campo é preenchido pela própria integração.";
    if (input.sourceType === "VISION_FIELD" && !input.sourcePath?.trim()) errors.sourcePath = "Informe o campo do Vision.";
    if (input.sourceType === "VALUE_MAP") {
      if (!input.sourcePath?.trim()) errors.sourcePath = "Informe o campo do Vision usado como chave.";
      if (!input.valueMapKey?.trim()) errors.valueMapKey = "Selecione a tabela de-para.";
    }
    if (input.sourceType === "CONSTANT" && (input.constantValue === null || input.constantValue === undefined || input.constantValue === "")) {
      errors.constantValue = "Informe o valor fixo.";
    }
    if (input.transforms?.some((t) => !TRANSFORMS.includes(t))) errors.transforms = "Transformação inválida.";
    if (Object.keys(errors).length > 0) return fail(new ValidationError("Regra de mapeamento inválida.", errors));
    return ok(undefined);
  }

  get id() { return this.props.id; }
  get omieAccountId() { return this.props.omieAccountId; }
  get documentType() { return this.props.documentType; }
  get targetField() { return this.props.targetField; }
  get active() { return this.props.active; }

  spec(): RuleSpec {
    const { sourceType, sourcePath, constantValue, valueMapKey, transforms, defaultValue } = this.props;
    return { sourceType, sourcePath, constantValue, valueMapKey, transforms, defaultValue };
  }

  toSnapshot(): FieldRuleProps {
    return { ...this.props };
  }
}
