import type { NextRequest } from "next/server";
import { z } from "zod";
import { DOCUMENT_TYPES, SOURCE_TYPES, TRANSFORMS } from "@/server/modules/mappings/domain/types";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";

export const GET = handler(async (request, c) => {
  const search = (request as NextRequest).nextUrl.searchParams;
  const documentType = z.enum(DOCUMENT_TYPES).parse(search.get("documentType"));
  const accountId = search.get("accountId") || null;
  return json({ rules: await c.mappingAdmin.listEffectiveRules(documentType, accountId) });
});

const ruleSchema = z.object({
  omieAccountId: z.string().uuid().nullable(),
  documentType: z.enum(DOCUMENT_TYPES),
  targetField: z.string().min(1).max(200),
  sourceType: z.enum(SOURCE_TYPES),
  sourcePath: z.string().max(300).nullish(),
  constantValue: z.string().max(500).nullish(),
  valueMapKey: z.string().max(60).nullish(),
  transforms: z.array(z.enum(TRANSFORMS)).max(6).default([]),
  defaultValue: z.string().max(500).nullish(),
  active: z.boolean().default(true),
  notes: z.string().max(500).nullish(),
});

/** Cria ou atualiza a regra de um campo (no escopo global ou de uma conta). */
export const PUT = handler(async (request, c) => {
  const body = await readJson(request, ruleSchema);
  const rule = await c.mappingAdmin.saveRule({ ...body, notes: body.notes ?? null });
  return json({ rule: rule.toSnapshot() });
});
