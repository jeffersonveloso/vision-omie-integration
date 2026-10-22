"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { ORDER_STATUS_META } from "@/components/status";
import { describeRun, SyncButton } from "@/components/sync-button";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, PanelHeader, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardStats } from "@/server/modules/integration/application/queries";
import { ERROR_CATEGORY_LABELS, type ErrorCategory } from "@/server/modules/integration/domain/integration-error";
import type { OrderStatus } from "@/server/modules/integration/domain/integration-order";
import type { SyncRun } from "@/server/modules/integration/domain/repositories";

interface DashboardData {
  stats: DashboardStats;
  runs: Array<SyncRun & { startedAt: string; finishedAt: string | null }>;
  accounts: Array<{ id: string; name: string; active: boolean; cnpjFormatted: string }>;
}

const FIXABLE: Partial<Record<ErrorCategory, string>> = {
  MAPPING: "Depois de cadastrar os de-para, reenvie todos de uma vez.",
  ROUTING: "Cadastre ou ative a conta Omie do CNPJ e reenvie.",
  OMIE_BUSINESS: "Corrija o cadastro indicado pelo Omie e reenvie.",
  OMIE_AUTH: "Atualize as credenciais da conta e reenvie.",
};

function FlowNode({ status, count, href, emphasis }: { status: OrderStatus; count: number; href: string; emphasis?: boolean }) {
  const meta = ORDER_STATUS_META[status];
  return (
    <Link
      href={href}
      className={cn(
        "group relative z-10 flex min-w-0 flex-col rounded-panel border bg-surface px-4 py-3 transition-colors hover:border-border-strong",
        emphasis && count > 0 ? "border-current" : "border-border",
        emphasis && count > 0 && meta.text,
      )}
    >
      <span className={cn("text-[30px] leading-none font-bold tabular-nums", count === 0 ? "text-muted-foreground" : meta.text)}>{count}</span>
      <span className="mt-1.5 text-[13px] font-semibold text-foreground">{meta.label}</span>
      <span className="text-[12px] leading-snug text-muted-foreground">{meta.description}</span>
    </Link>
  );
}

/** O trilho agregado: quantos pedidos estão em cada estação e onde estão parados. */
function FlowBoard({ totals }: { totals: DashboardStats["totals"] }) {
  return (
    <Panel className="p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-bold">Onde estão os pedidos</h2>
        <span className="text-[13px] text-muted-foreground">{totals.all} pedido(s) acompanhados pela integração</span>
      </div>
      <div className="relative grid gap-3 md:grid-cols-3 md:gap-10">
        <div aria-hidden className="absolute top-[46px] right-[16%] left-[16%] hidden h-[3px] bg-foreground md:block" />
        <FlowNode status="PENDING" count={totals.PENDING} href="/pedidos?status=PENDING" />
        <FlowNode status="SENT" count={totals.SENT} href="/pedidos?status=SENT" />
        <FlowNode status="COMPLETED" count={totals.COMPLETED} href="/pedidos?status=COMPLETED" />
      </div>
      <div className="mt-3 grid gap-3 md:mt-0 md:grid-cols-3 md:gap-10">
        <div className="relative md:pt-6">
          <span aria-hidden className="absolute top-0 left-8 hidden h-6 w-[3px] bg-error/60 md:block" />
          <FlowNode status="ERROR" count={totals.ERROR} href="/pedidos?status=ERROR" emphasis />
        </div>
        <div className="relative md:pt-6">
          <span aria-hidden className="absolute top-0 left-8 hidden h-6 w-[3px] bg-rejected/60 md:block" />
          <FlowNode status="REJECTED" count={totals.REJECTED} href="/pedidos?status=REJECTED" emphasis />
        </div>
        <div className="grid grid-cols-2 gap-3 md:pt-6">
          <Link href="/pedidos?status=CANCELLED" className="rounded-panel border border-dashed border-border-strong px-3 py-2.5 hover:bg-surface">
            <span className="text-[18px] font-bold tabular-nums">{totals.CANCELLED}</span>
            <span className="block text-[12px] text-muted-foreground">cancelados</span>
          </Link>
          <Link href="/pedidos?status=IGNORED" className="rounded-panel border border-dashed border-border-strong px-3 py-2.5 hover:bg-surface">
            <span className="text-[18px] font-bold tabular-nums">{totals.IGNORED}</span>
            <span className="block text-[12px] text-muted-foreground">ignorados</span>
          </Link>
        </div>
      </div>
    </Panel>
  );
}

