import type { NextConfig } from "next";

/**
 * Painel operacional: todos os dados são dinâmicos (pedidos, logs, status),
 * por isso Cache Components fica desligado e as rotas GET permanecem dinâmicas.
 * Veja docs/GUIA-IMPLEMENTACAO.md › "Decisões de arquitetura".
 */
const nextConfig: NextConfig = {
  // A imagem Docker (docker/Dockerfile) usa o servidor enxuto do Next: NEXT_OUTPUT=standalone no build.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Drivers de banco usam recursos nativos do Node / WASM e não devem ser empacotados.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "bullmq", "ioredis"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
