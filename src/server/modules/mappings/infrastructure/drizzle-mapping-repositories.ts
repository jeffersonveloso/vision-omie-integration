import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@/server/infrastructure/database/client";
import { fieldRules, valueMapEntries, valueMaps } from "@/server/infrastructure/database/schema";
import { FieldRule } from "../domain/field-rule";
import type { FieldRuleRepository, ValueMapEntryRepository, ValueMapRepository } from "../domain/repositories";
import type { DocumentType, SourceType, Transform, ValueMapEntity } from "../domain/types";
import { ValueMap, type ValueMapEntry } from "../domain/value-map";

type RuleRow = typeof fieldRules.$inferSelect;
type MapRow = typeof valueMaps.$inferSelect;
type EntryRow = typeof valueMapEntries.$inferSelect;

const ruleFromRow = (r: RuleRow) =>
  FieldRule.restore({
    id: r.id,
    omieAccountId: r.omieAccountId,
    documentType: r.documentType as DocumentType,
    targetField: r.targetField,
    sourceType: r.sourceType as SourceType,
    sourcePath: r.sourcePath,
    constantValue: r.constantValue,
    valueMapKey: r.valueMapKey,
    transforms: (r.transforms ?? []) as Transform[],
    defaultValue: r.defaultValue,
    active: r.active,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });

export class DrizzleFieldRuleRepository implements FieldRuleRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<FieldRule | null> {
    const [row] = await this.db.select().from(fieldRules).where(eq(fieldRules.id, id)).limit(1);
    return row ? ruleFromRow(row) : null;
  }

  async listForScope(documentType: DocumentType | null, omieAccountId: string | null): Promise<FieldRule[]> {
    const scope = omieAccountId ? or(isNull(fieldRules.omieAccountId), eq(fieldRules.omieAccountId, omieAccountId)) : isNull(fieldRules.omieAccountId);
    const where = documentType ? and(scope, eq(fieldRules.documentType, documentType)) : scope;
    const rows = await this.db.select().from(fieldRules).where(where).orderBy(asc(fieldRules.targetField));
    return rows.map(ruleFromRow);
  }

  async findByScopeAndTarget(omieAccountId: string | null, documentType: DocumentType, targetField: string): Promise<FieldRule | null> {
    const [row] = await this.db
      .select()
      .from(fieldRules)
      .where(and(eq(fieldRules.scopeKey, omieAccountId ?? "global"), eq(fieldRules.documentType, documentType), eq(fieldRules.targetField, targetField)))
      .limit(1);
    return row ? ruleFromRow(row) : null;
  }

  async save(rule: FieldRule): Promise<void> {
    const s = rule.toSnapshot();
    const values = {
      id: s.id,
      omieAccountId: s.omieAccountId,
      scopeKey: s.omieAccountId ?? "global",
      documentType: s.documentType,
      targetField: s.targetField,
      sourceType: s.sourceType,
      sourcePath: s.sourcePath ?? null,
      constantValue: s.constantValue ?? null,
      valueMapKey: s.valueMapKey ?? null,
      transforms: s.transforms ?? [],
      defaultValue: s.defaultValue ?? null,
      active: s.active,
      notes: s.notes,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
    const { id: _id, createdAt: _c, ...update } = values;
    await this.db.insert(fieldRules).values(values).onConflictDoUpdate({ target: fieldRules.id, set: update });
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(fieldRules).where(eq(fieldRules.id, id));
  }
}

const mapFromRow = (r: MapRow) =>
  ValueMap.restore({
    id: r.id,
    key: r.key,
    name: r.name,
    omieEntity: r.omieEntity as ValueMapEntity,
    description: r.description,
    visionSourceHint: r.visionSourceHint,
    system: r.isSystem,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });

