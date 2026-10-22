import { eq } from "drizzle-orm";
import type { Database } from "@/server/infrastructure/database/client";
import { appSettings } from "@/server/infrastructure/database/schema";
import { DEFAULT_SETTINGS, type IntegrationSettings, mergeSettings, type SettingsRepository } from "../domain/integration-settings";

const KEY = "integration";

export class DrizzleSettingsRepository implements SettingsRepository {
  private cache: { value: IntegrationSettings; at: number } | null = null;

  constructor(
    private readonly db: Database,
    private readonly defaults: IntegrationSettings = DEFAULT_SETTINGS,
  ) {}

  async get(): Promise<IntegrationSettings> {
    if (this.cache && Date.now() - this.cache.at < 5_000) return this.cache.value;
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
    const value = mergeSettings((row?.value as Partial<IntegrationSettings>) ?? null, this.defaults);
    this.cache = { value, at: Date.now() };
    return value;
  }

  async save(settings: IntegrationSettings): Promise<void> {
    await this.db
      .insert(appSettings)
      .values({ key: KEY, value: settings, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: settings, updatedAt: new Date() } });
    this.cache = { value: settings, at: Date.now() };
  }
}
