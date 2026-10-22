import type { DocumentKind, DocumentStatus } from "@/server/modules/integration/domain/omie-document";
import type { OrderStatus } from "@/server/modules/integration/domain/integration-order";
import { cn } from "@/lib/utils";

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; text: string; bg: string; dot: string; description: string }> = {
  PENDING: { label: "Na fila", text: "text-queued", bg: "bg-queued-soft", dot: "bg-queued", description: "Encontrado no Vision, aguardando envio ao Omie." },
  ERROR: { label: "Com erro", text: "text-error", bg: "bg-error-soft", dot: "bg-error", description: "Parou em alguma etapa; veja a causa e reenvie." },
  SENT: { label: "Aguardando faturamento", text: "text-sent", bg: "bg-sent-soft", dot: "bg-sent", description: "Já está no Omie; aguardando a nota fiscal." },
  REJECTED: { label: "NF rejeitada", text: "text-rejected", bg: "bg-rejected-soft", dot: "bg-rejected", description: "A nota foi rejeitada (SEFAZ/prefeitura). Corrija no Omie." },
  COMPLETED: { label: "Concluído", text: "text-done", bg: "bg-done-soft", dot: "bg-done", description: "Nota autorizada e informada ao Vision." },
  CANCELLED: { label: "Cancelado", text: "text-muted", bg: "bg-muted-soft", dot: "bg-muted", description: "Documento cancelado no Omie e informado ao Vision." },
  IGNORED: { label: "Ignorado", text: "text-muted", bg: "bg-muted-soft", dot: "bg-muted", description: "Fora da integração por decisão do usuário." },
};

export const STATUS_ORDER: OrderStatus[] = ["ERROR", "PENDING", "SENT", "REJECTED", "COMPLETED", "CANCELLED", "IGNORED"];

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const meta = ORDER_STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap", meta.bg, meta.text, className)}>
      <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}

const DOC_STATUS: Record<DocumentStatus, { label: string; cls: string }> = {
  PENDING: { label: "não enviado", cls: "text-queued" },
  SENT: { label: "no Omie", cls: "text-sent" },
  AUTHORIZED: { label: "autorizada", cls: "text-done" },
  REJECTED: { label: "rejeitada", cls: "text-rejected" },
  CANCELLED: { label: "cancelada", cls: "text-muted" },
};

export const DOC_SHORT: Record<DocumentKind, string> = { SALES_ORDER: "PV", SERVICE_ORDER: "OS" };

export function DocumentChip({ kind, status, number, invoice }: { kind: DocumentKind; status: DocumentStatus; number: string | null; invoice: string | null }) {
  const meta = DOC_STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface px-1.5 py-0.5 text-[12px] whitespace-nowrap" title={`${kind === "SALES_ORDER" ? "Pedido de venda" : "Ordem de serviço"} — ${meta.label}`}>
      <span className="font-bold">{DOC_SHORT[kind]}</span>
      {number ? <span className="font-mono text-muted-foreground">{number}</span> : null}
      {invoice ? <span className={cn("font-semibold", meta.cls)}>NF {invoice}</span> : <span className={meta.cls}>{meta.label}</span>}
    </span>
  );
}
