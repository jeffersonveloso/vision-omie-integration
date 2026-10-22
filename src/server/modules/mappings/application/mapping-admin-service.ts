import type { Clock, IdGenerator } from "@/server/shared/application/ports";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/server/shared/domain/result";
import { resolveEffectiveRules } from "../domain/effective-rules";
import { FieldRule, type FieldRuleInput } from "../domain/field-rule";
import type { FieldRuleRepository, ValueMapEntryRepository, ValueMapRepository } from "../domain/repositories";
import type { DocumentType, RuleSpec } from "../domain/types";
import { normalizeVisionKey, SYSTEM_VALUE_MAPS, ValueMap, type ValueMapEntry, type ValueMapInput } from "../domain/value-map";

export interface EffectiveRuleView {
  key: string;
  label: string;
  description: string;
  group: string;
  scope: "header" | "item";
  valueType: string;
  required: boolean;
  lookup: string | null;
  system: boolean;
  /** Definido por uma tela de configuração enquanto não houver regra aqui. */
  managedBy: string | null;
  custom: boolean;
  origin: "DEFAULT" | "GLOBAL" | "ACCOUNT";
  ruleId: string | null;
  spec: RuleSpec | null;
  defaultSpec: RuleSpec | null;
}

/** Casos de uso de administração do mapeamento (regras de campo e tabelas de-para). */
export class MappingAdminService {
  constructor(
    private readonly rules: FieldRuleRepository,
    private readonly maps: ValueMapRepository,
    private readonly entries: ValueMapEntryRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  // ── Regras de campo ─────────────────────────────────────────────────

  async listEffectiveRules(documentType: DocumentType, omieAccountId: string | null): Promise<EffectiveRuleView[]> {
    const rules = await this.rules.listForScope(documentType, omieAccountId);
    // Para a visão "Padrão (todas as contas)" só regras globais contam.
    const scoped = omieAccountId ? rules : rules.filter((r) => r.omieAccountId === null);
    return resolveEffectiveRules(documentType, scoped, omieAccountId).map((r) => ({
      key: r.definition.key,
      label: r.definition.label,
      description: r.definition.description,
      group: r.definition.group,
      scope: r.definition.scope,
      valueType: r.definition.valueType,
      required: r.definition.required,
      lookup: r.definition.lookup ?? null,
      system: Boolean(r.definition.system),
      managedBy: r.definition.managedBy ?? null,
      custom: r.custom,
      origin: r.origin,
      ruleId: r.ruleId,
      spec: r.spec,
      defaultSpec: r.definition.defaultRule,
    }));
  }

  async saveRule(input: FieldRuleInput): Promise<FieldRule> {
    const now = this.clock.now();
    const existing = await this.rules.findByScopeAndTarget(input.omieAccountId, input.documentType, input.targetField.trim());
    if (existing) {
      const updated = existing.update({ ...input, targetField: input.targetField.trim() }, now);
      if (!updated.ok) throw updated.error;
      await this.rules.save(existing);
      return existing;
    }
    const created = FieldRule.create({ ...input, targetField: input.targetField.trim() }, this.ids.next(), now);
    if (!created.ok) throw created.error;
    await this.rules.save(created.value);
    return created.value;
  }

  /** Remove a regra: o campo volta a usar a regra global ou o padrão do catálogo. */
  async deleteRule(id: string): Promise<void> {
    const rule = await this.rules.findById(id);
    if (!rule) throw new NotFoundError("Regra de mapeamento", id);
    await this.rules.delete(id);
  }

  // ── Tabelas de-para ─────────────────────────────────────────────────

  async ensureSystemMaps(): Promise<void> {
    for (const input of SYSTEM_VALUE_MAPS) {
      if (await this.maps.findByKey(input.key)) continue;
      const created = ValueMap.create(input, this.ids.next(), this.clock.now(), true);
      if (created.ok) await this.maps.save(created.value);
    }
  }

  async listMaps(): Promise<Array<ReturnType<ValueMap["toSnapshot"]> & { entriesByAccount: Record<string, number> }>> {
    const maps = await this.maps.list();
    return Promise.all(maps.map(async (m) => ({ ...m.toSnapshot(), entriesByAccount: await this.maps.countEntries(m.id) })));
  }

  async createMap(input: ValueMapInput): Promise<ValueMap> {
    if (await this.maps.findByKey(input.key.trim().toLowerCase())) throw new ConflictError(`Já existe uma tabela com a chave "${input.key}".`);
    const created = ValueMap.create(input, this.ids.next(), this.clock.now());
    if (!created.ok) throw created.error;
    await this.maps.save(created.value);
    return created.value;
  }

  async updateMap(id: string, input: Omit<ValueMapInput, "key">): Promise<ValueMap> {
    const map = await this.maps.findById(id);
    if (!map) throw new NotFoundError("Tabela de-para", id);
    const updated = map.update(input, this.clock.now());
    if (!updated.ok) throw updated.error;
    await this.maps.save(map);
    return map;
  }

  async deleteMap(id: string): Promise<void> {
    const map = await this.maps.findById(id);
    if (!map) throw new NotFoundError("Tabela de-para", id);
    if (map.system) throw new DomainError("SYSTEM_MAP", "Tabelas do sistema não podem ser excluídas.");
    await this.maps.delete(id);
  }

  async listEntries(valueMapId: string, omieAccountId: string): Promise<ValueMapEntry[]> {
    return this.entries.listByMap(valueMapId, omieAccountId);
  }

  async upsertEntry(input: {
    id?: string | null;
    valueMapId: string;
    omieAccountId: string;
    visionValue: string;
    visionLabel?: string | null;
    omieValue: string;
    omieLabel?: string | null;
  }): Promise<ValueMapEntry> {
    const errors: Record<string, string> = {};
    if (!input.visionValue?.toString().trim()) errors.visionValue = "Informe o valor do Vision.";
    if (!input.omieValue?.toString().trim()) errors.omieValue = "Informe o valor do Omie.";
    if (Object.keys(errors).length) throw new ValidationError("Linha de de-para inválida.", errors);
    const map = await this.maps.findById(input.valueMapId);
    if (!map) throw new NotFoundError("Tabela de-para", input.valueMapId);
    const now = this.clock.now();
    const existing = input.id ? await this.entries.findById(input.id) : null;
    return this.entries.upsert({
      id: existing?.id ?? this.ids.next(),
      valueMapId: input.valueMapId,
      omieAccountId: input.omieAccountId,
      visionValue: normalizeVisionKey(input.visionValue),
      visionLabel: input.visionLabel?.trim() || null,
      omieValue: String(input.omieValue).trim(),
      omieLabel: input.omieLabel?.trim() || null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async deleteEntry(id: string): Promise<void> {
    await this.entries.delete(id);
  }

  /**
   * Importação em massa (colar CSV): uma linha por correspondência,
   * `valorVision;valorOmie[;descrição]` — separador `;`, `,` ou tab.
   */
  async importEntries(valueMapId: string, omieAccountId: string, text: string): Promise<{ imported: number; skipped: string[] }> {
    const skipped: string[] = [];
    let imported = 0;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const [index, line] of lines.entries()) {
      const parts = line.split(/[;\t,]/).map((p) => p.trim());
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        skipped.push(`Linha ${index + 1}: "${line}"`);
        continue;
      }
      if (index === 0 && /vision/i.test(parts[0]) && /omie/i.test(parts[1])) continue; // cabeçalho
      await this.upsertEntry({ valueMapId, omieAccountId, visionValue: parts[0], omieValue: parts[1], omieLabel: parts[2] ?? null });
      imported++;
    }
    return { imported, skipped };
  }
}
