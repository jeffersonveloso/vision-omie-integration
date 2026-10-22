import { withZoneOffset } from "@/server/shared/domain/dates";

/**
 * Camada anticorrupção do JSON da ControllerAPI.
 *
 * A API responde em PascalCase (`CodigoPedido`, `Cliente.CPFCNPJ`, `Itens`, `Servicos`) e com datas sem fuso
 * (`2026-10-01T08:47:58.453`). Dentro da integração tudo é camelCase — os mesmos nomes das definições do
 * Swagger (`codigoPedido`, `cliente.cpfcnpj`, `itens`, `servicos`) — e as datas carregam o fuso da operação.
 * Os campos que o Vision acrescentar passam pela mesma regra e aparecem no mapeamento sem mudar código.
 */

/**
 * PascalCase → camelCase com a regra do Json.NET (CamelCasePropertyNamesContractResolver):
 * baixa as maiúsculas iniciais e para antes da maiúscula que inicia a próxima palavra.
 * CodigoPedido → codigoPedido · CPFCNPJ → cpfcnpj · CEP → cep · XBloquearFaturamento → xBloquearFaturamento.
 */
export function toCamelCaseKey(key: string): string {
  if (!key || key[0] === key[0].toLowerCase()) return key;
  const chars = [...key];
  for (let i = 0; i < chars.length; i++) {
    if (i === 1 && !isUpper(chars[i])) break;
    const hasNext = i + 1 < chars.length;
    if (i > 0 && hasNext && !isUpper(chars[i + 1])) break;
    chars[i] = chars[i].toLowerCase();
  }
  return chars.join("");
}

function isUpper(ch: string): boolean {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

export function normalizeVisionJson(value: unknown, timeZone: string): unknown {
  if (Array.isArray(value)) return value.map((v) => normalizeVisionJson(v, timeZone));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[toCamelCaseKey(key)] = normalizeVisionJson(inner, timeZone);
    return out;
  }
  if (typeof value === "string") return withZoneOffset(value, timeZone);
  return value;
}
