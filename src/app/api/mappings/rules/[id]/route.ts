import { DOCUMENT_TYPE_LABELS } from "@/server/modules/mappings/domain/types";
import { handler, json } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string }> };

/** Remove a regra: o campo volta ao padrão (regra global ou catálogo). */
export const DELETE = handler<Ctx>(async (_req, c, ctx, meta) => {
  const { id } = await ctx.params;
  const rule = await c.mappingAdmin.deleteRule(id);
  await c.audit.record(meta, {
    action: "field-rule.delete",
    entityType: "FIELD_RULE",
    entityId: id,
    summary: `Regra de "${rule.targetField}" (${DOCUMENT_TYPE_LABELS[rule.documentType]}${rule.omieAccountId ? ", uma conta" : ", todas as contas"}) removida; o campo volta ao padrão.`,
    changes: { sourceType: rule.sourceType, sourcePath: rule.sourcePath ?? null, constantValue: rule.constantValue ?? null, valueMapKey: rule.valueMapKey ?? null, omieAccountId: rule.omieAccountId },
  });
  return json({ ok: true });
});
