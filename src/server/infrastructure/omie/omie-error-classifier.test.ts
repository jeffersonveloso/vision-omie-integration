import { describe, expect, it } from "vitest";
import { classifyFault, readFault, toIntegrationError } from "./omie-error-classifier";

const fault = (faultString: string | null, httpStatus = 500, faultCode: string | null = "SOAP-ENV:Client-5113") => ({ httpStatus, faultString, faultCode });

describe("classificação das falhas do Omie", () => {
  it.each([
    ["ERROR: Não existem registros para a página [1]!", "EMPTY_LIST"],
    ["ERROR: Pedido já cadastrado para o Código de Integração [VIS-14100]!", "DUPLICATE"],
    ["ERROR: API bloqueada por consumo indevido.", "BLOCKED"],
    ["ERROR: Consumo redundante detectado. Aguarde 60 segundos.", "REDUNDANT"],
    ["ERROR: A chave de acesso não está preenchida ou não é válida.", "AUTH"],
    ["ERROR: Aplicativo inativo ou cancelado.", "AUTH"],
    ["Broken pipe", "UNAVAILABLE"],
    ["ERROR: Cliente não cadastrado para o Código [123]!", "NOT_FOUND"],
    ["ERROR: Preenchimento da tag [codigo_categoria] obrigatório!", "VALIDATION"],
    ["ERROR: Número máximo de caracteres excedido [razao_social]", "VALIDATION"],
    ["ERROR: Estoque insuficiente para o produto.", "BUSINESS"],
  ])("%s → %s", (text, kind) => {
    expect(classifyFault(fault(text))).toBe(kind);
  });

  it("usa o status HTTP quando o texto não diz nada", () => {
    expect(classifyFault(fault(null, 425))).toBe("BLOCKED");
    expect(classifyFault(fault(null, 429))).toBe("RATE_LIMIT");
    expect(classifyFault(fault(null, 401))).toBe("AUTH");
    expect(classifyFault(fault(null, 503))).toBe("UNAVAILABLE");
  });

  it("lê faultstring, omie_fail, mensagens genéricas e corpo em texto", () => {
    expect(readFault(500, { faultstring: "ERROR: x", faultcode: "SOAP-ENV:Client-1" })).toEqual({ httpStatus: 500, faultString: "ERROR: x", faultCode: "SOAP-ENV:Client-1" });
    expect(readFault(200, { omie_fail: { code: 5, description: "falhou" } })).toEqual({ httpStatus: 200, faultString: "falhou", faultCode: "5" });
    expect(readFault(400, { message: "Bad request", status: "400" })).toMatchObject({ faultString: "Bad request", faultCode: "400" });
    expect(readFault(502, "<html>Bad Gateway</html>")).toMatchObject({ faultString: "<html>Bad Gateway</html>" });
    expect(readFault(200, { codigo_status: "0" })).toBeNull();
  });

  it("vira erro de integração com categoria, nova tentativa e dica", () => {
    const ctx = { service: "produtos/pedido", method: "IncluirPedido" };
    expect(toIntegrationError(fault("x"), "BLOCKED", ctx)).toMatchObject({ category: "OMIE_RATE_LIMIT", retryable: true, retryAfterMs: 31 * 60_000 });
    expect(toIntegrationError(fault("x"), "AUTH", ctx)).toMatchObject({ category: "OMIE_AUTH", retryable: false });
    const validation = toIntegrationError(fault("ERROR: Preenchimento da tag [x] obrigatório!"), "VALIDATION", ctx);
    expect(validation.message).toBe("O Omie rejeitou os dados (produtos/pedido › IncluirPedido): Preenchimento da tag [x] obrigatório!");
    expect(validation.hint).toContain("Mapeamentos");
    expect(toIntegrationError(fault(null, 503), "UNAVAILABLE", ctx)).toMatchObject({ category: "OMIE_UNAVAILABLE", code: "HTTP_503", retryable: true });
  });
});
