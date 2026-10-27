/**
 * Empacota os scripts de servidor (worker da fila, migrações, cadastro de usuário) em dist/*.mjs, para a
 * imagem Docker rodar com `node` puro, sem tsx nem o código-fonte.
 *   npm run build:scripts
 * Só o PGlite (WASM) e o driver nativo opcional do pg ficam de fora: vêm do node_modules da imagem.
 */
import { build } from "esbuild";

await build({
  entryPoints: { worker: "scripts/worker.ts", migrate: "scripts/migrate.ts", "users-create": "scripts/users-create.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // `server-only` resolve para um módulo vazio fora do Next com esta condição (igual ao `npm run worker`).
  conditions: ["react-server"],
  external: ["@electric-sql/pglite", "pg-native"],
  // Pacotes CommonJS dentro de um bundle ESM ainda chamam require().
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  sourcemap: true,
  logLevel: "info",
});
