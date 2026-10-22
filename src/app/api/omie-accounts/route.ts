import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";
import { accountSchema } from "@/server/infrastructure/http/schemas";

export const GET = handler(async (_req, c) => json({ accounts: await c.omieAccounts.list() }));

export const POST = handler(async (request, c) => {
  const body = await readJson(request, accountSchema);
  const account = await c.omieAccounts.create({ ...body, appSecret: body.appSecret ?? "" });
  return json({ account }, { status: 201 });
});
