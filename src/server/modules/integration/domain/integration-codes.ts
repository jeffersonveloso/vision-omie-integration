import type { DocumentKind } from "./omie-document";

/**
 * Códigos de integração determinísticos (idempotência ponta a ponta).
 * O mesmo pedido Vision sempre gera o mesmo código no Omie, então um reenvio
 * nunca duplica pedido/OS: antes de incluir, a integração consulta pelo código.
 */
export function documentIntegrationCode(prefix: string, kind: DocumentKind, visionOrderCode: number): string {
  return kind === "SALES_ORDER" ? `${prefix}-${visionOrderCode}` : `${prefix}-${visionOrderCode}-OS`;
}

export function itemIntegrationCode(visionOrderCode: number, sequence: number): string {
  return `${visionOrderCode}-${sequence}`.slice(0, 30);
}
