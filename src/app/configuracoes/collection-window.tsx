"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { CollectionWindowStatus } from "@/server/modules/integration/application/collection-window";

const brDate = (iso: string) => iso.split("-").reverse().join("/");

/** Até onde a coleta incremental chegou, e o botão para recomeçar a partir dos últimos N dias. */
export function CollectionWindow({ unsavedLookback }: { unsavedLookback: boolean }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const status = useQuery({ queryKey: ["collection-window"], queryFn: () => api.get<{ collection: CollectionWindowStatus }>("/api/sync/collection") });
  const restart = useMutation({
    mutationFn: () => api.del<{ collection: CollectionWindowStatus }>("/api/sync/collection"),
    onSuccess: (data) => {
      queryClient.setQueryData(["collection-window"], data);
      setConfirm(false);
      toast.success("Coleta recomeçada", { description: `A próxima execução busca pedidos atualizados desde ${brDate(data.collection.nextFrom)}.` });
    },
    onError: (e) => toast.error("Não foi possível recomeçar a coleta", { description: e.message }),
  });
  const c = status.data?.collection;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-surface-sunken px-4 py-3 text-[13px]">
      <p className="min-w-0">
        {!c ? (
          <span className="text-muted-foreground">Carregando a janela da coleta…</span>
        ) : c.started ? (
          <>
            A coleta já leu pedidos atualizados até <strong>{c.lastUpdatedAt ? formatDateTime(c.lastUpdatedAt) : "-"}</strong>. A próxima começa em <strong>{brDate(c.nextFrom)}</strong>.
          </>
        ) : (
          <>
            A coleta ainda não começou. A primeira vai buscar pedidos atualizados desde <strong>{brDate(c.nextFrom)}</strong> (últimos {c.initialLookbackDays} dias).
          </>
        )}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirm(true)} disabled={!c?.started}>
        <RotateCcw /> Recomeçar a coleta
      </Button>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Recomeçar a coleta?</DialogTitle>
            <DialogDescription>A próxima execução volta a buscar os pedidos atualizados nos últimos {c?.initialLookbackDays ?? "N"} dias.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-2 text-[13px]">
            <p>Pedidos que já estão na integração não são duplicados nem reenviados ao Omie; os novos entram na fila.</p>
            {unsavedLookback ? <p className="font-semibold text-rejected">Você alterou os dias e ainda não salvou. Salve as configurações antes para usar o valor novo.</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => restart.mutate()} disabled={restart.isPending}>
              {restart.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Recomeçar a coleta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
