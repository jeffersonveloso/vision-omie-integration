"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/form-controls";
import { EmptyState, JsonView, Mono, Panel, Skeleton } from "@/components/ui/misc";
import { api, qs } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WEBHOOK_EVENT_STATUS_LABELS, WEBHOOK_EVENT_STATUSES, type WebhookEventStatus, type WebhookEventView } from "@/server/modules/integration/domain/webhook-event";

type Row = Omit<WebhookEventView, "receivedAt" | "enqueuedAt" | "processedAt"> & { receivedAt: string; enqueuedAt: string | null; processedAt: string | null };
interface Response {
  items: Row[];
  total: number;
  counts: Partial<Record<WebhookEventStatus, number>>;
  queue: { mode: "redis" | "memory"; available: boolean; webhookEnabled: boolean; counts: { waiting: number; active: number; delayed: number; failed: number; completed: number } | null };
}

const STATUS_CLASS: Record<WebhookEventStatus, string> = {
  RECEIVED: "text-rejected",
  QUEUED: "text-sent",
  PROCESSING: "text-sent",
  DONE: "text-done",
  IGNORED: "text-muted-foreground",
  FAILED: "text-error",
};
const PAGE_SIZE = 50;

/** Webhooks do Omie: o que chegou, o que a fila já processou e o que falhou (com reprocessamento). */
export function WebhooksPanel() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["webhook-events", status, page],
    queryFn: () => api.get<Response>(`/api/webhooks/events${qs({ status, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });
  const retry = useMutation({
    mutationFn: (ids?: string[]) => api.post<{ queued: number }>("/api/webhooks/events/retry", { ids }),
    onSuccess: (r) => {
      toast.success(r.queued ? `${r.queued} webhook(s) de volta na fila` : "Nenhum webhook com falha para reprocessar");
      void queryClient.invalidateQueries({ queryKey: ["webhook-events"] });
    },
    onError: (e) => toast.error("Não foi possível reprocessar", { description: e.message }),
  });
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const failed = data?.counts.FAILED ?? 0;
  const q = data?.queue;

  return (
    <div className="grid gap-4">
      <Panel>
        <div className="grid gap-3 px-5 py-4 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="grid gap-1">
            <p>
              Fila:{" "}
              {!q ? "…" : q.mode === "redis" ? (q.available ? <span className="font-semibold">Redis (BullMQ)</span> : <span className="font-semibold text-error">Redis indisponível — os webhooks continuam gravados e entram na fila quando ele voltar</span>) : <span className="font-semibold text-rejected">em memória (desenvolvimento) — defina REDIS_URL em produção</span>}
              {q?.counts ? (
                <span className="text-muted-foreground">
                  {" "}
                  · aguardando {q.counts.waiting}, processando {q.counts.active}, nova tentativa {q.counts.delayed}
                </span>
              ) : null}
            </p>
            {q && !q.webhookEnabled ? <p className="text-muted-foreground">O webhook está desligado: defina OMIE_WEBHOOK_TOKEN e cadastre a URL no Developer Omie.</p> : null}
            <p className="text-muted-foreground">
              O Omie espera resposta em até 7 s e entrega os eventos em fila. A integração só grava o evento e responde; o processamento acontece aqui, com até 6 tentativas.
            </p>
          </div>
          <Button variant="outline" onClick={() => retry.mutate(undefined)} disabled={!failed || retry.isPending}>
            {retry.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reprocessar falhas{failed ? ` (${failed})` : ""}
          </Button>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-auto min-w-[14rem]" aria-label="Filtrar webhooks por situação">
          <option value="">Todas as situações</option>
          {WEBHOOK_EVENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {WEBHOOK_EVENT_STATUS_LABELS[s]}
              {data?.counts[s] ? ` (${data.counts[s]})` : ""}
            </option>
          ))}
        </NativeSelect>
      </div>

      <Panel>
        {isLoading ? (
          <div className="grid gap-2 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !data?.items.length ? (
          <EmptyState title="Nenhum webhook recebido" description={status ? "Nenhum evento nessa situação." : "Os eventos enviados pelo Omie aparecem aqui assim que chegam."} />
        ) : (
          <ul className="divide-y divide-border">
            {data.items.map((e) => (
              <li key={e.id} className="grid gap-x-4 gap-y-1 px-5 py-3 md:grid-cols-[11rem_minmax(0,1fr)_auto]">
                <div className="text-[13px]">
                  <time dateTime={e.receivedAt} className="block tabular-nums">{formatDateTime(e.receivedAt)}</time>
                  <span className={cn("font-semibold", STATUS_CLASS[e.status])}>{WEBHOOK_EVENT_STATUS_LABELS[e.status]}</span>
                  {e.attempts > 1 ? <span className="text-muted-foreground"> · {e.attempts} tentativas</span> : null}
                </div>
                <div className="min-w-0 text-[13px]">
                  <p className="break-words">
                    <Mono>{e.topic ?? "sem tópico"}</Mono>
                    {e.accountName ? <span className="text-muted-foreground"> · {e.accountName}</span> : null}
                    {e.relatedOrderId && e.visionOrderCode ? (
                      <>
                        {" · "}
                        <Link href={`/pedidos/${e.relatedOrderId}`} className="font-semibold text-primary underline-offset-2 hover:underline">
                          Pedido {e.visionOrderCode}
                        </Link>
                      </>
                    ) : null}
                  </p>
                  {e.lastError ? <p className="break-words text-error">{e.lastError}</p> : e.note ? <p className="break-words text-muted-foreground">{e.note}</p> : null}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-primary">Conteúdo recebido</summary>
                    <JsonView value={e.payload} className="mt-2" maxHeight="16rem" />
                    {e.messageId ? <p className="mt-1 text-[12px] text-muted-foreground">messageId <Mono>{e.messageId}</Mono></p> : null}
                  </details>
                </div>
                <div className="md:text-right">
                  {e.status === "FAILED" || e.status === "RECEIVED" ? (
                    <Button size="sm" variant="ghost" onClick={() => retry.mutate([e.id])} disabled={retry.isPending}>
                      <RotateCcw /> Reprocessar
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {data && data.total > PAGE_SIZE ? (
        <div className="flex items-center justify-end gap-2 text-[13px]">
          <span className="text-muted-foreground">Página {page} de {pages} ({data.total} eventos)</span>
          <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Página anterior"><ChevronLeft /></Button>
          <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} aria-label="Próxima página"><ChevronRight /></Button>
        </div>
      ) : null}
    </div>
  );
}
