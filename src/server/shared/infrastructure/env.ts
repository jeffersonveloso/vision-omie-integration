import { z } from "zod";

const boolish = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => (typeof v === "boolean" ? v : v === undefined || v === "" ? undefined : !["false", "0", "no", "off"].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.string().optional().default("development"),
  DATABASE_URL: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  PGLITE_DATA_DIR: z.string().optional().default("./.data/pglite"),
  APP_ENCRYPTION_KEY: z.string().optional(),
  APP_TIMEZONE: z.string().optional().default("America/Sao_Paulo"),
  VISION_API_URL: z.string().optional().default("http://179.108.107.158:8000/ControllerAPI"),
  VISION_USERNAME: z.string().optional().default(""),
  VISION_PASSWORD: z.string().optional().default(""),
  VISION_TIMEOUT_MS: z.coerce.number().optional().default(30_000),
  OMIE_API_URL: z.string().optional().default("https://app.omie.com.br/api/v1"),
  OMIE_TIMEOUT_MS: z.coerce.number().optional().default(60_000),
  /** Cache de consultas idênticas ao Omie (evita o bloqueio por consulta repetida em < 60 s). */
  OMIE_READ_CACHE_MS: z.coerce.number().optional().default(55_000),
  SCHEDULER_ENABLED: boolish,
  OMIE_WEBHOOK_TOKEN: z.string().optional(),
});

export type AppEnv = z.infer<typeof schema>;

let cached: AppEnv | null = null;

export function env(): AppEnv {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
