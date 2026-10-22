import { handler, json } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string; entryId: string }> };

export const DELETE = handler<Ctx>(async (_req, c, ctx, meta) => {
  const { id, entryId } = await ctx.params;
  const entry = await c.mappingAdmin.deleteEntry(entryId);
  if (entry) {
    const map = await c.mappingAdmin.getMap(id);
    await c.audit.record(meta, {
      action: "value-map.entry.delete",
      entityType: "VALUE_MAP",
      entityId: id,
      summary: `Linha removida do de-para "${map.name}": ${entry.visionValue} → ${entry.omieValue}.`,
      changes: { visionValue: entry.visionValue, omieValue: entry.omieValue, omieAccountId: entry.omieAccountId },
    });
  }
  return json({ ok: true });
});
