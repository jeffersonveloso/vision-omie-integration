"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { describeRun, SyncButton } from "@/components/sync-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/form-controls";
import { EmptyState, Panel, Skeleton } from "@/components/ui/misc";
import { api, qs } from "@/lib/api";
import { formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LogView } from "@/server/modules/integration/application/queries";
import type { SyncRun } from "@/server/modules/integration/domain/repositories";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { Timeline } from "../pedidos/[id]/timeline";
import { WebhooksPanel } from "./webhooks-panel";

type Run = Omit<SyncRun, "startedAt" | "finishedAt"> & { startedAt: string; finishedAt: string | null };

const STATUS = {
  RUNNING: { label: "Em andamento", cls: "text-sent" },
  SUCCESS: { label: "Sem erros", cls: "text-done" },
  PARTIAL: { label: "Com pendências", cls: "text-rejected" },
  FAILED: { label: "Falhou", cls: "text-error" },
  SKIPPED: { label: "Ignorada", cls: "text-muted-foreground" },
} as const;

function RunLogDialog({ run, onClose }: { run: Run | null; onClose: () => void }) {
  const logs = useQuery({ queryKey: ["run-logs", run?.id], queryFn: () => api.get<{ logs: LogView[] }>(`/api/sync/runs/${run!.id}`), enabled: Boolean(run) });
  return (
    <Dialog open={Boolean(run)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{run?.job === "SYNC" ? "Coleta e envio" : "Retorno ao Vision"} de {formatDateTime(run?.startedAt)}</DialogTitle>
          <DialogDescription>{run ? describeRun(run as unknown as SyncRun) : null}</DialogDescription>
        </DialogHeader>
        <DialogBody className="p-0">
          {logs.isLoading ? <Skeleton className="m-5 h-40" /> : <Timeline logs={logs.data?.logs ?? []} title="Registros da execução" description="Inclui a consulta ao Vision e tudo o que aconteceu com cada pedido nesta execução." />}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export default function RunsPage() {
  const [job, setJob] = useState("");
  const [selected, setSelected] = useState<Run | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["runs", job], queryFn: () => api.get<{ runs: Run[] }>(`/api/sync/runs${qs({ job, limit: 100 })}`), refetchInterval: 15_000 });

  return (
    <>
      <PageHeader
        title="Execuções"
        description="Histórico das rotinas automáticas (coleta e envio, retorno fiscal e financeiro) e dos webhooks recebidos do Omie."
        actions={
          <>
            <SyncButton job="RECONCILE" variant="outline" />
            <SyncButton />
          </>
        }
      />
      <Tabs defaultValue="runs">
        <TabsList className="mb-4">
          <TabsTrigger value="runs">Rotinas</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks do Omie</TabsTrigger>
        </TabsList>
        <TabsContent value="webhooks">
          <WebhooksPanel />
        </TabsContent>
        <TabsContent value="runs">
      <div className="mb-4">
        <NativeSelect value={job} onChange={(e) => setJob(e.target.value)} className="w-auto min-w-[14rem]" aria-label="Filtrar rotina">
          <option value="">Todas as rotinas</option>
          <option value="SYNC">Coleta e envio</option>
          <option value="RECONCILE">Retorno ao Vision</option>
        </NativeSelect>
      </div>
      <Panel>
        {isLoading ? (
          <div className="grid gap-2 p-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !data?.runs.length ? (
          <EmptyState title="Nenhuma execução registrada" description="As rotinas rodam conforme o agendamento em Configurações." />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[13px] text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="h-10 px-4 font-semibold">Rotina</th>
                  <th className="px-3 font-semibold">Início</th>
                  <th className="px-3 font-semibold">Duração</th>
                  <th className="px-3 font-semibold">Resultado</th>
                  <th className="px-3 font-semibold">Situação</th>
                  <th className="px-3"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3">
                      <span className="font-semibold">{run.job === "SYNC" ? "Coleta e envio" : "Retorno ao Vision"}</span>
                      <span className="block text-[12px] text-muted-foreground">{run.trigger === "SCHEDULE" ? "Agendada" : "Manual"}{run.windowFrom ? `, período ${run.windowFrom.split("-").reverse().join("/")} a ${run.windowTo?.split("-").reverse().join("/")}` : ""}</span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{formatDateTime(run.startedAt)}</td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">{formatDuration(run.startedAt, run.finishedAt)}</td>
                    <td className="max-w-[34rem] px-3 py-3 text-[13px]">
                      {describeRun(run as unknown as SyncRun)}
                    </td>
                    <td className={cn("px-3 py-3 font-semibold whitespace-nowrap", STATUS[run.status].cls)}>{STATUS[run.status].label}</td>
                    <td className="px-3 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(run)}>Ver registros</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
        </TabsContent>
      </Tabs>
      <RunLogDialog run={selected} onClose={() => setSelected(null)} />
    </>
  );
}