function ErrorsByCause({ items, retryScheduled }: { items: DashboardStats["errorsByCategory"]; retryScheduled: number }) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: (category: ErrorCategory) => api.post<{ total: number; succeeded: number; failed: number }>("/api/orders/retry", { category }),
    onSuccess: (r) => {
      toast[r.failed ? "warning" : "success"](r.failed ? "Reenvio concluído com pendências" : "Pedidos reenviados", { description: `${r.succeeded} de ${r.total} pedido(s) avançaram.${r.failed ? ` ${r.failed} continuam com erro.` : ""}` });
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error("Não foi possível reenviar", { description: e.message }),
  });
  return (
    <Panel>
      <PanelHeader title="Erros por causa" description={retryScheduled ? `${retryScheduled} pedido(s) com nova tentativa automática agendada.` : "Agrupados pelo motivo, para corrigir de uma vez."} />
      {items.length === 0 ? (
        <EmptyState title="Nenhum pedido com erro" description="Quando um pedido parar em alguma estação, a causa aparece aqui." />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.category} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="w-10 text-[20px] font-bold text-error tabular-nums">{item.count}</span>
              <div className="min-w-0 flex-1">
                <Link href={`/pedidos?status=ERROR&category=${item.category}`} className="font-semibold hover:underline">
                  {ERROR_CATEGORY_LABELS[item.category]}
                </Link>
                {FIXABLE[item.category] ? <p className="text-[13px] text-muted-foreground">{FIXABLE[item.category]}</p> : null}
              </div>
              <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(item.category)}>
                Reenviar todos
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function WeekChart({ days }: { days: DashboardStats["last7Days"] }) {
  const max = Math.max(1, ...days.flatMap((d) => [d.discovered, d.completed, d.errors]));
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
  return (
    <Panel>
      <PanelHeader title="Últimos 7 dias" description="Pedidos recebidos do Vision, concluídos e que tiveram erro." />
      <div className="px-5 py-4">
        <div className="flex h-40 items-end gap-3">
          {days.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex h-32 w-full items-end justify-center gap-[3px]" title={`${d.day}: ${d.discovered} recebidos, ${d.completed} concluídos, ${d.errors} com erro`}>
                <span className="w-2.5 rounded-t-[2px] bg-queued/70" style={{ height: `${(d.discovered / max) * 100}%` }} />
                <span className="w-2.5 rounded-t-[2px] bg-done" style={{ height: `${(d.completed / max) * 100}%` }} />
                <span className="w-2.5 rounded-t-[2px] bg-error" style={{ height: `${(d.errors / max) * 100}%` }} />
              </div>
              <span className="text-[12px] text-muted-foreground capitalize">{weekday.format(new Date(`${d.day}T12:00:00`)).replace(".", "")}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-queued/70" />Recebidos</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-done" />Concluídos</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-error" />Com erro</span>
        </div>
      </div>
    </Panel>
  );
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<DashboardData>("/api/dashboard"), refetchInterval: 20_000 });

  return (
    <>
      <PageHeader title="Painel" description="Pedidos do Vision a caminho das bases Omie e o retorno fiscal e financeiro." actions={<SyncButton />} />
      {error ? <Panel className="mb-6 border-error/40 bg-error-soft p-4 text-error">{error.message}</Panel> : null}
      {isLoading || !data ? (
        <div className="grid gap-6">
          <Skeleton className="h-64" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
          </div>
        </div>
      ) : (
        <div className="grid gap-6">
          {data.accounts.length === 0 ? (
            <Panel className="flex flex-wrap items-center justify-between gap-3 border-sent/40 bg-sent-soft px-5 py-4">
              <div>
                <p className="font-bold">Cadastre a primeira conta Omie</p>
                <p className="text-[13px] text-muted-foreground">Sem contas, nenhum pedido pode ser roteado. Cada conta corresponde a uma base Omie e a um CNPJ.</p>
              </div>
              <Button asChild>
                <Link href="/contas-omie">Cadastrar conta</Link>
              </Button>
            </Panel>
          ) : null}
          <FlowBoard totals={data.stats.totals} />
          <div className="grid gap-6 lg:grid-cols-2">
            <ErrorsByCause items={data.stats.errorsByCategory} retryScheduled={data.stats.retryScheduled} />
            <WeekChart days={data.stats.last7Days} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Por conta Omie" actions={<Button asChild size="sm" variant="ghost"><Link href="/contas-omie">Gerenciar contas</Link></Button>} />
              {data.stats.byAccount.length === 0 ? (
                <EmptyState title="Nenhum pedido roteado ainda" />
              ) : (
                <ul className="divide-y divide-border">
                  {data.stats.byAccount.map((a) => (
                    <li key={a.omieAccountId ?? "none"} className="flex items-center gap-4 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{a.name ?? "Sem conta (não roteados)"}</p>
                        <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                          <span className="bg-done" style={{ width: `${(a.completed / Math.max(1, a.total)) * 100}%` }} />
                          <span className="bg-error" style={{ width: `${(a.errors / Math.max(1, a.total)) * 100}%` }} />
                        </div>
                      </div>
                      <span className="text-right text-[13px] text-muted-foreground tabular-nums">
                        <span className="font-semibold text-foreground">{a.completed}</span>/{a.total} concluídos
                        {a.errors ? <span className="block text-error">{a.errors} com erro</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel>
              <PanelHeader title="Execuções recentes" actions={<Button asChild size="sm" variant="ghost"><Link href="/execucoes">Ver todas</Link></Button>} />
              {data.runs.length === 0 ? (
                <EmptyState title="Nenhuma execução ainda" description="A coleta roda sozinha conforme o agendamento, ou use Sincronizar agora." />
              ) : (
                <ul className="divide-y divide-border">
                  {data.runs.map((run) => (
                    <li key={run.id} className="px-5 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold">{run.job === "SYNC" ? "Coleta e envio" : "Retorno ao Vision"}</span>
                        <span className={cn("text-[12px] font-semibold", run.status === "SUCCESS" ? "text-done" : run.status === "FAILED" ? "text-error" : run.status === "PARTIAL" ? "text-rejected" : "text-muted-foreground")}>
                          {{ RUNNING: "em andamento", SUCCESS: "sem erros", PARTIAL: "com pendências", FAILED: "falhou", SKIPPED: "ignorada" }[run.status]}
                        </span>
                      </div>
                      <p className="text-[13px] text-muted-foreground" title={formatDateTime(String(run.startedAt))}>
                        {formatRelative(String(run.startedAt))}: {describeRun(run)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
