"use client";

import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/form-controls";
import { Mono, Panel, Skeleton } from "@/components/ui/misc";
import { api, qs } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { EffectiveRuleView } from "@/server/modules/mappings/application/mapping-admin-service";
import type { DocumentType } from "@/server/modules/mappings/domain/types";
import { RuleEditorDialog } from "./rule-editor-dialog";
import { describeSpec, useAccounts, useCatalog, useValueMaps } from "./shared";

const DOC_TABS: Array<{ type: DocumentType; label: string; hint: string }> = [
  { type: "SALES_ORDER", label: "Pedido de Venda", hint: "Gerado quando o pedido do Vision tem produtos (NF-e)." },
  { type: "SERVICE_ORDER", label: "Ordem de Serviço", hint: "Gerada quando o pedido do Vision tem serviços (NFS-e)." },
  { type: "CUSTOMER", label: "Cliente", hint: "Cadastro do cliente no Omie, enviado antes do pedido." },
];

const ORIGIN_TEXT = { DEFAULT: "Padrão do sistema", GLOBAL: "Todas as contas", ACCOUNT: "Só esta conta" } as const;

export function FieldRulesTab() {
  const [documentType, setDocumentType] = useState<DocumentType>("SALES_ORDER");
  const [accountId, setAccountId] = useState("");
  const [editing, setEditing] = useState<EffectiveRuleView | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const catalog = useCatalog();
  const accounts = useAccounts();
  const maps = useValueMaps();
  const rules = useQuery({
    queryKey: ["rules", documentType, accountId],
    queryFn: () => api.get<{ rules: EffectiveRuleView[] }>(`/api/mappings/rules${qs({ documentType, accountId })}`),
  });

  const accountName = accounts.data?.accounts.find((a) => a.id === accountId)?.name ?? "todas as contas";
  const groups = [...new Set((rules.data?.rules ?? []).map((r) => r.group))];
  const pendingRequired = (rules.data?.rules ?? []).filter((r) => r.required && !r.system && !(r.managedBy && !r.spec) && (!r.spec || r.spec.sourceType === "IGNORE"));

  const open = (rule: EffectiveRuleView | null) => {
    setEditing(rule);
    setDialogOpen(true);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-panel border border-border bg-surface p-1" role="tablist" aria-label="Documento do Omie">
          {DOC_TABS.map((tab) => (
            <button
              key={tab.type}
              role="tab"
              aria-selected={documentType === tab.type}
              onClick={() => setDocumentType(tab.type)}
              className={cn("rounded-control px-3 py-1.5 text-sm font-semibold transition-colors", documentType === tab.type ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="scope" className="text-[13px] font-semibold">
            Regras de
          </label>
          <NativeSelect id="scope" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-auto min-w-[15rem]">
            <option value="">Todas as contas (padrão)</option>
            {accounts.data?.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
          <Button variant="outline" onClick={() => open(null)}>
            <Plus /> Campo personalizado
          </Button>
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {DOC_TABS.find((t) => t.type === documentType)?.hint} Uma regra de conta substitui a regra de todas as contas, que substitui o padrão do sistema.
      </p>

      {pendingRequired.length ? (
        <Panel className="border-error/35 bg-error-soft px-4 py-3 text-[13px]">
          <span className="font-bold text-error">{pendingRequired.length} campo(s) obrigatório(s) sem regra: </span>
          {pendingRequired.map((r) => r.label).join(", ")}. Pedidos param no mapeamento até que sejam configurados.
        </Panel>
      ) : null}

      <Panel>
        {rules.isLoading || !catalog.data ? (
          <div className="grid gap-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group} className="border-b border-border last:border-b-0">
              <h3 className="bg-background/60 px-5 py-2 text-[13px] font-bold text-muted-foreground">{group}</h3>
              <ul className="divide-y divide-border">
                {(rules.data?.rules ?? [])
                  .filter((r) => r.group === group)
                  .map((rule) => {
                    const managed = Boolean(rule.managedBy) && !rule.spec;
                    const missing = rule.required && !rule.system && !managed && (!rule.spec || rule.spec.sourceType === "IGNORE");
                    return (
                      <li key={rule.key} className="grid items-center gap-x-4 gap-y-1 px-5 py-2.5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_9rem_auto]">
                        <div className="min-w-0">
                          <span className="font-semibold">{rule.label}</span>
                          {rule.required ? <span className="ml-1.5 text-[12px] text-error">obrigatório</span> : null}
                          <Mono className="block truncate text-[12px] text-muted-foreground">{rule.key}</Mono>
                        </div>
                        <p className={cn("min-w-0 text-[13px] break-words", missing ? "font-semibold text-error" : rule.system || managed ? "text-muted-foreground" : "")}>
                          {rule.system ? "Preenchido pela integração" : managed ? `Definido em ${rule.managedBy}` : missing ? "Sem regra configurada" : describeSpec(rule.spec, maps.data?.maps ?? [], catalog.data?.transforms)}
                        </p>
                        <span className={cn("text-[12px]", rule.origin === "DEFAULT" ? "text-muted-foreground" : "font-semibold text-sent")}>{rule.system ? "" : managed ? "Configurações" : ORIGIN_TEXT[rule.origin]}</span>
                        <div className="justify-self-end">
                          {rule.system ? null : (
                            <Button size="sm" variant={missing ? "default" : "ghost"} onClick={() => open(rule)}>
                              {missing ? "Configurar" : <><Pencil /> Editar</>}
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))
        )}
      </Panel>

      {catalog.data ? (
        <RuleEditorDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          documentType={documentType}
          rule={editing}
          accountId={accountId || null}
          accountName={accountName}
          catalog={catalog.data}
          maps={maps.data?.maps ?? []}
        />
      ) : null}
    </div>
  );
}
