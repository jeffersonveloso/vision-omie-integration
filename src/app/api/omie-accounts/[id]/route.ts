import { z } from "zod";
import { diffValues } from "@/server/modules/audit/domain/audit-event";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";
import { accountSchema } from "@/server/infrastructure/http/schemas";

type Ctx = { params: Promise<{ id: string }> };

/** Campos da conta que entram na auditoria (sem segredo e sem carimbos de data). */
const auditable = (a: { name: string; cnpjFormatted: string; appKey: string; description: string | null; active: boolean }) => ({
  name: a.name,
  cnpj: a.cnpjFormatted,
  appKey: a.appKey,
  description: a.description,
  active: a.active,
});

export const GET = handler<Ctx>(async (_req, c, ctx) => {
  const { id } = await ctx.params;
  return json({ account: (await c.omieAccounts.get(id)).toPublic() });
});

/** Edição completa. App Secret vazio mantém o segredo atual. */
export const PUT = handler<Ctx>(async (request, c, ctx, meta) => {
  const { id } = await ctx.params;
  const body = await readJson(request, accountSchema);
  const before = (await c.omieAccounts.get(id)).toPublic();
  const account = await c.omieAccounts.update(id, body);
  const changes = diffValues(auditable(before), auditable(account));
  if (body.appSecret) changes.push({ path: "appSecret", before: "[oculto]", after: "[alterado]" });
  await c.audit.record(meta, { action: "omie-account.update", entityType: "OMIE_ACCOUNT", entityId: id, summary: `Conta Omie "${account.name}" alterada.`, changes });
  return json({ account });
});

/** Liga/desliga a integração da conta. */
export const PATCH = handler<Ctx>(async (request, c, ctx, meta) => {
  const { id } = await ctx.params;
  const body = await readJson(request, z.object({ active: z.boolean() }));
  const account = await c.omieAccounts.setActive(id, body.active);
  await c.audit.record(meta, {
    action: body.active ? "omie-account.activate" : "omie-account.deactivate",
    entityType: "OMIE_ACCOUNT",
    entityId: id,
    summary: `Integração da conta "${account.name}" ${body.active ? "ativada" : "desativada"}.`,
  });
  return json({ account });
});

export const DELETE = handler<Ctx>(async (_req, c, ctx, meta) => {
  const { id } = await ctx.params;
  const before = (await c.omieAccounts.get(id)).toPublic();
  await c.omieAccounts.delete(id);
  await c.audit.record(meta, { action: "omie-account.delete", entityType: "OMIE_ACCOUNT", entityId: id, summary: `Conta Omie "${before.name}" (${before.cnpjFormatted}) excluída.`, changes: auditable(before) });
  return json({ ok: true });
});
