"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/form-controls";
import { EmptyState, Mono, Panel, Skeleton } from "@/components/ui/misc";
import { api, ApiError, qs } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LookupEntity } from "@/server/modules/mappings/domain/types";
import type { ValueMapEntry } from "@/server/modules/mappings/domain/value-map";
import { type MapSummary, OmieLookupCombobox, useAccounts, useCatalog, useValueMaps } from "./shared";

type Entry = Omit<ValueMapEntry, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

function MapDialog({ map, open, onOpenChange, onSaved }: { map: MapSummary | null; open: boolean; onOpenChange: (v: boolean) => void; onSaved: (key: string) => void }) {
  const catalog = useCatalog();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ key: "", name: "", omieEntity: "categorias", description: "", visionSourceHint: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm(map ? { key: map.key, name: map.name, omieEntity: map.omieEntity, description: map.description ?? "", visionSourceHint: map.visionSourceHint ?? "" } : { key: "", name: "", omieEntity: "categorias", description: "", visionSourceHint: "" });
      setErrors({});
    }
  }
  const save = useMutation({
    mutationFn: () => (map ? api.put(`/api/mappings/value-maps/${map.id}`, form) : api.post("/api/mappings/value-maps", form)),
    onSuccess: () => {
      toast.success(map ? "Tabela atualizada" : "Tabela criada", { description: map ? undefined : "Use a chave dela numa regra de campo com origem Tabela de-para." });
      void queryClient.invalidateQueries({ queryKey: ["value-maps"] });
      onSaved(form.key);
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length) setErrors(error.fieldErrors);
      else toast.error("Não foi possível salvar", { description: error.message });
    },
  });
  const set = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value, ...(key === "name" && !map && !f.key ? {} : {}) }));
    setErrors((e) => ({ ...e, [key]: "" }));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form className="contents" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <DialogHeader>
            <DialogTitle>{map ? `Editar ${map.name}` : "Nova tabela de-para"}</DialogTitle>
            <DialogDescription>Traduz um código do Vision para um registro do Omie, por conta. Ex.: tipo de operação do Vision para a categoria do Omie.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label="Nome" htmlFor="map-name" error={errors.name}>
              <Input id="map-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Categoria por tipo de operação" autoFocus />
            </Field>
            <Field label="Chave" htmlFor="map-key" error={errors.key} hint={map ? "A chave não pode ser alterada porque é usada nas regras." : "Usada nas regras de campo. Minúsculas, números e hífen."}>
              <Input id="map-key" value={form.key} disabled={Boolean(map)} onChange={(e) => set("key", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="categoria-por-operacao" className="font-mono" />
            </Field>
            <Field label="Registro do Omie" htmlFor="map-entity" error={errors.omieEntity} hint="Define qual lista do Omie aparece ao cadastrar as linhas.">
              <NativeSelect id="map-entity" value={form.omieEntity} onChange={(e) => set("omieEntity", e.target.value)}>
                {catalog.data
                  ? Object.entries(catalog.data.lookupEntities).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))
                  : null}
                <option value="livre">Texto livre (sem lista do Omie)</option>
              </NativeSelect>
            </Field>
            <Field label="Campo do Vision usado como chave" htmlFor="map-hint" hint="Apenas orientação para quem preenche a tabela.">
              <Input id="map-hint" value={form.visionSourceHint} onChange={(e) => set("visionSourceHint", e.target.value)} placeholder="codigoTipoOperacao" className="font-mono" />
            </Field>
            <Field label="Descrição" htmlFor="map-desc">
              <Textarea id="map-desc" value={form.description} onChange={(e) => set("description", e.target.value)} className="min-h-16" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : null}{map ? "Salvar alterações" : "Criar tabela"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ map, accountId, accountName, open, onOpenChange }: { map: MapSummary; accountId: string; accountName: string; open: boolean; onOpenChange: (v: boolean) => void }) {
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
          <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-56 font-mono text-[13px]" placeholder={"123;4422421;Coletor 20L\n456;4422456;Kit perfurocortante"} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => run.mutate()} disabled={!text.trim() || run.isPending}>{run.isPending ? <Loader2 className="animate-spin" /> : <FileUp />} Importar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ValueMapsTab() {
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const accounts = useAccounts();
  const maps = useValueMaps();
  const [selectedKey, setSelectedKey] = useState("produtos");
  const [accountId, setAccountId] = useState("");
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState<{ id: string | null; visionValue: string; omieValue: string | null; omieLabel: string | null }>({ id: null, visionValue: "", omieValue: null, omieLabel: null });
  const [mapDialog, setMapDialog] = useState<{ open: boolean; map: MapSummary | null }>({ open: false, map: null });
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!accountId && accounts.data?.accounts.length) setAccountId(accounts.data.accounts[0].id);
  }, [accountId, accounts.data]);

  const map = maps.data?.maps.find((m) => m.key === selectedKey) ?? maps.data?.maps[0] ?? null;
  const accountName = accounts.data?.accounts.find((a) => a.id === accountId)?.name ?? "";
  const entries = useQuery({
    queryKey: ["entries", map?.id, accountId],
    queryFn: () => api.get<{ entries: Entry[] }>(`/api/mappings/value-maps/${map!.id}/entries${qs({ accountId })}`),
    enabled: Boolean(map && accountId),
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
    mutationFn: () => api.post(`/api/mappings/value-maps/${map!.id}/entries`, { id: draft.id, omieAccountId: accountId, visionValue: draft.visionValue, omieValue: draft.omieValue ?? "", omieLabel: draft.omieLabel }),
    onSuccess: () => {
      toast.success(draft.id ? "Linha atualizada" : "Linha adicionada");
      setDraft({ id: null, visionValue: "", omieValue: null, omieLabel: null });
      refresh();
    },
    onError: (e) => toast.error("Não foi possível salvar a linha", { description: e instanceof ApiError && Object.values(e.fieldErrors)[0] ? Object.values(e.fieldErrors)[0] : e.message }),
  });
  const removeEntry = useMutation({
    mutationFn: (entry: Entry) => api.del(`/api/mappings/value-maps/${entry.valueMapId}/entries/${entry.id}`),
    onSuccess: refresh,
    onError: (e) => toast.error("Não foi possível excluir", { description: e.message }),
  });
  const removeMap = useMutation({
    mutationFn: (m: MapSummary) => api.del(`/api/mappings/value-maps/${m.id}`),
    onSuccess: () => {
      toast.success("Tabela excluída");
      setSelectedKey("produtos");
      refresh();
    },
    onError: (e) => toast.error("Não foi possível excluir", { description: e.message }),
  });

  if (maps.isLoading || accounts.isLoading) return <Skeleton className="h-96" />;
  if (!accounts.data?.accounts.length) {
    return <Panel><EmptyState title="Cadastre uma conta Omie primeiro" description="As tabelas de-para são preenchidas por conta, porque cada base Omie tem seus próprios códigos." /></Panel>;
  }

  const entityLabel = map ? (map.omieEntity === "livre" ? "Texto livre" : (catalog.data?.lookupEntities[map.omieEntity as LookupEntity] ?? map.omieEntity)) : "";

  return (
    <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <nav aria-label="Tabelas de-para" className="grid content-start gap-1">
        {maps.data?.maps.map((m) => {
          const count = m.entriesByAccount[accountId] ?? 0;
          const active = map?.key === m.key;
          return (
            <button key={m.key} onClick={() => { setSelectedKey(m.key); setDraft({ id: null, visionValue: "", omieValue: null, omieLabel: null }); }} className={cn("flex items-center justify-between gap-2 rounded-control px-3 py-2 text-left transition-colors", active ? "bg-surface font-semibold shadow-[inset_3px_0_0_var(--primary)]" : "hover:bg-surface/70")}>
              <span className="min-w-0">
                <span className="block truncate">{m.name}</span>
                <span className="block truncate text-[12px] font-normal text-muted-foreground">{m.omieEntity === "livre" ? "Texto livre" : catalog.data?.lookupEntities[m.omieEntity as LookupEntity]}</span>
              </span>
              <span className={cn("shrink-0 rounded-full px-1.5 text-[12px] tabular-nums", count ? "bg-done-soft text-done" : "bg-surface-sunken text-muted-foreground")}>{count}</span>
            </button>
          );
        })}
        <Button variant="ghost" className="mt-1 justify-start" onClick={() => setMapDialog({ open: true, map: null })}>
          <Plus /> Nova tabela
        </Button>
      </nav>

      {map ? (
        <Panel className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-[17px] font-bold">{map.name}</h2>
              <p className="mt-0.5 max-w-[70ch] text-[13px] text-muted-foreground">{map.description}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Chave <Mono className="text-foreground">{map.key}</Mono>{map.visionSourceHint ? <>, chave no Vision <Mono className="text-foreground">{map.visionSourceHint}</Mono></> : null}, registros do Omie: {entityLabel}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-auto min-w-[13rem]" aria-label="Conta Omie">
                {accounts.data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </NativeSelect>
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><FileUp /> Importar</Button>
              {!map.system ? (
                <>
                  <Button variant="ghost" size="icon-sm" aria-label="Editar tabela" onClick={() => setMapDialog({ open: true, map })}><Pencil /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Excluir tabela" onClick={() => removeMap.mutate(map)}><Trash2 /></Button>
                </>
              ) : null}
            </div>
          </div>

          <form
            className="grid items-end gap-3 border-b border-border bg-background/50 px-5 py-4 md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]"
            onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
          >
            <Field label="Valor no Vision" htmlFor="vision-value">
              <Input id="vision-value" value={draft.visionValue} onChange={(e) => setDraft((d) => ({ ...d, visionValue: e.target.value }))} placeholder={map.key === "produtos" ? "123" : ""} className="font-mono" />
            </Field>
            <Field label={map.omieEntity === "livre" ? "Valor no Omie" : `${entityLabel} no Omie (${accountName})`} htmlFor="omie-value">
              {map.omieEntity === "livre" ? (
                <Input id="omie-value" value={draft.omieValue ?? ""} onChange={(e) => setDraft((d) => ({ ...d, omieValue: e.target.value, omieLabel: null }))} className="font-mono" />
              ) : (
                <OmieLookupCombobox id="omie-value" accountId={accountId} entity={map.omieEntity as LookupEntity} value={draft.omieValue} onChange={(v, label) => setDraft((d) => ({ ...d, omieValue: v, omieLabel: label }))} />
              )}
            </Field>
            <div className="flex gap-2">
              {draft.id ? <Button type="button" variant="ghost" onClick={() => setDraft({ id: null, visionValue: "", omieValue: null, omieLabel: null })}>Cancelar</Button> : null}
              <Button type="submit" disabled={!draft.visionValue.trim() || !draft.omieValue || save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" /> : draft.id ? null : <Plus />}
                {draft.id ? "Salvar linha" : "Adicionar"}
              </Button>
            </div>
          </form>

          <div className="flex items-center gap-2 px-5 pt-3">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar linhas" className="h-8 pl-9" aria-label="Filtrar linhas" />
            </div>
            <span className="text-[13px] text-muted-foreground">{entries.data?.entries.length ?? 0} linha(s) para {accountName}</span>
          </div>

          {entries.isLoading ? (
            <div className="p-5"><Skeleton className="h-24" /></div>
          ) : visible.length === 0 ? (
            <EmptyState title={filter ? "Nenhuma linha com esse filtro" : "Tabela vazia para esta conta"} description={filter ? undefined : "Pedidos que dependem desta tabela param no mapeamento até a correspondência existir. Adicione acima ou importe de uma planilha."} />
          ) : (
            <div className="relative overflow-x-auto px-2 pb-2">
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
                        <Button size="icon-sm" variant="ghost" aria-label={`Editar ${entry.visionValue}`} onClick={() => setDraft({ id: entry.id, visionValue: entry.visionValue, omieValue: entry.omieValue, omieLabel: entry.omieLabel })}><Pencil /></Button>
                        <Button size="icon-sm" variant="ghost" aria-label={`Excluir ${entry.visionValue}`} onClick={() => removeEntry.mutate(entry)}><Trash2 /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ImportDialog map={map} accountId={accountId} accountName={accountName} open={importOpen} onOpenChange={setImportOpen} />
        </Panel>
      ) : null}

      <MapDialog map={mapDialog.map} open={mapDialog.open} onOpenChange={(open) => setMapDialog((s) => ({ ...s, open }))} onSaved={(key) => setSelectedKey(key)} />
    </div>
  );
}
