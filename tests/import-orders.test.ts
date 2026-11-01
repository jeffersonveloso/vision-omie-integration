/**
 * Trazer pedidos do Vision fora da coleta automática (pelo código ou por período), contra os simuladores.
 * A coleta automática não pode sair do lugar e pedidos fora das situações elegíveis ficam de fora.
 */
process.env.AUTH_MODE = "proxy";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startOmieSimulator, type OmieSimulator } from "../scripts/simulators/omie-simulator";
import { startVisionSimulator, type VisionSimulator } from "../scripts/simulators/vision-simulator";
import * as importRoute from "@/app/api/sync/import/route";
import * as auditRoute from "@/app/api/audit/route";
import { type AppContainer, buildContainer } from "@/server/container";
import { OmieGatewayFactoryImpl } from "@/server/infrastructure/omie/omie-gateway";
import { OmieRateLimiter } from "@/server/infrastructure/omie/omie-rate-limiter";
import { VisionApiClient } from "@/server/infrastructure/vision/vision-api-client";
import { createTestDatabase } from "./support/test-database";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const today = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("trazer pedidos do Vision", () => {
  let vision: VisionSimulator;
  let omie: OmieSimulator;
  let app: AppContainer;
  let database: Awaited<ReturnType<typeof createTestDatabase>>;

  async function post(body: unknown) {
    const request = new NextRequest("http://localhost/api/sync/import", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-email": "ana@ecolife.com.br" }, body: JSON.stringify(body) });
    const response = await (importRoute as unknown as { POST: (r: NextRequest, c: unknown) => Promise<Response> }).POST(request, { params: Promise.resolve({}) });
    return { status: response.status, body: (await response.json()) as Json };
  }

  beforeAll(async () => {
    vision = await startVisionSimulator(0);
    omie = await startOmieSimulator(0);
    app = await buildContainer({
      databaseUrl: (database = await createTestDatabase()).url,
      vision: new VisionApiClient({ baseUrl: vision.url, username: "OMIE", password: "simulador", timeoutMs: 5000, timeZone: "America/Sao_Paulo" }),
      omie: new OmieGatewayFactoryImpl({ baseUrl: omie.url, timeoutMs: 5000, maxInlineRetries: 0, readCacheTtlMs: 0 }, new OmieRateLimiter({ readConcurrency: 2, minIntervalMs: 0 })),
    });
    (globalThis as unknown as { __visionOmieContainer?: Promise<AppContainer> }).__visionOmieContainer = Promise.resolve(app);
  });

  afterAll(async () => {
    await vision?.close();
    await omie?.close();
    await app?.database.close();
    await database?.drop();
  });

  it("pelo código: traz o pedido, aponta o que não existe e não move a coleta automática", async () => {
    const r = await post({ codes: "14100, 999999 14100", process: false });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ fetched: 1, discovered: 1, notFound: [999999], processed: 0 });
    expect(r.body.orders).toEqual([expect.objectContaining({ visionOrderCode: 14100, status: "PENDING" })]);
    expect(r.body.run).toMatchObject({ status: "PARTIAL", error: "Não encontrado(s) no Vision: 999999" });
    expect((await app.collectionWindow.status()).started).toBe(false);

    const again = await post({ codes: [14100] });
    expect(again.body).toMatchObject({ discovered: 0, unchanged: 1 });

    const events: Json[] = (await (await auditRoute.GET(new NextRequest("http://localhost/api/audit?search=sync.import"), { params: Promise.resolve({}) } as never)).json()).items;
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.summary.includes("pedido(s) 14100, 999999"))).toMatchObject({ actor: "ana@ecolife.com.br", action: "sync.import", changes: { naoEncontrados: [999999] } });
  });

  it("respeita as situações elegíveis, a não ser que se peça para incluir", async () => {
    const current = await app.settings.get();
    await app.settings.update({ ...current, sync: { ...current.sync, eligibleStatusCodes: [9] } });
    const skipped = await post({ codes: "14101" });
    expect(skipped.body).toMatchObject({ fetched: 0, notEligible: [expect.objectContaining({ code: 14101, statusCode: 2 })] });
    const forced = await post({ codes: "14101", includeIneligible: true });
    expect(forced.body).toMatchObject({ fetched: 1, discovered: 1, notEligible: [] });
    await app.settings.update({ ...current, sync: { ...current.sync, eligibleStatusCodes: [] } });
  });

  it("por período: traz os atualizados no intervalo sem mexer no ponto da coleta automática", async () => {
    const from = iso(new Date(today.getTime() - 10 * 86_400_000));
    const r = await post({ from, to: iso(today) });
    expect(r.status).toBe(200);
    expect(r.body.fetched).toBeGreaterThan(2);
    expect(r.body.run).toMatchObject({ windowFrom: from, windowTo: iso(today) });
    expect((await app.collectionWindow.status()).started).toBe(false);
  });

  it("enviar agora processa só os que estão na fila ou com erro", async () => {
    // Sem contas Omie cadastradas o envio para no roteamento: prova que o pedido foi processado.
    const r = await post({ codes: "14102", process: true });
    expect(r.body).toMatchObject({ processed: 1, succeeded: 0, failed: 1 });
    expect(r.body.orders[0]).toMatchObject({ visionOrderCode: 14102, status: "ERROR", lastError: expect.any(String) });
  });

  it("valida a entrada: códigos, período obrigatório, ordem das datas e limite de dias", async () => {
    expect((await post({ codes: "14100, abc" })).body.error.fieldErrors.codes).toMatch(/só números/);
    expect((await post({})).body.error.fieldErrors.from).toMatch(/códigos dos pedidos ou o período/);
    expect((await post({ from: "2026-10-10", to: "2026-10-01" })).body.error.fieldErrors.to).toMatch(/anterior/);
    expect((await post({ from: "2026-01-01", to: "2026-10-01" })).body.error.fieldErrors.to).toMatch(/92 dias/);
    expect((await post({ from: "01/10/2026", to: "2026-10-01" })).status).toBe(422);
  });
});
