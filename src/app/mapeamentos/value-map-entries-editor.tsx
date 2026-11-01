"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import { EmptyState, Mono, Skeleton } from "@/components/ui/misc";
import { api, ApiError, qs } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LookupEntity } from "@/server/modules/mappings/domain/types";
import type { ValueMapEntry } from "@/server/modules/mappings/domain/value-map";
import { type MapSummary, OmieLookupCombobox, useCatalog } from "./shared";

type Entry = Omit<ValueMapEntry, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };
type Draft = { id: string | null; visionValue: string; omieValue: string | null; omieLabel: string | null };
const EMPTY_DRAFT: Draft = { id: null, visionValue: "", omieValue: null, omieLabel: null };

export function ImportEntriesDialog({ map, accountId, accountName, open, onOpenChange }: { map: MapSummary; accountId: string; accountName: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const run = useMutation({
    mutationFn: () => api.post<{ imported: number; skipped: string[] }>(`/api/mappings/value-maps/${map.id}/import`, { omieAccountId: accountId, text }),
    onSuccess: (r) => {
      toast.success(`${r.imported} linha(s) importada(s)`, { description: r.skipped.length ? `Ignoradas: ${r.skipped.slice(0, 3).join("; ")}${r.skipped.length > 3 ? "…" : ""}` : undefined });
      void queryClient.invalidateQueries({ queryKey: ["entries"] });
      void queryClient.invalidateQueries({ queryKey: ["value-maps"] });
      setText("");
      onOpenChange(false);
    },
    onError: (e) => toast.error("Não foi possível importar", { description: e.message }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Importar linhas em {map.name}</DialogTitle>
          <DialogDescription>Para a conta {accountName}. Uma linha por correspondência: valor no Vision; código no Omie; descrição (opcional). Separe com ponto e vírgula, vírgula ou tab — dá para colar direto de uma planilha.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Linhas para importar" className="min-h-56 font-mono text-[13px]" placeholder={"123;4422421;Coletor 20L\n456;4422456;Kit perfurocortante"} />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={() => run.mutate()} disabled={!text.trim() || run.isPending}>{run.isPending ? <Loader2 className="animate-spin" /> : <FileUp />} Importar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Linhas de uma tabela de-para numa conta: adicionar (escolhendo da lista do Omie ou digitando o código),
 * editar, excluir, filtrar e importar. Usado na aba Tabelas de-para e dentro da janela da regra.
 * Sem <form>: dentro da janela da regra ele já está num formulário (Enter adiciona a linha).
 */
export function ValueMapEntriesEditor({ map, accountId, accountName, compact = false }: { map: MapSummary; accountId: string; accountName: string; compact?: boolean }) {
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [importOpen, setImportOpen] = useState(false);
  const [lastKey, setLastKey] = useState(`${map.id}:${accountId}`);
  if (lastKey !== `${map.id}:${accountId}`) {
    setLastKey(`${map.id}:${accountId}`);
    setDraft(EMPTY_DRAFT);
    setFilter("");
  }

  const entries = useQuery({
    queryKey: ["entries", map.id, accountId],
    queryFn: () => api.get<{ entries: Entry[] }>(`/api/mappings/value-maps/${map.id}/entries${qs({ accountId })}`),
    enabled: Boolean(accountId),
  });
  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const list = entries.data?.entries ?? [];
    return term ? list.filter((e) => `${e.visionValue} ${e.omieValue} ${e.omieLabel ?? ""}`.toLowerCase().includes(term)) : list;
  }, [entries.data, filter]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["entries"] });
    void queryClient.invalidateQueries({ queryKey: ["value-maps"] });
  };
  const save = useMutation({
    mutationFn: () => api.post(`/api/mappings/value-maps/${map.id}/entries`, { id: draft.id, omieAccountId: accountId, visionValue: draft.visionValue, omieValue: draft.omieValue ?? "", omieLabel: draft.omieLabel }),
    onSuccess: () => {
      toast.success(draft.id ? "Linha atualizada" : "Linha adicionada");
      setDraft(EMPTY_DRAFT);
      refresh();
    },
    onError: (e) => toast.error("Não foi possível salvar a linha", { description: e instanceof ApiError && Object.values(e.fieldErrors)[0] ? Object.values(e.fieldErrors)[0] : e.message }),
  });
  const removeEntry = useMutation({
    mutationFn: (entry: Entry) => api.del(`/api/mappings/value-maps/${entry.valueMapId}/entries/${entry.id}`),
    onSuccess: refresh,
    onError: (e) => toast.error("Não foi possível excluir", { description: e.message }),
  });

  const canSave = Boolean(draft.visionValue.trim() && draft.omieValue && !save.isPending);
  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    if (canSave) save.mutate();
  };
  const entityLabel = map.omieEntity === "livre" ? "Texto livre" : (catalog.data?.lookupEntities[map.omieEntity as LookupEntity] ?? map.omieEntity);
  const ids = `vm-${map.key}${compact ? "-rule" : ""}`;

  return (
    <div>
      <div className={cn("grid items-end gap-3 border-b border-border bg-background/50 md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]", compact ? "rounded-t-control px-3 py-3" : "px-5 py-4")}>
        <Field label="Valor no Vision" htmlFor={`${ids}-vision`}>
          <Input id={`${ids}-vision`} value={draft.visionValue} onChange={(e) => setDraft((d) => ({ ...d, visionValue: e.target.value }))} onKeyDown={submitOnEnter} placeholder={map.key === "produtos" ? "123" : ""} className="font-mono" />
        </Field>
        <Field
          label={map.omieEntity === "livre" ? "Valor no Omie" : `${entityLabel} no Omie (${accountName})`}
          htmlFor={`${ids}-omie`}
          hint={map.omieEntity === "livre" ? undefined : "Escolha da lista ou digite o código e use \"Usar …\"."}
        >
          {map.omieEntity === "livre" ? (
            <Input id={`${ids}-omie`} value={draft.omieValue ?? ""} onChange={(e) => setDraft((d) => ({ ...d, omieValue: e.target.value, omieLabel: null }))} onKeyDown={submitOnEnter} className="font-mono" />
          ) : (
            <OmieLookupCombobox id={`${ids}-omie`} accountId={accountId} entity={map.omieEntity as LookupEntity} value={draft.omieValue} onChange={(v, label) => setDraft((d) => ({ ...d, omieValue: v, omieLabel: label }))} />
          )}
        </Field>
        <div className="flex gap-2">
          {draft.id ? <Button type="button" variant="ghost" onClick={() => setDraft(EMPTY_DRAFT)}>Cancelar</Button> : null}
          <Button type="button" onClick={() => save.mutate()} disabled={!canSave}>
            {save.isPending ? <Loader2 className="animate-spin" /> : draft.id ? null : <Plus />}
            {draft.id ? "Salvar linha" : "Adicionar"}
          </Button>
        </div>
      </div>

      <div className={cn("flex flex-wrap items-center gap-2 pt-3", compact ? "px-3" : "px-5")}>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} placeholder="Filtrar linhas" className="h-8 pl-9" aria-label="Filtrar linhas" />
        </div>
        <span className="text-[13px] text-muted-foreground">{entries.data?.entries.length ?? 0} linha(s) para {accountName}</span>
        <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setImportOpen(true)}><FileUp /> Importar</Button>
      </div>

      {entries.isLoading ? (
        <div className={compact ? "p-3" : "p-5"}><Skeleton className="h-24" /></div>
      ) : visible.length === 0 ? (
        <EmptyState
          className={compact ? "px-3 py-6" : undefined}
          title={filter ? "Nenhuma linha com esse filtro" : "Tabela vazia para esta conta"}
          description={filter ? undefined : "Pedidos que dependem desta tabela param no mapeamento até a correspondência existir. Adicione acima ou importe de uma planilha."}
        />
      ) : (
        <div className={cn("relative overflow-x-auto px-2 pb-2", compact && "max-h-72 overflow-y-auto")}>
          <table className="w-full text-sm">
            <thead className="text-left text-[13px] text-muted-foreground">
              <tr>
                <th className="h-9 px-3 font-semibold">Vision</th>
                <th className="px-3 font-semibold">Omie</th>
                <th className="px-3"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className="px-3 py-2"><Mono>{entry.visionValue}</Mono></td>
                  <td className="px-3 py-2">
                    <span>{entry.omieLabel ?? <Mono>{entry.omieValue}</Mono>}</span>
                    {entry.omieLabel ? <Mono className="ml-2 text-[12px] text-muted-foreground">{entry.omieValue}</Mono> : null}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={`Editar ${entry.visionValue}`} onClick={() => setDraft({ id: entry.id, visionValue: entry.visionValue, omieValue: entry.omieValue, omieLabel: entry.omieLabel })}><Pencil /></Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={`Excluir ${entry.visionValue}`} onClick={() => removeEntry.mutate(entry)}><Trash2 /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ImportEntriesDialog map={map} accountId={accountId} accountName={accountName} open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
