import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";
import { createUserSchema, requireLocalAuth } from "@/server/infrastructure/http/user-schemas";

export const GET = handler(
  async (_req, c) => {
    requireLocalAuth(c);
    return json({ users: await c.userAdmin.list() });
  },
  { access: "admin" },
);

export const POST = handler(
  async (request, c, _ctx, meta) => {
    requireLocalAuth(c);
    const body = await readJson(request, createUserSchema);
    const result = await c.userAdmin.create(body);
    await c.audit.record(meta, {
      action: "user.create",
      entityType: "USER",
      entityId: result.user.id,
      summary: `Usuário ${result.user.name} (${result.user.email}) cadastrado como ${result.user.roleLabel.toLowerCase()}.`,
      changes: { name: result.user.name, email: result.user.email, perfil: result.user.roleLabel, senha: result.temporaryPassword ? "temporária gerada" : "definida pelo administrador" },
    });
    return json(result, { status: 201 });
  },
  { access: "admin" },
);
