import { IntegrationError } from "@/server/modules/integration/domain/integration-error";

export interface OmieFault {
  httpStatus: number;
  faultString: string | null;
  faultCode: string | null;
}

/** Extrai a falha do corpo de resposta do Omie (`faultstring`/`faultcode` ou `omie_fail`). */
export function readFault(httpStatus: number, body: unknown): OmieFault | null {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (b.faultstring || b.faultcode) return { httpStatus, faultString: String(b.faultstring ?? ""), faultCode: b.faultcode ? String(b.faultcode) : null };
    if (b.omie_fail && typeof b.omie_fail === "object") {
      const f = b.omie_fail as Record<string, unknown>;
      return { httpStatus, faultString: String(f.description ?? ""), faultCode: f.code ? String(f.code) : null };
    }
    if (httpStatus >= 400) {
      const message = b.message ?? b.mensagem ?? b.error;
      return { httpStatus, faultString: message ? String(message) : null, faultCode: b.status ? String(b.status) : null };
    }
  }
  if (httpStatus >= 400) return { httpStatus, faultString: typeof body === "string" ? body.slice(0, 500) : null, faultCode: null };
  return null;
}

export type OmieFaultKind = "DUPLICATE" | "NOT_FOUND" | "EMPTY_LIST" | "VALIDATION" | "RATE_LIMIT" | "REDUNDANT" | "BLOCKED" | "AUTH" | "UNAVAILABLE" | "BUSINESS";

export function classifyFault(fault: OmieFault): OmieFaultKind {
  const text = `${fault.faultString ?? ""} ${fault.faultCode ?? ""}`.toLowerCase();
  if (/não existem registros|nao existem registros|no records/.test(text)) return "EMPTY_LIST";
  if (/já cadastrad[oa] para o código de integração|ja cadastrad[oa] para o codigo de integracao|already exists/.test(text)) return "DUPLICATE";
  if (fault.httpStatus === 425 || /bloquead|consumo indevido|misuse/.test(text)) return "BLOCKED";
  if (/redundan|já foi realizada|ja foi realizada|aguarde \d+ segundos/.test(text)) return "REDUNDANT";
  if (fault.httpStatus === 429 || /too many requests|limite de requisi/.test(text)) return "RATE_LIMIT";
  if (fault.httpStatus === 401 || fault.httpStatus === 403 || /app_key|app_secret|chave de acesso|application key|token de acesso|não autorizad|nao autorizad|aplicativo .*(inativ|cancelad|suspens)|mensalidade|assinatura da api/.test(text)) return "AUTH";
  if (/proto_byebye|broken pipe|service unavailable|gateway|timeout|tempo limite/.test(text) || (fault.httpStatus >= 500 && !fault.faultString)) return "UNAVAILABLE";
  if (/não cadastrad|nao cadastrad|não encontrad|nao encontrad|not found|não existe|nao existe/.test(text)) return "NOT_FOUND";
  if (/preenchimento da tag|obrigatóri|obrigatori|inválid|invalid|número máximo de caracteres|numero maximo de caracteres|invalid json|syntaxerror/.test(text)) return "VALIDATION";
  return "BUSINESS";
}

/** Converte a falha em erro de integração com mensagem e dica claras para o usuário. */
export function toIntegrationError(fault: OmieFault, kind: OmieFaultKind, context: { service: string; method: string; accountLabel?: string }): IntegrationError {
  const where = `${context.service} › ${context.method}`;
  const message = fault.faultString?.replace(/^ERROR:\s*/i, "").trim() || `HTTP ${fault.httpStatus}`;
  const details = { httpStatus: fault.httpStatus, faultcode: fault.faultCode, faultstring: fault.faultString, metodo: where };
  switch (kind) {
    case "AUTH":
      return new IntegrationError({ category: "OMIE_AUTH", code: "AUTH", message: `O Omie recusou as credenciais (${where}): ${message}`, hint: "Confira App Key e App Secret da conta em Contas Omie, use \"Testar conexão\" e verifique se o aplicativo/assinatura da API está ativo no Omie.", retryable: false, details });
    case "BLOCKED":
      return new IntegrationError({ category: "OMIE_RATE_LIMIT", code: "BLOCKED", message: `API do Omie bloqueada temporariamente por consumo indevido (${where}).`, hint: "O Omie bloqueia por 30 minutos após 10 requisições com erro seguidas. Nova tentativa automática após o desbloqueio.", retryable: true, retryAfterMs: 31 * 60_000, details });
    case "REDUNDANT":
      return new IntegrationError({ category: "OMIE_RATE_LIMIT", code: "REDUNDANT", message: `Consulta repetida em menos de 60 segundos bloqueada pelo Omie (${where}).`, hint: "Nova tentativa automática em seguida.", retryable: true, retryAfterMs: 61_000, details });
    case "RATE_LIMIT":
      return new IntegrationError({ category: "OMIE_RATE_LIMIT", code: "TOO_MANY_REQUESTS", message: `Limite de requisições do Omie atingido (${where}).`, hint: "Limites: 240 req/min por método e 4 simultâneas. Nova tentativa automática agendada.", retryable: true, retryAfterMs: 60_000, details });
    case "UNAVAILABLE":
      return new IntegrationError({ category: "OMIE_UNAVAILABLE", code: `HTTP_${fault.httpStatus}`, message: `O Omie está instável ou indisponível (${where}): ${message}`, hint: "Falha temporária. A integração consulta pelo código de integração antes de incluir, então a nova tentativa automática não duplica documentos.", retryable: true, details });
    case "VALIDATION":
      return new IntegrationError({ category: "OMIE_BUSINESS", code: "VALIDATION", message: `O Omie rejeitou os dados (${where}): ${message}`, hint: "Ajuste o mapeamento do campo indicado na mensagem (Mapeamentos) e reenvie o pedido.", retryable: false, details });
    case "NOT_FOUND":
      return new IntegrationError({ category: "OMIE_BUSINESS", code: "NOT_FOUND", message: `Registro referenciado não existe no Omie (${where}): ${message}`, hint: "Algum código mapeado (produto, serviço, categoria, conta corrente...) não existe nesta base Omie. Revise as tabelas de-para da conta.", retryable: false, details });
    default:
      return new IntegrationError({ category: "OMIE_BUSINESS", code: kind, message: `O Omie recusou a operação (${where}): ${message}`, hint: "Leia a mensagem do Omie, corrija o cadastro/mapeamento e reenvie.", retryable: false, details });
  }
}
