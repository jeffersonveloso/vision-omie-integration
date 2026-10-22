import type { Clock } from "@/server/shared/application/ports";
import { resolveEffectiveRules } from "../domain/effective-rules";
import type { MappingContext, ValueMapResolver } from "../domain/mapping-engine";
import type { FieldRuleRepository, ValueMapEntryRepository, ValueMapRepository } from "../domain/repositories";
import type { DocumentType } from "../domain/types";
import { normalizeVisionKey } from "../domain/value-map";

export interface AccountRef {
  id: string;
  name: string;
}

/** Monta o contexto de mapeamento (regras efetivas + tabelas de-para) de uma conta Omie. */
export class MappingContextFactory {
  constructor(
    private readonly rules: FieldRuleRepository,
    private readonly maps: ValueMapRepository,
    private readonly entries: ValueMapEntryRepository,
    private readonly clock: Clock,
    private readonly timeZone: string,
  ) {}

  async build(account: AccountRef, tokens: Record<string, string> = {}): Promise<(documentType: DocumentType) => MappingContext> {
    const [allRules, maps, accountEntries] = await Promise.all([
      this.rules.listForScope(null, account.id),
      this.maps.list(),
      this.entries.listByAccount(account.id),
    ]);
    const mapNames = new Map(maps.map((m) => [m.key, m.name]));
    const index = new Map<string, Map<string, { omieValue: string; omieLabel: string | null }>>();
    for (const entry of accountEntries) {
      if (!index.has(entry.valueMapKey)) index.set(entry.valueMapKey, new Map());
      index.get(entry.valueMapKey)!.set(normalizeVisionKey(entry.visionValue), { omieValue: entry.omieValue, omieLabel: entry.omieLabel });
    }
    const resolver: ValueMapResolver = {
      exists: (key) => mapNames.has(key),
      name: (key) => mapNames.get(key) ?? key,
      resolve: (key, visionValue) => index.get(key)?.get(normalizeVisionKey(visionValue)) ?? null,
    };
    const now = this.clock.now();
    return (documentType) => ({
      timeZone: this.timeZone,
      now,
      accountName: account.name,
      rules: resolveEffectiveRules(documentType, allRules, account.id),
      valueMaps: resolver,
      tokens,
    });
  }
}
