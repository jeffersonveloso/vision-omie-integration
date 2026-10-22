"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { api } from "@/lib/api";
import type { DocumentType, LookupEntity, LookupOption, RuleSpec, SourceType, Transform } from "@/server/modules/mappings/domain/types";
import type { ValueMapProps } from "@/server/modules/mappings/domain/value-map";
import type { PublicOmieAccount } from "@/server/modules/omie-accounts/domain/omie-account";

export interface VisionField {
  path: string;
  scope: "header" | "item" | "service";
  type: string;
  description: string;
  example: unknown;
  discovered: boolean;
}

export interface CatalogResponse {
  documentTypes: Record<DocumentType, string>;
  sourceTypes: Record<SourceType, string>;
  transforms: Record<Transform, string>;
  lookupEntities: Record<LookupEntity, string>;
  visionFields: VisionField[];
}

export type MapSummary = Omit<ValueMapProps, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string; entriesByAccount: Record<string, number> };

export function useCatalog() {
  return useQuery({ queryKey: ["mapping-catalog"], queryFn: () => api.get<CatalogResponse>("/api/mappings/catalog"), staleTime: 60_000 });
}

export function useAccounts() {
  return useQuery({ queryKey: ["omie-accounts"], queryFn: () => api.get<{ accounts: PublicOmieAccount[] }>("/api/omie-accounts") });
}

const MAP_PRIORITY = ["produtos", "servicos"];

export function useValueMaps() {
  return useQuery({
    queryKey: ["value-maps"],
    queryFn: () => api.get<{ maps: MapSummary[] }>("/api/mappings/value-maps"),
    select: (data) => ({
      maps: [...data.maps].sort((a, b) => {
        const pa = MAP_PRIORITY.indexOf(a.key);
        const pb = MAP_PRIORITY.indexOf(b.key);
        if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
        return a.name.localeCompare(b.name, "pt-BR");
      }),
    }),
  });
}

/** Combo que carrega os registros de um cadastro do Omie da conta (categorias, produtos, departamentos...). */
export function OmieLookupCombobox({ accountId, entity, value, onChange, placeholder, id }: { accountId: string; entity: LookupEntity; value: string | null; onChange: (value: string, label: string | null) => void; placeholder?: string; id?: string }) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const query = useQuery({
    queryKey: ["lookup", accountId, entity],
    queryFn: () => api.get<{ options: LookupOption[] }>(`/api/omie-accounts/${accountId}/lookups/${entity}`),
    staleTime: 5 * 60_000,
  });
  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await api.get<{ options: LookupOption[] }>(`/api/omie-accounts/${accountId}/lookups/${entity}?refresh=1`);
      queryClient.setQueryData(["lookup", accountId, entity], fresh);
    } finally {
      setRefreshing(false);
    }
  };
  const options: ComboOption[] = (query.data?.options ?? []).map((o) => ({ value: o.value, label: o.label, description: o.description, inactive: o.inactive }));
  return (
    <Combobox
      id={id}
      value={value}
      onChange={(v, option) => onChange(v, option?.label ?? null)}
      options={options}
      loading={query.isLoading || refreshing}
      error={query.error ? `Não foi possível carregar do Omie: ${query.error.message}` : null}
      onRefresh={refresh}
      allowCustom
      placeholder={placeholder ?? "Selecione um registro do Omie"}
      searchPlaceholder="Buscar por código ou descrição"
      emptyText="Nenhum registro encontrado nesta base."
    />
  );
}

const SCOPE_GROUP: Record<VisionField["scope"], string> = { header: "Pedido e cliente", item: "Itens (produtos)", service: "Serviços" };

/** Combo de campos do Vision: Swagger + campos descobertos nos pedidos recebidos; aceita caminho/template livre. */
export function VisionFieldCombobox({ fields, scope, value, onChange, id }: { fields: VisionField[]; scope: "header" | "item" | "service"; value: string | null; onChange: (v: string) => void; id?: string }) {
  const options: ComboOption[] = fields
    .filter((f) => f.scope === scope || (scope !== "header" && f.scope === "header"))
    .map((f) => {
      const path = scope !== "header" && f.scope === "header" ? `$pedido.${f.path}` : f.path;
      const example = f.example === null || f.example === undefined || f.example === "" ? "" : ` (ex.: ${String(f.example).slice(0, 40)})`;
      const onlyDiscovered = f.description.startsWith("Encontrado");
      return { value: path, label: path, description: `${f.description}${example}`, group: onlyDiscovered ? "Encontrados nos pedidos" : SCOPE_GROUP[f.scope] };
    });
  return <Combobox id={id} value={value} onChange={(v) => onChange(v)} options={options} allowCustom mono placeholder="Escolha um campo do pedido" searchPlaceholder="Buscar campo, ou digite um caminho/template" />;
}

export function describeSpec(spec: RuleSpec | null, maps: MapSummary[], transforms: Record<Transform, string> | undefined): string {
  if (!spec) return "Sem regra";
  const t = spec.transforms?.length ? `, ${spec.transforms.map((x) => transforms?.[x] ?? x).join(", ")}` : "";
  const fallback = spec.defaultValue ? `; se vazio: ${spec.defaultValue}` : "";
  switch (spec.sourceType) {
    case "VISION_FIELD":
      return `Vision: ${spec.sourcePath}${t}${fallback}`;
    case "CONSTANT":
      return `Valor fixo ${spec.constantValue}${t}`;
    case "VALUE_MAP": {
      const name = maps.find((m) => m.key === spec.valueMapKey)?.name ?? spec.valueMapKey;
      return `De-para ${name} pelo campo ${spec.sourcePath}${fallback}`;
    }
    default:
      return "Não enviado";
  }
}
