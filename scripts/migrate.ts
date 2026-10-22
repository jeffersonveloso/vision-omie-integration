/**
 * Aplica as migrações de /drizzle no banco configurado (DATABASE_URL ou PGlite em PGLITE_DATA_DIR).
 * A aplicação já faz isso ao iniciar; o script serve para pipelines de implantação.
 *   npm run db:migrate
 */
import { createDatabase } from "../src/server/infrastructure/database/client";

async function main() {
  const handle = await createDatabase({ url: process.env.DATABASE_URL?.trim() || undefined, pgliteDir: process.env.PGLITE_DATA_DIR ?? "./.data/pglite" });
  console.log(`Migrações aplicadas (${handle.driver}).`);
  await handle.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
