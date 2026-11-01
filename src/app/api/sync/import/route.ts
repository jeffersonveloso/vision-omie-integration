import { z } from "zod";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";

const MAX_CODES = 100;
const MAX_PERIOD_DAYS = 92;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato aaaa-mm-dd.");

const schema = z
  .object({
    /** Códigos separados por vírgula, espaço ou linha ("14062, 14100") ou lista de números. */
    codes: z.union([z.string(), z.array(z.number().int().positive())]).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    process: z.boolean().default(false),
    includeIneligible: z.boolean().default(false),
  })
  .transform((v, ctx) => {
    const codes = typeof v.codes === "string" ? v.codes.split(/[\s,;]+/).filter(Boolean) : (v.codes ?? []).map(String);
    if (codes.some((c) => !/^\d+$/.test(c))) {
      ctx.addIssue({ code: "custom", path: ["codes"], message: "Informe só números, separados por vírgula ou espaço." });
      return z.NEVER;
    }
    const numbers = [...new Set(codes.map(Number))];
    if (numbers.length > MAX_CODES) {
      ctx.addIssue({ code: "custom", path: ["codes"], message: `No máximo ${MAX_CODES} pedidos por vez.` });
      return z.NEVER;
    }
    if (!numbers.length) {
      if (!v.from || !v.to) {
        ctx.addIssue({ code: "custom", path: [v.from ? "to" : "from"], message: "Informe os códigos dos pedidos ou o período (de e até)." });
        return z.NEVER;
      }
      const days = (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000;
      if (days < 0) {
        ctx.addIssue({ code: "custom", path: ["to"], message: "A data final é anterior à inicial." });
        return z.NEVER;
      }
      if (days > MAX_PERIOD_DAYS) {
        ctx.addIssue({ code: "custom", path: ["to"], message: `Período de no máximo ${MAX_PERIOD_DAYS} dias.` });
        return z.NEVER;
      }
    }
    return { ...v, codes: numbers };
  });

/**
 * Traz pedidos do Vision fora da coleta automática: pelo código (homologação, pedido que ficou de fora)
 * ou por um período de atualização. Opcionalmente já envia ao Omie. Não muda até onde a coleta chegou.
 */
export const POST = handler(async (request, c, _ctx, meta) => {
  const body = await readJson(request, schema);
  const outcome = await c.useCases.importOrders.execute(body, meta.actor);
  const what = body.codes.length ? `pedido(s) ${body.codes.join(", ")}` : `período de ${body.from} a ${body.to}`;
  await c.audit.record(meta, {
    action: "sync.import",
    entityType: "SYNC",
    entityId: outcome.run.id,
    summary: `Pedidos trazidos do Vision manualmente (${what})${body.process ? " e enviados ao Omie" : ""}: ${outcome.fetched} encontrado(s), ${outcome.discovered} novo(s).`,
    changes: { pedidos: body.codes.length ? body.codes : null, de: body.from ?? null, ate: body.to ?? null, enviarAgora: body.process, foraDasSituacoes: body.includeIneligible, naoEncontrados: outcome.notFound, foraDasSituacoesElegiveis: outcome.notEligible.map((n) => n.code) },
  });
  return json(outcome);
});
