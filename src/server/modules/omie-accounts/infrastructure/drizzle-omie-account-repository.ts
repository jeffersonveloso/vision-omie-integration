import { asc, eq } from "drizzle-orm";
import type { SecretCipher } from "@/server/shared/application/ports";
import { Cnpj } from "@/server/shared/domain/cnpj";
import type { Database } from "@/server/infrastructure/database/client";
import { omieAccounts } from "@/server/infrastructure/database/schema";
import { OmieAccount } from "../domain/omie-account";
import type { OmieAccountRepository } from "../domain/omie-account-repository";

type Row = typeof omieAccounts.$inferSelect;

export class DrizzleOmieAccountRepository implements OmieAccountRepository {
  constructor(
    private readonly db: Database,
    private readonly cipher: SecretCipher,
  ) {}

  private toDomain(row: Row): OmieAccount {
    return OmieAccount.restore({
      id: row.id,
      name: row.name,
      appKey: row.appKey,
      appSecret: this.cipher.decrypt(row.appSecretEncrypted),
      cnpj: Cnpj.unsafe(row.cnpj),
      description: row.description,
      active: row.active,
      lastCheck: row.lastCheckAt ? { at: row.lastCheckAt, ok: Boolean(row.lastCheckOk), message: row.lastCheckMessage ?? "" } : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async findById(id: string): Promise<OmieAccount | null> {
    const [row] = await this.db.select().from(omieAccounts).where(eq(omieAccounts.id, id)).limit(1);
    return row ? this.toDomain(row) : null;
  }

  async findByCnpj(cnpj: string): Promise<OmieAccount | null> {
    const [row] = await this.db.select().from(omieAccounts).where(eq(omieAccounts.cnpj, Cnpj.normalize(cnpj))).limit(1);
    return row ? this.toDomain(row) : null;
  }

  async list(): Promise<OmieAccount[]> {
    const rows = await this.db.select().from(omieAccounts).orderBy(asc(omieAccounts.name));
    return rows.map((r) => this.toDomain(r));
  }

  async save(account: OmieAccount): Promise<void> {
    const values = {
      id: account.id,
      name: account.name,
      appKey: account.appKey,
      appSecretEncrypted: this.cipher.encrypt(account.appSecret),
      cnpj: account.cnpj.value,
      description: account.description,
      active: account.active,
      lastCheckAt: account.lastCheck?.at ?? null,
      lastCheckOk: account.lastCheck?.ok ?? null,
      lastCheckMessage: account.lastCheck?.message ?? null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
    const { id: _id, createdAt: _createdAt, ...update } = values;
    await this.db.insert(omieAccounts).values(values).onConflictDoUpdate({ target: omieAccounts.id, set: update });
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(omieAccounts).where(eq(omieAccounts.id, id));
  }
}
