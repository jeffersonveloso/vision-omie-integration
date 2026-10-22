import { toBrDate, toBrDateFromAny } from "@/server/shared/domain/dates";
import { getPath } from "./object-path";
import { ITEM_COLLECTIONS } from "./target-field-catalog";
import { applyTransform } from "./transforms";
import {
  DOCUMENT_TYPE_LABELS,
  type DocumentType,
  type EffectiveRule,
  type FieldTrace,
  type MappingIssue,
  type RuleSpec,
  type TargetFieldDefinition,
} from "./types";
import { normalizeVisionKey } from "./value-map";

export interface ValueMapResolver {
  exists(mapKey: string): boolean;
  name(mapKey: string): string;
  resolve(mapKey: string, visionValue: string): { omieValue: string; omieLabel: string | null } | null;
}

export interface MappingContext {
  timeZone: string;
  now: Date;
  accountName: string;
  rules: EffectiveRule[];
  valueMaps: ValueMapResolver;
  /** Tokens disponíveis em valores fixos: {{hoje}}, {{codigoPedido}}... */
  tokens?: Record<string, string>;
}

export interface MappingResult {
  /** Chave = caminho Omie de cabeçalho. Só contém valores não vazios. */
  header: Record<string, unknown>;
  /** Uma entrada por item; chaves relativas ao item (sem `det[].`). */
  items: Array<Record<string, unknown>>;
  issues: MappingIssue[];
  trace: FieldTrace[];
}

interface Evaluation {
  raw: unknown;
  value: unknown;
  source: string;
  issue?: Omit<MappingIssue, "documentType" | "targetField" | "label">;
}

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/**
 * Serviço de domínio que aplica as regras de mapeamento sobre o pedido do Vision.
 * Puro e determinístico: não acessa banco nem API — tudo vem do MappingContext.
 */
export class MappingEngine {
  map(documentType: DocumentType, root: unknown, ctx: MappingContext): MappingResult {
    const result: MappingResult = { header: {}, items: [], issues: [], trace: [] };
    const collection = ITEM_COLLECTIONS[documentType];

    for (const rule of ctx.rules.filter((r) => r.definition.scope === "header" && !r.definition.system)) {
      const evaluated = this.evaluateField(documentType, rule, root, root, ctx, undefined);
      result.trace.push({ key: rule.definition.key, label: rule.definition.label, origin: rule.origin, source: evaluated.source, rawValue: evaluated.raw, value: evaluated.value });
      result.issues.push(...evaluated.issues);
      if (!isEmpty(evaluated.value)) {
        result.header[rule.definition.key] = evaluated.value;
        for (const companion of rule.definition.companions ?? []) result.header[companion.key] = companion.value;
      }
    }

    if (collection) {
      const items = getPath(root, collection.visionCollection);
      const list = Array.isArray(items) ? items : [];
      const itemRules = ctx.rules.filter((r) => r.definition.scope === "item" && !r.definition.system);
      list.forEach((item, index) => {
        const mapped: Record<string, unknown> = {};
        for (const rule of itemRules) {
          const evaluated = this.evaluateField(documentType, rule, item, root, ctx, index);
          const relativeKey = rule.definition.key.slice(collection.targetPrefix.length);
          result.trace.push({ key: rule.definition.key, label: rule.definition.label, itemIndex: index, origin: rule.origin, source: evaluated.source, rawValue: evaluated.raw, value: evaluated.value });
          result.issues.push(...evaluated.issues);
          if (!isEmpty(evaluated.value)) {
            mapped[relativeKey] = evaluated.value;
            for (const companion of rule.definition.companions ?? []) mapped[companion.key.slice(collection.targetPrefix.length)] = companion.value;
          }
        }
        result.items.push(mapped);
      });
    }
    return result;
  }