export class DrizzleValueMapRepository implements ValueMapRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<ValueMap | null> {
    const [row] = await this.db.select().from(valueMaps).where(eq(valueMaps.id, id)).limit(1);
    return row ? mapFromRow(row) : null;
  }

  async findByKey(key: string): Promise<ValueMap | null> {
    const [row] = await this.db.select().from(valueMaps).where(eq(valueMaps.key, key)).limit(1);
    return row ? mapFromRow(row) : null;
  }

  async list(): Promise<ValueMap[]> {
    const rows = await this.db.select().from(valueMaps).orderBy(sql`${valueMaps.isSystem} desc`, asc(valueMaps.name));
    return rows.map(mapFromRow);
  }

  async save(map: ValueMap): Promise<void> {
    const s = map.toSnapshot();
    const values = { id: s.id, key: s.key, name: s.name, omieEntity: s.omieEntity, description: s.description, visionSourceHint: s.visionSourceHint, isSystem: s.system, createdAt: s.createdAt, updatedAt: s.updatedAt };
    const { id: _id, createdAt: _c, key: _k, ...update } = values;
    await this.db.insert(valueMaps).values(values).onConflictDoUpdate({ target: valueMaps.id, set: update });
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(valueMaps).where(eq(valueMaps.id, id));
  }

  async countEntries(valueMapId: string): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ accountId: valueMapEntries.omieAccountId, count: sql<number>`count(*)::int` })
      .from(valueMapEntries)
      .where(eq(valueMapEntries.valueMapId, valueMapId))
      .groupBy(valueMapEntries.omieAccountId);
    return Object.fromEntries(rows.map((r) => [r.accountId, Number(r.count)]));
  }
}

const entryFromRow = (r: EntryRow): ValueMapEntry => ({
  id: r.id,
  valueMapId: r.valueMapId,
  omieAccountId: r.omieAccountId,
  visionValue: r.visionValue,
  visionLabel: r.visionLabel,
  omieValue: r.omieValue,
  omieLabel: r.omieLabel,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export class DrizzleValueMapEntryRepository implements ValueMapEntryRepository {
  constructor(private readonly db: Database) {}

  async listByMap(valueMapId: string, omieAccountId: string): Promise<ValueMapEntry[]> {
    const rows = await this.db
      .select()
      .from(valueMapEntries)
      .where(and(eq(valueMapEntries.valueMapId, valueMapId), eq(valueMapEntries.omieAccountId, omieAccountId)))
      .orderBy(asc(valueMapEntries.visionValue));
    return rows.map(entryFromRow);
  }

  async listByAccount(omieAccountId: string): Promise<Array<ValueMapEntry & { valueMapKey: string }>> {
    const rows = await this.db
      .select({ entry: valueMapEntries, key: valueMaps.key })
      .from(valueMapEntries)
      .innerJoin(valueMaps, eq(valueMaps.id, valueMapEntries.valueMapId))
      .where(eq(valueMapEntries.omieAccountId, omieAccountId));
    return rows.map((r) => ({ ...entryFromRow(r.entry), valueMapKey: r.key }));
  }

  async findAcrossAccounts(valueMapKey: string, visionValue: string): Promise<ValueMapEntry[]> {
    const rows = await this.db
      .select({ entry: valueMapEntries })
      .from(valueMapEntries)
      .innerJoin(valueMaps, eq(valueMaps.id, valueMapEntries.valueMapId))
      .where(and(eq(valueMaps.key, valueMapKey), eq(valueMapEntries.visionValue, visionValue)));
    return rows.map((r) => entryFromRow(r.entry));
  }

  async findById(id: string): Promise<ValueMapEntry | null> {
    const [row] = await this.db.select().from(valueMapEntries).where(eq(valueMapEntries.id, id)).limit(1);
    return row ? entryFromRow(row) : null;
  }

  async upsert(entry: ValueMapEntry): Promise<ValueMapEntry> {
    const existingById = await this.findById(entry.id);
    if (existingById) {
      // Edição: se o novo valor Vision já existir em outra linha, ela é substituída.
      await this.db
        .delete(valueMapEntries)
        .where(and(eq(valueMapEntries.valueMapId, entry.valueMapId), eq(valueMapEntries.omieAccountId, entry.omieAccountId), eq(valueMapEntries.visionValue, entry.visionValue), sql`${valueMapEntries.id} <> ${entry.id}`));
      const [row] = await this.db
        .update(valueMapEntries)
        .set({ visionValue: entry.visionValue, visionLabel: entry.visionLabel, omieValue: entry.omieValue, omieLabel: entry.omieLabel, updatedAt: entry.updatedAt })
        .where(eq(valueMapEntries.id, entry.id))
        .returning();
      return entryFromRow(row);
    }
    const [row] = await this.db
      .insert(valueMapEntries)
      .values(entry)
      .onConflictDoUpdate({
        target: [valueMapEntries.valueMapId, valueMapEntries.omieAccountId, valueMapEntries.visionValue],
        set: { visionLabel: entry.visionLabel, omieValue: entry.omieValue, omieLabel: entry.omieLabel, updatedAt: entry.updatedAt },
      })
      .returning();
    return entryFromRow(row);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(valueMapEntries).where(eq(valueMapEntries.id, id));
  }

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length) await this.db.delete(valueMapEntries).where(inArray(valueMapEntries.id, ids));
  }
}
