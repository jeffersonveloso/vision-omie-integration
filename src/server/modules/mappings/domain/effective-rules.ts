import type { FieldRule } from "./field-rule";
import { catalogFor, customDefinition } from "./target-field-catalog";
import type { DocumentType, EffectiveRule } from "./types";

/**
 * Resolve a regra efetiva de cada campo: regra da conta > regra global > padrão do catálogo.
 * Regras inativas são ignoradas (caem para o próximo nível).
 * Regras para chaves fora do catálogo viram "campos personalizados".
 */
export function resolveEffectiveRules(
  documentType: DocumentType,
  rules: FieldRule[],
  omieAccountId: string | null,
): EffectiveRule[] {
  const relevant = rules.filter((r) => r.documentType === documentType && r.active);
  const accountRules = new Map(relevant.filter((r) => omieAccountId && r.omieAccountId === omieAccountId).map((r) => [r.targetField, r]));
  const globalRules = new Map(relevant.filter((r) => r.omieAccountId === null).map((r) => [r.targetField, r]));

  const catalog = catalogFor(documentType);
  const catalogKeys = new Set(catalog.map((d) => d.key));

  const effective: EffectiveRule[] = catalog.map((definition) => {
    if (definition.system) return { definition, spec: null, origin: "DEFAULT", ruleId: null, custom: false };
    const account = accountRules.get(definition.key);
    if (account) return { definition, spec: account.spec(), origin: "ACCOUNT", ruleId: account.id, custom: false };
    const global = globalRules.get(definition.key);
    if (global) return { definition, spec: global.spec(), origin: "GLOBAL", ruleId: global.id, custom: false };
    return { definition, spec: definition.defaultRule, origin: "DEFAULT", ruleId: null, custom: false };
  });

  const customKeys = new Set([...accountRules.keys(), ...globalRules.keys()].filter((k) => !catalogKeys.has(k)));
  for (const key of [...customKeys].sort()) {
    const rule = accountRules.get(key) ?? globalRules.get(key)!;
    effective.push({
      definition: customDefinition(documentType, key),
      spec: rule.spec(),
      origin: rule.omieAccountId ? "ACCOUNT" : "GLOBAL",
      ruleId: rule.id,
      custom: true,
    });
  }
  return effective;
}
