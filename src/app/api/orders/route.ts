import type { NextRequest } from "next/server";
import { z } from "zod";
import { ERROR_CATEGORIES } from "@/server/modules/integration/domain/integration-error";
import { ORDER_STATUSES } from "@/server/modules/integration/domain/integration-order";
import { handler, json } from "@/server/infrastructure/http/route-handler";

const querySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter((s): s is (typeof ORDER_STATUSES)[number] => (ORDER_STATUSES as readonly string[]).includes(s)) : undefined)),
  account: z.string().uuid().optional(),
  category: z.enum(ERROR_CATEGORIES).optional(),
  search: z.string().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.enum(["updated_desc", "updated_asc", "vision_code_desc", "vision_updated_desc"]).optional(),
});

export const GET = handler(async (request, c) => {
  const params = Object.fromEntries((request as NextRequest).nextUrl.searchParams.entries());
  const q = querySchema.parse(params);
  const result = await c.queries.list({ status: q.status, omieAccountId: q.account, errorCategory: q.category, search: q.search, from: q.from, to: q.to, page: q.page, pageSize: q.pageSize, sort: q.sort });
  return json({ ...result, page: q.page, pageSize: q.pageSize });
});
