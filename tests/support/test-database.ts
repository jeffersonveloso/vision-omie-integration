import { randomUUID } from "node:crypto";

/**
 * Banco dos testes. Sem `TEST_DATABASE_URL`: PGlite em memória.
 * Com `TEST_DATABASE_URL` (ex.: PostgreSQL do CI): cria um banco descartável por arquivo de teste,
 * para os arquivos rodarem em paralelo sem dividir dados, e apaga no final.
 */
export async function createTestDatabase(): Promise<{ url: string; drop(): Promise<void> }> {
  const admin = process.env.TEST_DATABASE_URL?.trim();
  if (!admin) return { url: "pglite:memory", drop: async () => {} };
  const { Client } = await import("pg");
  const name = `vo_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const client = new Client({ connectionString: admin });
  await client.connect();
  await client.query(`CREATE DATABASE ${name}`);
  await client.end();
  const url = new URL(admin);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      const c = new Client({ connectionString: admin });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}
