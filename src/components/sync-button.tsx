"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import type { SyncRun } from "@/server/modules/integration/domain/repositories";
import { api } from "@/lib/api";
import { Button } from "./ui/button";

export function describeRun(run: SyncRun): string {
  const s = run.stats;
  if (run.status === "SKIPPED") return run.error ?? "Outra execução já está em andamento.";
  if (run.job === "RECONCILE") return `${s.checked ?? 0} pedido(s) consultado(s) no Omie, ${s.returned ?? 0} evento(s) devolvido(s) ao Vision${s.failed ? `, ${s.failed} com erro` : ""}.`;
  const parts = [`${s.fetched ?? 0} pedido(s) lidos no Vision`, `${s.discovered ?? 0} novo(s)`, `${s.succeeded ?? 0} enviado(s) ao Omie`];
  if (s.failed) parts.push(`${s.failed} com erro`);
  return `${parts.join(", ")}.${run.error ? ` ${run.error}` : ""}`;
}

export function SyncButton({ job = "SYNC", label, variant = "default" }: { job?: "SYNC" | "RECONCILE"; label?: string; variant?: "default" | "outline" }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.post<{ run: SyncRun }>("/api/sync/run", { job }),
    onSuccess: ({ run }) => {
      const message = describeRun(run);
      if (run.status === "FAILED") toast.error(job === "SYNC" ? "A sincronização falhou" : "A consulta de retorno falhou", { description: message });
      else if (run.status === "SKIPPED") toast.info("Já existe uma execução em andamento", { description: message });
      else toast.success(job === "SYNC" ? "Sincronização concluída" : "Retorno ao Vision concluído", { description: message });
      void queryClient.invalidateQueries();
    },
    onError: (error) => toast.error("Não foi possível iniciar", { description: error.message }),
  });
  return (
    <Button variant={variant} onClick={() => mutation.mutate()} disabled={mutation.isPending}>
      {mutation.isPending ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
      {mutation.isPending ? "Executando…" : (label ?? (job === "SYNC" ? "Sincronizar agora" : "Consultar retornos agora"))}
    </Button>
  );
}
