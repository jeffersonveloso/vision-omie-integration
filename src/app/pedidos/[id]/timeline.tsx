"use client";

import { useMemo, useState } from "react";
import { Checkbox, Label } from "@/components/ui/form-controls";
import { JsonView, Panel, PanelHeader } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LogView } from "@/server/modules/integration/application/queries";
import { INTEGRATION_STEP_LABELS } from "@/server/modules/integration/domain/integration-error";

const levelClass = { INFO: "bg-foreground", WARN: "bg-rejected", ERROR: "bg-error" } as const;

/** Linha do tempo do pedido: cada etapa e cada chamada ao Vision/Omie com request e response. */
export function Timeline({ logs, title = "Linha do tempo", description }: { logs: LogView[]; title?: string; description?: string }) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [showCalls, setShowCalls] = useState(true);
  const filtered = useMemo(
    () => logs.filter((l) => (!onlyProblems || l.level !== "INFO") && (showCalls || l.data?.kind !== "external-call")),
    [logs, onlyProblems, showCalls],
  );

  return (
    <Panel className="min-w-0">
      <PanelHeader
        title={title}
        description={description ?? "Do mais recente para o mais antigo. Abra uma chamada para ver o que foi enviado e o que voltou."}
        actions={
          <div className="flex flex-wrap items-center gap-4 text-[13px]">
            <div className="flex items-center gap-2">
              <Checkbox id="only-problems" checked={onlyProblems} onCheckedChange={(v) => setOnlyProblems(Boolean(v))} />
              <Label htmlFor="only-problems" className="font-normal">Só avisos e erros</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="show-calls" checked={showCalls} onCheckedChange={(v) => setShowCalls(Boolean(v))} />
              <Label htmlFor="show-calls" className="font-normal">Chamadas às APIs</Label>
            </div>
          </div>
        }
      />
      {filtered.length === 0 ? (
        <p className="px-5 py-8 text-muted-foreground">Nenhum registro com esses filtros.</p>
      ) : (
        <ol className="relative px-5 py-4">
          <span aria-hidden className="absolute top-6 bottom-6 left-[27px] w-px bg-border" />
          {filtered.map((log) => {
            const isCall = log.data?.kind === "external-call";
            const status = log.data?.httpStatus as number | null | undefined;
            return (
              <li key={log.id} className="relative flex gap-3 pb-4 last:pb-0">
                <span className={cn("relative z-10 mt-1.5 size-[9px] shrink-0 rounded-full ring-4 ring-surface", isCall && log.level === "INFO" ? "bg-border-strong" : levelClass[log.level])} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted-foreground">
                    <time dateTime={log.createdAt}>{formatDateTime(log.createdAt)}</time>
                    {log.step ? <span>{INTEGRATION_STEP_LABELS[log.step]}</span> : null}
                    {isCall && status ? <span className={cn(status >= 400 && log.level === "ERROR" && "text-error")}>HTTP {status}</span> : null}
                    {isCall && typeof log.data?.durationMs === "number" ? <span>{log.data.durationMs as number} ms</span> : null}
                  </div>
                  {isCall || log.data ? (
                    <details className="group">
                      <summary className={cn("cursor-pointer list-none break-words", log.level === "ERROR" ? "font-semibold text-error" : log.level === "WARN" ? "font-semibold text-rejected" : isCall ? "text-foreground/80" : "font-semibold")}>
                        {log.message}
                        <span className="ml-2 text-[12px] font-normal text-primary group-open:hidden">detalhes</span>
                      </summary>
                      {isCall ? (
                        <div className="mt-2 grid gap-2">
                          <div>
                            <p className="mb-1 text-[12px] font-semibold text-muted-foreground">Enviado</p>
                            <JsonView value={log.data?.request ?? null} maxHeight="18rem" />
                          </div>
                          <div>
                            <p className="mb-1 text-[12px] font-semibold text-muted-foreground">{log.data?.error ? "Falha" : "Resposta"}</p>
                            <JsonView value={log.data?.error ?? log.data?.response ?? null} maxHeight="18rem" />
                          </div>
                        </div>
                      ) : (
                        <JsonView value={log.data} className="mt-2" maxHeight="18rem" />
                      )}
                    </details>
                  ) : (
                    <p className={cn("break-words", log.level === "ERROR" ? "font-semibold text-error" : log.level === "WARN" ? "font-semibold text-rejected" : "font-semibold")}>{log.message}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
