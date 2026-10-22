import { z } from "zod";
import { ValidationError } from "@/server/shared/domain/result";
import { type IntegrationSettings, mergeSettings, type SettingsRepository } from "../domain/integration-settings";

const cronField = z
  .string()
  .trim()
  .refine((v) => v.split(/\s+/).length === 5, "Use uma expressão cron de 5 campos (ex.: */5 * * * *).");

const intIn = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const settingsSchema = z.object({
  sync: z.object({
    enabled: z.boolean(),
    cron: cronField,
    initialLookbackDays: intIn(0, 365),
    overlapDays: intIn(0, 30),
    pageSize: intIn(1, 500),
    eligibleStatusCodes: z.array(z.coerce.number().int()).max(50),
    maxOrdersPerRun: intIn(1, 2000),
    concurrency: intIn(1, 4),
  }),
  retry: z.object({
    maxAutoRetries: intIn(0, 20),
    backoffMinutes: z.array(intIn(1, 24 * 60)).min(1).max(20),
  }),
  reconcile: z.object({
    enabled: z.boolean(),
    cron: cronField,
    windowDays: intIn(1, 365),
    maxOrdersPerRun: intIn(1, 5000),
    returnFinancial: z.boolean(),
    attachXml: z.boolean(),
    attachPdf: z.boolean(),
  }),
  routing: z.object({
    cnpjFieldPaths: z.array(z.string().trim().min(1)).min(1).max(10),
    companyCodeMapKey: z.string().trim().min(1),
  }),
  documents: z.object({
    sendSalesOrders: z.boolean(),
    sendServiceOrders: z.boolean(),
    integrationCodePrefix: z.string().trim().regex(/^[A-Z0-9]{1,10}$/, "Use até 10 letras maiúsculas/números."),
    sendVisionInstallments: z.boolean(),
    upsertCustomer: z.boolean(),
    lineTotalMismatch: z.enum(["BLOCK", "ADJUST_QUANTITY", "ADJUST_UNIT_PRICE"]),
  }),
  visionReturn: z.object({
    codigoIntegracao: z.coerce.number().int(),
    tipoNotaFiscalProduto: z.coerce.number().int(),
    tipoNotaFiscalServico: z.coerce.number().int(),
    tipoProduto: z.string(),
    tipoServico: z.string(),
    especieProduto: z.string(),
    especieServico: z.string(),
    modeloProduto: z.string(),
    modeloServico: z.string(),
    origemParcela: z.coerce.number().int(),
    defaultCodigoContaCorrente: z.coerce.number().int().nullable(),
    contaCorrenteMapKey: z.string().trim().min(1),
  }),
});

export interface SchedulerControl {
  reload(): Promise<void>;
  status(): { running: boolean; jobs: Array<{ name: string; cron: string | null; enabled: boolean; nextRunAt: string | null; lastRunAt: string | null; busy: boolean }> };
}

export class SettingsService {
  private scheduler: SchedulerControl | null = null;

  constructor(private readonly repository: SettingsRepository) {}

  attachScheduler(scheduler: SchedulerControl): void {
    this.scheduler = scheduler;
  }

  get(): Promise<IntegrationSettings> {
    return this.repository.get();
  }

  async update(input: unknown): Promise<IntegrationSettings> {
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] = issue.message;
      throw new ValidationError("Configurações inválidas.", fieldErrors);
    }
    if (parsed.data.retry.backoffMinutes.length === 0) throw new ValidationError("Informe ao menos um intervalo de nova tentativa.");
    const settings = mergeSettings(parsed.data);
    await this.repository.save(settings);
    await this.scheduler?.reload();
    return settings;
  }
}
