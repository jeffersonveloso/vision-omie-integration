import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";
import { accountSchema } from "@/server/infrastructure/http/schemas";

export const GET = handler(async (_req, c) => json({ accounts: await c.omieAccounts.list() }));

export const POST = handler(async (request, c, _ctx, meta) => {
  const body = await readJson(request, accountSchema);
  const account = await c.omieAccounts.create({ ...body, appSecret: body.appSecret ?? "" });
  await c.audit.record(meta, {
    action: "omie-account.create",
    entityType: "OMIE_ACCOUNT",
    entityId: account.id,
    summary: `Conta Omie "${account.name}" (${account.cnpjFormatted}) cadastrada${account.active ? "" : " desativada"}.`,
    changes: { name: account.name, cnpj: account.cnpjFormatted, appKey: account.appKeyMasked, description: account.description, active: account.active },
  });
  return json({ account }, { status: 201 });
});
