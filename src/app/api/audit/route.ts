import type { NextRequest } from "next/server";
import { z } from "zod";
import { AUDIT_ENTITY_LABELS, type AuditEntityType } from "@/server/modules/audit/domain/audit-event";
import { handler, json } from "@/server/infrastructure/http/route-handler";

const query = z.object({
  entityType: z.enum(Object.keys(AUDIT_ENTITY_LABELS) as [AuditEntityType, ...AuditEntityType[]]).optional().catch(undefined),
  entityId: z.string().max(100).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Auditoria: quem alterou contas, mapeamentos e configurações, e quem acionou ações manuais. */
export const GET = handler(async (request, c) => {
  const params = Object.fromEntries((request as NextRequest).nextUrl.searchParams);
  const filter = query.parse(params);
  const result = await c.audit.list({ ...filter, entityType: filter.entityType ?? null, entityId: filter.entityId ?? null, search: filter.search ?? null });
  return json({ ...result, page: filter.page, pageSize: filter.pageSize });
});
