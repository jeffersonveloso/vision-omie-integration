"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Ban, Eye, Loader2, RotateCcw, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { TrackFull } from "@/components/integration-track";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { JsonView, Mono, Panel, PanelHeader, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { formatDateTime, formatDocument, formatMoney, formatRelative } from "@/lib/format";
import type { LogView, OrderDetail } from "@/server/modules/integration/application/queries";
import { ERROR_CATEGORY_LABELS, INTEGRATION_STEP_LABELS } from "@/server/modules/integration/domain/integration-error";
import { DocumentsPanel } from "./documents-panel";
import { MappingPreviewDialog } from "./mapping-preview-dialog";
import { Timeline } from "./timeline";

interface DetailResponse {
  order: OrderDetail;
  logs: LogView[];
}

function ErrorPanel({ order }: { order: OrderDetail }) {
  const error = order.lastErrorFull;
  if (!error) return null;
  const issues = (error.details?.issues as Array<{ message: string; hint?: string; severity: string; targetField: string }> | undefined) ?? [];
  const fixLink =
    error.category === "MAPPING" ? { href: "/mapeamentos", label: "Abrir mapeamentos" } : error.category === "ROUTING" || error.category === "OMIE_AUTH" ? { href: "/contas-omie", label: "Abrir contas Omie" } : null;
  return (
    <section className="rounded-panel border border-error/35 bg-error-soft" aria-labelledby="error-title">
      <div className="flex flex-wrap items-start gap-3 px-5 pt-4 pb-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-error" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-error">
            {ERROR_CATEGORY_LABELS[error.category]}
            {error.step ? ` — parou em ${INTEGRATION_STEP_LABELS[error.step].toLowerCase()}` : ""}
          </p>
          <h2 id="error-title" className="mt-1 text-[17px] leading-snug font-bold">
            {error.message}
          </h2>
          {error.hint ? <p className="mt-2 max-w-[80ch] text-foreground/85">{error.hint}</p> : null}
        </div>
      </div>
      {issues.length > 1 ? (
        <ul className="mx-5 mb-3 grid gap-1 rounded-control border border-error/20 bg-surface/70 p-3 text-[13px]">
          {issues.map((issue, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-error">•</span>
              <span>
                {issue.message}
                {issue.hint ? <span className="block text-muted-foreground">{issue.hint}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-error/20 px-5 py-2.5 text-[13px] text-muted-foreground">
        <span>Ocorreu {formatRelative(error.occurredAt)} ({formatDateTime(error.occurredAt)})</span>
        <span>{order.attempts} tentativa(s)</span>
        <span>{order.nextRetryAt ? `Nova tentativa automática ${formatRelative(order.nextRetryAt)}` : error.retryable ? "Tentativas automáticas esgotadas" : "Exige correção e reenvio manual"}</span>
        <span>
          Código <Mono>{error.code}</Mono>
        </span>
        {fixLink ? (
          <Link href={fixLink.href} className="font-semibold text-primary hover:underline">
            {fixLink.label}
          </Link>
        ) : null}
      </div>
      {error.details && !issues.length ? (
        <details className="border-t border-error/20 px-5 py-2.5">
          <summary className="cursor-pointer text-[13px] font-semibold">Dados técnicos do erro</summary>
          <JsonView value={error.details} className="mt-2 bg-surface" maxHeight="20rem" />
        </details>
      ) : null}
    </section>
  );
}

function Summary({ order }: { order: OrderDetail }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Pedido no Vision", <Mono key="c">{order.visionOrderCode}</Mono>],
    ["Situação no Vision", order.visionStatusDescription ?? "—"],
    ["Empresa faturadora", order.companyCnpj ? formatDocument(order.companyCnpj) : order.visionCompanyCode ? `Código ${order.visionCompanyCode}` : "—"],
    ["Conta Omie", order.omieAccountName ?? "Ainda não roteado"],
    ["Cliente", order.customerName ?? "—"],
    ["CPF/CNPJ do cliente", formatDocument(order.customerDocument)],
    ["Valor", formatMoney(order.totalAmount)],
    ["Atualizado no Vision", formatDateTime(order.visionUpdatedAt)],
    ["Recebido pela integração", formatDateTime(order.firstSeenAt)],
    ["Último processamento", formatDateTime(order.lastProcessedAt)],
    ["Última consulta no Omie", formatDateTime(order.lastCheckedAt)],
    ["Concluído em", formatDateTime(order.completedAt)],
  ];
  return (
    <Panel>
      <PanelHeader title="Resumo" />
      <dl className="grid grid-cols-[minmax(0,11rem)_1fr] gap-x-3 gap-y-2 px-5 py-4 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function captions(order: OrderDetail): Partial<Record<number, string>> {
  const docs = order.documentsFull;
  const out: Partial<Record<number, string>> = {};
  out[0] = `Pedido ${order.visionOrderCode}`;
  if (order.omieAccountName) out[1] = order.omieAccountName;
  const sent = docs.filter((d) => d.omieNumber);
  if (sent.length) out[3] = sent.map((d) => `${d.kind === "SALES_ORDER" ? "PV" : "OS"} ${d.omieNumber}`).join(" e ");
  const invoices = docs.filter((d) => d.fiscal?.invoiceNumber);
  if (invoices.length) out[4] = invoices.map((d) => `${d.kind === "SALES_ORDER" ? "NF-e" : "NFS-e"} ${d.fiscal!.invoiceNumber}`).join(" e ");
  const rejected = docs.find((d) => d.status === "REJECTED");
  if (rejected) out[4] = "Nota rejeitada";
  const returned = docs.filter((d) => d.fiscalReturn.authorization);
  if (returned.length) out[5] = `Informado ao Vision ${formatRelative(returned[0].fiscalReturn.authorization!.sentAt)}`;
  return out;
}

export function OrderDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [previewOpen, setPreviewOpen] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ["order", id], queryFn: () => api.get<DetailResponse>(`/api/orders/${id}`), refetchInterval: 15_000 });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["order", id] });
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const retry = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>(`/api/orders/${id}/retry`),
    onSuccess: (r) => {
      if (r.ok) toast.success("Pedido reenviado", { description: r.message });
      else toast.error("O pedido continua com erro", { description: r.message });
      invalidate();
    },
    onError: (e) => toast.error("Não foi possível reenviar", { description: e.message }),
  });
  const ignore = useMutation({
    mutationFn: (ignored: boolean) => api.post(`/api/orders/${id}/ignore`, { ignored }),
    onSuccess: (_r, ignored) => {
      toast.success(ignored ? "Pedido ignorado" : "Pedido voltou para a integração");
      invalidate();
    },
    onError: (e) => toast.error("Não foi possível alterar", { description: e.message }),
  });
  const acknowledge = useMutation({ mutationFn: () => api.post(`/api/orders/${id}/acknowledge`), onSuccess: invalidate });

  if (isLoading) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <Panel className="p-6">
        <p className="font-bold">Não foi possível abrir o pedido</p>
        <p className="text-muted-foreground">{error?.message}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/pedidos">Voltar para pedidos</Link>
        </Button>
      </Panel>
    );
  }

  const { order, logs } = data;
  const canRetry = order.status !== "COMPLETED" && order.status !== "CANCELLED";

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/pedidos" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Pedidos
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[26px] leading-tight font-bold">Pedido {order.visionOrderCode}</h1>
              <StatusBadge status={order.status} />
              {order.processing ? (
                <span className="inline-flex items-center gap-1.5 text-[13px] text-sent">
                  <Loader2 className="size-3.5 animate-spin" /> processando
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-muted-foreground">
              {order.customerName ?? "Cliente não identificado"}
              {order.omieAccountName ? `, enviado para ${order.omieAccountName}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye /> Simular mapeamento
            </Button>
            {order.ignored ? (
              <Button variant="outline" onClick={() => ignore.mutate(false)} disabled={ignore.isPending}>
                <Undo2 /> Voltar a integrar
              </Button>
            ) : (
              <Button variant="outline" onClick={() => ignore.mutate(true)} disabled={ignore.isPending}>
                <Ban /> Ignorar pedido
              </Button>
            )}
            {canRetry && !order.ignored ? (
              <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
                {retry.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                {order.status === "ERROR" ? "Reenviar agora" : "Processar agora"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <Panel className="px-5 py-5">
        <TrackFull status={order.status} errorStep={order.lastErrorFull?.step} captions={captions(order)} />
      </Panel>

      {order.updatedAfterSync ? (
        <Panel className="flex flex-wrap items-center gap-3 border-rejected/40 bg-rejected-soft px-5 py-3">
          <AlertTriangle className="size-5 text-rejected" />
          <p className="min-w-0 flex-1 text-[13px]">
            <span className="font-bold">O pedido foi alterado no Vision depois de enviado ao Omie.</span> A integração não altera documentos já incluídos; confira se o pedido no Omie precisa de ajuste manual.
          </p>
          <Button size="sm" variant="outline" onClick={() => acknowledge.mutate()}>
            Marcar como conferido
          </Button>
        </Panel>
      ) : null}

      <ErrorPanel order={order} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Timeline logs={logs} />
        <div className="grid content-start gap-6">
          <Summary order={order} />
          <DocumentsPanel order={order} />
          {order.visionPayload ? (
            <Panel>
              <details>
                <summary className="cursor-pointer px-5 py-3.5 text-[15px] font-bold">Pedido completo recebido do Vision</summary>
                <div className="px-5 pb-4">
                  <JsonView value={order.visionPayload} />
                </div>
              </details>
            </Panel>
          ) : null}
        </div>
      </div>

      <MappingPreviewDialog orderId={order.id} open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
  );
}
