import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // `server-only` lança erro fora do bundler do Next; nos testes ele é neutro.
      "server-only": path.resolve(root, "src/server/shared/infrastructure/server-only-noop.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      // Backend (domínio, casos de uso, adaptadores) e rotas /api. As telas são cobertas pelos testes do Playwright (e2e/).
      include: ["src/server/**/*.ts", "src/app/api/**/*.ts"],
      exclude: ["**/*.test.ts", "**/__fixtures__/**", "src/server/shared/infrastructure/server-only-noop.ts"],
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
      // Piso do CI: abaixo disso o pipeline falha. Suba conforme novos testes entrarem.
      thresholds: { lines: 85, statements: 82, functions: 85, branches: 65 },
    },
  },
});
