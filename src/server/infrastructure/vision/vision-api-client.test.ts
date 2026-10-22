import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import lista from "./__fixtures__/busca-atualizados.json";
import pedido from "./__fixtures__/pedido-servico-sem-financeiro.json";
import { extractToken, tokenReuseUntil, VisionApiClient } from "./vision-api-client";

/** JWT fictício com as mesmas claims do token da ControllerAPI (unique_name, role, nbf, exp, iat). */
function jwt(iat: number, lifetimeSeconds = 7200): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ unique_name: "OMIE", role: "Usuario", nbf: iat, exp: iat + lifetimeSeconds, iat })}.assinatura`;
}

const T0 = new Date("2026-10-22T02:37:24Z").getTime();
const MIN = 60_000;

describe("token da ControllerAPI", () => {
  it("lê o JWT devolvido como string JSON", () => {
    const token = jwt(T0 / 1000);
    expect(extractToken(JSON.parse(JSON.stringify(token)))).toBe(token);
    expect(extractToken(`"${token}"`)).toBe(token);
  });

  it("reutiliza pela duração do JWT, mesmo com o relógio do Vision adiantado", () => {
    const visionClockAhead = T0 / 1000 + 3 * 3600;
    expect(tokenReuseUntil(jwt(visionClockAhead), T0)).toBe(T0 + 115 * MIN);
    expect(tokenReuseUntil(jwt(T0 / 1000, 4 * 60), T0)).toBe(T0 + 2 * MIN);
    expect(tokenReuseUntil("token-opaco", T0)).toBe(T0 + 115 * MIN);
  });
});

describe("VisionApiClient", () => {
  let logins = 0;
  let rejectNext = false;
  const seenTokens: string[] = [];

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/login")) {
      logins++;
      return new Response(JSON.stringify(jwt(Math.floor(Date.now() / 1000) + logins)), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const auth = new Headers(init?.headers).get("Authorization") ?? "";
    seenTokens.push(auth);
    if (rejectNext) {
      rejectNext = false;
      return new Response(JSON.stringify({ Message: "Authorization has been denied for this request." }), { status: 401 });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const client = () => new VisionApiClient({ baseUrl: "http://vision.local/ControllerAPI", username: "OMIE", password: "x", timeoutMs: 5000, timeZone: "America/Sao_Paulo" }, fakeFetch);
  const list = (c: VisionApiClient) => c.listUpdatedOrders({ dataInicial: "2026-10-01", dataFinal: "2026-10-21", pagina: 1, linhas: 50 });

  beforeEach(() => {
    logins = 0;
    rejectNext = false;
    seenTokens.length = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("envia o JWT como Bearer e só faz login de novo perto do vencimento", async () => {
    const c = client();
    await list(c);
    expect(seenTokens[0]).toMatch(/^Bearer eyJ/);
    vi.setSystemTime(T0 + 114 * MIN);
    await list(c);
    expect(logins).toBe(1);
    vi.setSystemTime(T0 + 116 * MIN);
    await list(c);
    expect(logins).toBe(2);
  });

  it("refaz o login uma vez quando a API responde 401", async () => {
    const c = client();
    await list(c);
    rejectNext = true;
    await list(c);
    expect(logins).toBe(2);
    expect(seenTokens[1]).not.toBe(seenTokens[2]);
  });
});

describe("VisionApiClient com as respostas reais da ControllerAPI", () => {
  const realFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/api/login")) return json(jwt(Math.floor(Date.now() / 1000)));
    if (url.includes("/api/pedido/busca/atualizados")) return json(lista);
    if (url.endsWith("/api/pedido/busca/14062")) return json(pedido);
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const client = new VisionApiClient({ baseUrl: "http://vision.local/ControllerAPI", username: "OMIE", password: "x", timeoutMs: 5000, timeZone: "America/Sao_Paulo" }, realFetch);

  it("devolve os pedidos e a paginação informada pelo Vision", async () => {
    const page = await client.listUpdatedOrders({ dataInicial: "2026-10-01", dataFinal: "2026-10-13", pagina: 1, linhas: 50 });
    expect(page).toMatchObject({ pageSize: 50, totalPages: 3, totalRecords: 146 });
    expect(page.orders.map((o) => o.code)).toEqual([14062]);
  });

  it("devolve o pedido completo normalizado", async () => {
    const order = await client.getOrder(14062);
    expect(order.codigo).toBe(14062);
    expect(order.servicos?.[0]).toMatchObject({ codigoMaterial: 3, codigoServico: 0, quantidade: 271, valorTotal: 1408.7, siglaUnidadeVenda: "KG" });
    expect(order.parcelas).toEqual([]);
  });
});
