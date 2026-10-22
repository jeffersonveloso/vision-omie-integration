import { z } from "zod";
import { LOOKUP_ENTITIES } from "@/server/modules/mappings/domain/types";

/** Contratos de entrada da API HTTP (compartilhados entre rotas). */

export const accountSchema = z.object({
  name: z.string(),
  appKey: z.string(),
  appSecret: z.string().optional().nullable(),
  cnpj: z.string(),
  description: z.string().nullish(),
  active: z.boolean(),
});

export const valueMapSchema = z.object({
  key: z.string().min(2).max(50),
  name: z.string().min(1).max(100),
  omieEntity: z.union([z.enum(LOOKUP_ENTITIES), z.literal("livre")]),
  description: z.string().max(500).nullish(),
  visionSourceHint: z.string().max(200).nullish(),
});
