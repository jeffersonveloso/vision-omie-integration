"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/form-controls";
import { EmptyState, Mono, Panel, Skeleton } from "@/components/ui/misc";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LookupEntity } from "@/server/modules/mappings/domain/types";
import { type MapSummary, useAccounts, useCatalog, useValueMaps } from "./shared";
import { ValueMapEntriesEditor } from "./value-map-entries-editor";

/** Criar/editar tabela de-para. Também abre de dentro da janela da regra. */
export function MapDialog({ map, open, onOpenChange, onSaved }: { map: MapSummary | null; open: boolean; onOpenChange: (v: boolean) => void; onSaved: (key: string) => void }) {
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
        {/* stopPropagation: aberta de dentro da janela da regra, o submit não pode chegar ao formulário dela. */}
        <form className="contents" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); save.mutate(); }}>
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

export function ValueMapsTab() {
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const accounts = useAccounts();
  const maps = useValueMaps();
  const [selectedKey, setSelectedKey] = useState("produtos");
  const [accountId, setAccountId] = useState("");
  const [mapDialog, setMapDialog] = useState<{ open: boolean; map: MapSummary | null }>({ open: false, map: null });

  useEffect(() => {
    if (!accountId && accounts.data?.accounts.length) setAccountId(accounts.data.accounts[0].id);
  }, [accountId, accounts.data]);

  const map = maps.data?.maps.find((m) => m.key === selectedKey) ?? maps.data?.maps[0] ?? null;
  const accountName = accounts.data?.accounts.find((a) => a.id === accountId)?.name ?? "";

  const removeMap = useMutation({
    mutationFn: (m: MapSummary) => api.del(`/api/mappings/value-maps/${m.id}`),
    onSuccess: () => {
      toast.success("Tabela excluída");
      setSelectedKey("produtos");
      void queryClient.invalidateQueries({ queryKey: ["value-maps"] });
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
            <button key={m.key} onClick={() => setSelectedKey(m.key)} className={cn("flex items-center justify-between gap-2 rounded-control px-3 py-2 text-left transition-colors", active ? "bg-surface font-semibold shadow-[inset_3px_0_0_var(--primary)]" : "hover:bg-surface/70")}>
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
              {!map.system ? (
                <>
                  <Button variant="ghost" size="icon-sm" aria-label="Editar tabela" onClick={() => setMapDialog({ open: true, map })}><Pencil /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Excluir tabela" onClick={() => removeMap.mutate(map)}><Trash2 /></Button>
                </>
              ) : null}
            </div>
          </div>
          <ValueMapEntriesEditor map={map} accountId={accountId} accountName={accountName} />
        </Panel>
      ) : null}

      <MapDialog map={mapDialog.map} open={mapDialog.open} onOpenChange={(open) => setMapDialog((s) => ({ ...s, open }))} onSaved={(key) => setSelectedKey(key)} />
    </div>
  );
}
