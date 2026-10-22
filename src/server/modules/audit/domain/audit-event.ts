/**
 * Registro de auditoria: quem fez o quê, quando e o que mudou.
 * Cobre cadastros (contas Omie, regras, tabelas de-para, configurações) e ações manuais
 * (reenvio, ignorar, sincronizar agora, recomeçar a coleta).
 */
export const AUDIT_ENTITY_LABELS = {
  OMIE_ACCOUNT: "Conta Omie",
  FIELD_RULE: "Regra de mapeamento",
  VALUE_MAP: "Tabela de-para",
  SETTINGS: "Configurações",
  ORDER: "Pedido",
  SYNC: "Rotinas",
  SYSTEM: "Sistema",
} as const;

export type AuditEntityType = keyof typeof AUDIT_ENTITY_LABELS;

export interface AuditChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface AuditEvent {
  id: string;
  at: Date;
  /** E-mail/usuário informado pelo proxy autenticado; null quando não identificado. */
  actor: string | null;
  ip: string | null;
  requestId: string | null;
  action: string;
  entityType: AuditEntityType;
  entityId: string | null;
  summary: string;
  changes: AuditChange[] | Record<string, unknown> | null;
}

export interface AuditContext {
  actor: string | null;
  ip: string | null;
  requestId: string | null;
}

export const SYSTEM_CONTEXT: AuditContext = { actor: "sistema", ip: null, requestId: null };

const SECRET_PATH = /(^|\.)(app_?secret|senha|password|token|webhookUrl)$/i;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Diferença campo a campo entre dois objetos (folhas). Arrays são comparados inteiros.
 * Campos secretos aparecem só como "[alterado]".
 */
export function diffValues(before: unknown, after: unknown, path = "", out: AuditChange[] = []): AuditChange[] {
  if (isObject(before) && isObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) diffValues(before[key], after[key], path ? `${path}.${key}` : key, out);
    return out;
  }
  if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return out;
  out.push(SECRET_PATH.test(path) ? { path, before: "[oculto]", after: "[alterado]" } : { path, before: before ?? null, after: after ?? null });
  return out;
}
