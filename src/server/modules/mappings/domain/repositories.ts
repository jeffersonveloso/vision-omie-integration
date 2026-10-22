import type { FieldRule } from "./field-rule";
import type { DocumentType } from "./types";
import type { ValueMap, ValueMapEntry } from "./value-map";

export interface FieldRuleRepository {
  findById(id: string): Promise<FieldRule | null>;
  /** Regras globais (accountId null) + regras da conta informada. */
  listForScope(documentType: DocumentType | null, omieAccountId: string | null): Promise<FieldRule[]>;
  findByScopeAndTarget(omieAccountId: string | null, documentType: DocumentType, targetField: string): Promise<FieldRule | null>;
  save(rule: FieldRule): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ValueMapRepository {
  findById(id: string): Promise<ValueMap | null>;
  findByKey(key: string): Promise<ValueMap | null>;
  list(): Promise<ValueMap[]>;
  save(map: ValueMap): Promise<void>;
  delete(id: string): Promise<void>;
  countEntries(valueMapId: string): Promise<Record<string, number>>;
}

export interface ValueMapEntryRepository {
  listByMap(valueMapId: string, omieAccountId: string): Promise<ValueMapEntry[]>;
  listByAccount(omieAccountId: string): Promise<Array<ValueMapEntry & { valueMapKey: string }>>;
  /** Busca entradas de uma tabela em todas as contas (roteamento por código de empresa). */
  findAcrossAccounts(valueMapKey: string, visionValue: string): Promise<ValueMapEntry[]>;
  findById(id: string): Promise<ValueMapEntry | null>;
  upsert(entry: ValueMapEntry): Promise<ValueMapEntry>;
  delete(id: string): Promise<void>;
}