  private evaluateField(
    documentType: DocumentType,
    rule: EffectiveRule,
    scope: unknown,
    root: unknown,
    ctx: MappingContext,
    itemIndex: number | undefined,
  ): { value: unknown; raw: unknown; source: string; issues: MappingIssue[] } {
    const { definition, spec } = rule;
    const issues: MappingIssue[] = [];
    const base = { documentType, targetField: definition.key, label: definition.label, itemIndex };
    const itemLabel = itemIndex !== undefined ? `Item ${itemIndex + 1}: ` : "";

    if (!spec && definition.managedBy) {
      // Preenchido depois pela integração a partir da configuração (ex.: condições de pagamento).
      return { value: undefined, raw: undefined, source: `Definido em ${definition.managedBy}`, issues };
    }
    if (!spec || spec.sourceType === "IGNORE") {
      if (definition.required) {
        issues.push({
          ...base,
          severity: "error",
          kind: "MISSING_REQUIRED",
          message: `${itemLabel}campo obrigatório "${definition.label}" (${definition.key}) não está mapeado.`,
          hint: `Configure uma regra para "${definition.label}" em Mapeamentos › ${DOCUMENT_TYPE_LABELS[documentType]} (conta ${ctx.accountName}).`,
        });
      }
      return { value: undefined, raw: undefined, source: spec ? "Não enviar" : "Sem regra", issues };
    }

    const evaluation = this.evaluate(spec, scope, root, ctx);
    if (evaluation.issue) {
      const severity = evaluation.issue.kind === "VALUE_MAP_MISSING" && !definition.required ? "warning" : evaluation.issue.severity;
      issues.push({ ...base, ...evaluation.issue, severity, message: itemLabel + evaluation.issue.message });
    }

    let value = evaluation.value;
    if (isEmpty(value) && !isEmpty(spec.defaultValue)) {
      value = this.applyTransforms(this.renderTemplate(String(spec.defaultValue), scope, root, ctx), spec, ctx);
    }

    const coerced = this.coerce(value, definition, ctx);
    if (coerced.issue) issues.push({ ...base, ...coerced.issue, message: itemLabel + coerced.issue.message });

    if (isEmpty(coerced.value) && definition.required && !issues.some((i) => i.severity === "error")) {
      issues.push({
        ...base,
        severity: "error",
        kind: "MISSING_REQUIRED",
        message: `${itemLabel}campo obrigatório "${definition.label}" ficou vazio (origem: ${evaluation.source}).`,
        hint: spec.sourceType === "VISION_FIELD" || spec.sourceType === "VALUE_MAP"
          ? `Verifique se o pedido no Vision possui "${spec.sourcePath}" preenchido ou defina um valor padrão na regra.`
          : `Revise a regra de "${definition.label}" em Mapeamentos.`,
      });
    }
    return { value: coerced.value, raw: evaluation.raw, source: evaluation.source, issues };
  }

  private evaluate(spec: RuleSpec, scope: unknown, root: unknown, ctx: MappingContext): Evaluation {
    switch (spec.sourceType) {
      case "CONSTANT": {
        const raw = this.renderTokens(spec.constantValue ?? "", ctx);
        return { raw, value: this.applyTransforms(raw, spec, ctx), source: `Valor fixo "${spec.constantValue}"` };
      }
      case "VISION_FIELD": {
        const raw = this.readSource(spec.sourcePath ?? "", scope, root, ctx);
        return { raw, value: this.applyTransforms(raw, spec, ctx), source: `Vision: ${spec.sourcePath}` };
      }
      case "VALUE_MAP": {
        const mapKey = spec.valueMapKey ?? "";
        const raw = this.readSource(spec.sourcePath ?? "", scope, root, ctx);
        const source = `De-para "${ctx.valueMaps.exists(mapKey) ? ctx.valueMaps.name(mapKey) : mapKey}" via ${spec.sourcePath}`;
        if (!ctx.valueMaps.exists(mapKey)) {
          return { raw, value: undefined, source, issue: { severity: "error", kind: "VALUE_MAP_NOT_FOUND", message: `a tabela de-para "${mapKey}" não existe.`, hint: "Crie a tabela em Mapeamentos › Tabelas de-para ou ajuste a regra.", valueMapKey: mapKey } };
        }
        if (isEmpty(raw)) return { raw, value: undefined, source };
        const visionKey = normalizeVisionKey(raw);
        const entry = ctx.valueMaps.resolve(mapKey, visionKey);
        if (!entry) {
          const mapName = ctx.valueMaps.name(mapKey);
          return {
            raw,
            value: undefined,
            source,
            issue: {
              severity: "error",
              kind: "VALUE_MAP_MISSING",
              message: `sem de-para para o valor "${String(raw)}" na tabela "${mapName}" (conta ${ctx.accountName}).`,
              hint: `Cadastre "${String(raw)}" em Mapeamentos › Tabelas de-para › ${mapName} para a conta ${ctx.accountName} e reenvie o pedido.`,
              visionValue: String(raw),
              valueMapKey: mapKey,
            },
          };
        }
        return { raw, value: this.applyTransforms(entry.omieValue, spec, ctx), source };
      }
      default:
        return { raw: undefined, value: undefined, source: "Não enviar" };
    }
  }

