import { and, eq } from "drizzle-orm";
import type { Database } from "@/server/infrastructure/database/client";
import { lookupCache } from "@/server/infrastructure/database/schema";
import type { LookupEntity, LookupOption } from "@/server/modules/mappings/domain/types";
import type { LookupCache } from "../application/omie-account-service";

/** Cache das listas do Omie (evita estourar o limite de consumo e o bloqueio por requisição redundante). */
export class DrizzleLookupCache implements LookupCache {
  constructor(private readonly db: Database) {}

  async get(accountId: string, entity: LookupEntity, maxAgeMs: number): Promise<LookupOption[] | null> {
    const [row] = await this.db
      .select()
      .from(lookupCache)
      .where(and(eq(lookupCache.omieAccountId, accountId), eq(lookupCache.entity, entity)))
      .limit(1);
    if (!row || Date.now() - row.fetchedAt.getTime() > maxAgeMs) return null;
    return row.options as LookupOption[];
  }

  async set(accountId: string, entity: LookupEntity, options: LookupOption[]): Promise<void> {
    await this.db
      .insert(lookupCache)
      .values({ omieAccountId: accountId, entity, options, fetchedAt: new Date() })
      .onConflictDoUpdate({ target: [lookupCache.omieAccountId, lookupCache.entity], set: { options, fetchedAt: new Date() } });
  }
}
