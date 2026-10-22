import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildVisionOrders } from "./fixtures";
import { readJsonBody, send } from "./http-utils";

export interface VisionSimulator {
  url: string;
  server: Server;
  orders: Array<Record<string, unknown>>;
  /** Tudo que a integração devolveu ao Vision (autorizações, rejeições, baixas...). */
  returns: Array<{ endpoint: string; body: Record<string, unknown>; at: string }>;
  close(): Promise<void>;
}

const BASE = "/ControllerAPI";

/** JWT com as mesmas claims do Vision (unique_name, role, nbf, exp, iat; validade de 120 min). Assinatura fictícia. */
function simulatedJwt(usuario: string): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const nonce = Math.random().toString(36).slice(2);
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ unique_name: usuario, role: "Usuario", nbf: iat, exp: iat + 7200, iat })}.sim-${nonce}`;
}

/**
 * Simulador da ControllerAPI do Vision: login com Bearer token, consulta incremental
 * paginada, pedido completo e os 5 endpoints de retorno.
 */
export async function startVisionSimulator(port = 0, credentials = { usuario: "OMIE", senha: "simulador" }): Promise<VisionSimulator> {
  const orders: Array<Record<string, unknown>> = buildVisionOrders();
  const returns: VisionSimulator["returns"] = [];
  const tokens = new Set<string>();
  let baixaSeq = 70_000;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname;

    if (req.method === "POST" && path === "/api/login") {
      const body = (await readJsonBody(req)) as Record<string, string> | null;
      if (body?.usuario !== credentials.usuario || body?.senha !== credentials.senha) return send(res, 401, { Message: "Usuário ou senha inválidos." });
      // Mesmo formato da ControllerAPI real: o corpo é o JWT como string JSON ("eyJ...").
      const token = simulatedJwt(body.usuario);
      tokens.add(token);
      return send(res, 200, token);
    }

    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!auth || !tokens.has(auth)) return send(res, 401, { Message: "Authorization has been denied for this request." });

    if (req.method === "GET" && path === "/api/pedido/busca/atualizados") {
      const from = url.searchParams.get("dataInicial");
      const to = url.searchParams.get("dataFinal");
      if (!from || !to) return send(res, 400, { Message: "dataInicial e dataFinal são obrigatórios." });
      const status = url.searchParams.get("codigoStatus");
      const page = Number(url.searchParams.get("pagina") ?? 1);
      const lines = Number(url.searchParams.get("linhas") ?? 50);
      const filtered = orders
        .filter((o) => String(o.dataAtualizacao).slice(0, 10) >= from && String(o.dataAtualizacao).slice(0, 10) <= to)
        .filter((o) => !status || String(o.codigoStatus) === status)
        .sort((a, b) => String(a.dataAtualizacao).localeCompare(String(b.dataAtualizacao)) || Number(a.codigo) - Number(b.codigo));
      const pageItems = filtered.slice((page - 1) * lines, page * lines).map((o) => ({
        codigoPedido: o.codigo,
        codigoEmpresa: o.codigoEmpresa,
        codigoStatus: o.codigoStatus,
        descricaoStatus: o.descricaoStatus,
        dataAtualizacao: o.dataAtualizacao,
        cliente: { razaoSocial: (o.cliente as Record<string, unknown>)?.razaoSocial },
      }));
      return send(res, 200, pageItems);
    }

    const detail = /^\/api\/pedido\/busca\/(\d+)$/.exec(path);
    if (req.method === "GET" && detail) {
      const found = orders.find((o) => String(o.codigo) === detail[1]);
      return found ? send(res, 200, found) : send(res, 404, { Message: `Pedido ${detail[1]} não encontrado.` });
    }

    const returnEndpoints = ["/api/pedido/nota/autorizacao", "/api/pedido/nota/rejeicao", "/api/pedido/nota/cancelamento", "/api/pedido/parcela/baixa", "/api/pedido/parcela/baixa/cancelar"];
    if (req.method === "POST" && returnEndpoints.includes(path)) {
      const body = ((await readJsonBody(req)) ?? {}) as Record<string, unknown>;
      if (!body.codigoPedido) return send(res, 400, { Message: "codigoPedido é obrigatório." });
      returns.push({ endpoint: path, body, at: new Date().toISOString() });
      if (path === "/api/pedido/parcela/baixa") return send(res, 200, { sucesso: true, codigoBaixa: ++baixaSeq });
      return send(res, 200, { sucesso: true });
    }

    return send(res, 404, { Message: `Rota não simulada: ${req.method} ${path}` });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}${BASE}`,
    server,
    orders,
    returns,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
