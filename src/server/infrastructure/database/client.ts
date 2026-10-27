import fs from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  driver: "postgres" | "pglite";
  close(): Promise<void>;
}

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * PostgreSQL em produção (DATABASE_URL). Sem DATABASE_URL usa PGlite (Postgres em WASM)
 * gravando em disco — zero configuração para desenvolvimento e testes.
 * As migrações versionadas em /drizzle são aplicadas na inicialização.
 */
export async function createDatabase(options: { url?: string; pgliteDir?: string; migrate?: boolean }): Promise<DatabaseHandle> {
  if (options.url && !options.url.startsWith("pglite:")) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: options.url, max: 10 });
    // Conexão ociosa derrubada pelo servidor (PostgreSQL reiniciado, failover, banco apagado nos testes):
    // sem este handler o evento "error" do pool derruba o processo. O pool abre outra conexão quando precisar.
    pool.on("error", (error) => {
      console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", context: "database", message: "Conexão ociosa com o PostgreSQL encerrada pelo servidor", error: error.message }));
    });
    const db = drizzle({ client: pool, schema });
    if (options.migrate !== false) await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return { db: db as unknown as Database, driver: "postgres", close: () => pool.end() };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const target = options.url?.startsWith("pglite:") ? options.url.slice("pglite:".length) : (options.pgliteDir ?? "./.data/pglite");
  const inMemory = target === "memory" || target === "memory://";
  if (!inMemory) fs.mkdirSync(path.resolve(target), { recursive: true });
  const client = inMemory ? new PGlite() : new PGlite(path.resolve(target));
  const db = drizzle({ client, schema });
  if (options.migrate !== false) await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Database, driver: "pglite", close: () => client.close() };
}