  private readSource(path: string, scope: unknown, root: unknown, ctx: MappingContext): unknown {
    if (path.includes("{")) return this.renderTemplate(path, scope, root, ctx);
    if (path.startsWith("$pedido.")) return getPath(root, path.slice("$pedido.".length));
    return getPath(scope, path);
  }

  /** Templates: `{cliente.cidade} ({cliente.uf})`. Retorna "" se todos os campos estiverem vazios. */
  private renderTemplate(template: string, scope: unknown, root: unknown, ctx: MappingContext): string {
    const withTokens = this.renderTokens(template, ctx);
    let resolvedAny = false;
    let placeholders = 0;
    const rendered = withTokens.replace(/\{([^{}]+)\}/g, (_, rawPath: string) => {
      placeholders++;
      const value = this.readSource(rawPath.trim(), scope, root, ctx);
      if (isEmpty(value)) return "";
      resolvedAny = true;
      return String(value);
    });
    if (placeholders > 0 && !resolvedAny) return "";
    return rendered.trim();
  }

  private renderTokens(value: string, ctx: MappingContext): string {
    const tokens: Record<string, string> = { hoje: toBrDate(ctx.now, ctx.timeZone), ...(ctx.tokens ?? {}) };
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name: string) => tokens[name] ?? match);
  }

  private applyTransforms(value: unknown, spec: RuleSpec, ctx: MappingContext): unknown {
    return (spec.transforms ?? []).reduce((acc, t) => applyTransform(acc, t, { timeZone: ctx.timeZone }), value);
  }

  private coerce(value: unknown, def: TargetFieldDefinition, ctx: MappingContext): { value: unknown; issue?: Omit<MappingIssue, "documentType" | "targetField" | "label"> } {
    if (isEmpty(value)) return { value: undefined };
    const invalid = (expected: string) => ({
      value: undefined,
      issue: {
        severity: "error" as const,
        kind: "INVALID_VALUE" as const,
        message: `valor "${String(value)}" inválido para "${def.label}" (esperado: ${expected}).`,
        hint: "Ajuste a regra ou a transformação aplicada a este campo.",
      },
    });
    switch (def.valueType) {
      case "integer": {
        const n = typeof value === "number" ? value : Number(String(value).trim());
        return Number.isFinite(n) && Number.isInteger(n) ? { value: n } : invalid("número inteiro");
      }
      case "decimal": {
        const n = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
        return Number.isFinite(n) ? { value: n } : invalid("número");
      }
      case "date": {
        const br = toBrDateFromAny(value, ctx.timeZone);
        return br ? { value: br } : invalid("data dd/mm/aaaa");
      }
      case "flag": {
        const v = applyTransform(value, "BOOLEAN_SN", { timeZone: ctx.timeZone });
        return v === "S" || v === "N" ? { value: v } : invalid("S ou N");
      }
      default: {
        const s = typeof value === "string" ? value : String(value);
        if (def.maxLength && s.length > def.maxLength) {
          return {
            value: s.slice(0, def.maxLength),
            issue: { severity: "warning", kind: "TRUNCATED", message: `"${def.label}" foi truncado para ${def.maxLength} caracteres.` },
          };
        }
        return { value: s };
      }
    }
  }
}
