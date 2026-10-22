"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/form-controls";
import { EmptyState, JsonView, Mono, Panel, Skeleton } from "@/components/ui/misc";
import { api, qs } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { AUDIT_ENTITY_LABELS, type AuditChange, type AuditEntityType, type AuditEvent } from "@/server/modules/audit/domain/audit-event";

type Row = Omit<AuditEvent, "at"> & { at: string };
const PAGE_SIZE = 50;

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

function Changes({ changes }: { changes: Row["changes"] }) {
  if (!changes) return null;
  if (Array.isArray(changes)) {
    return (
      <table className="mt-2 w-full text-[12px]">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 pr-3 font-semibold">Campo</th>
            <th className="py-1 pr-3 font-semibold">Antes</th>
            <th className="py-1 font-semibold">Depois</th>
          </tr>
        </thead>
        <tbody>
          {(changes as AuditChange[]).map((c) => (
            <tr key={c.path} className="border-t border-border align-top">
              <td className="py-1 pr-3"><Mono>{c.path}</Mono></td>
              <td className="py-1 pr-3 break-all text-muted-foreground">{show(c.before)}</td>
              <td className="py-1 break-all">{show(c.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return <JsonView value={changes} className="mt-2" maxHeight="16rem" />;
}

export default function AuditPage() {
  const [entityType, setEntityType] = useState("");
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(term);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [term]);

  const { data, isLoading } = useQuery({
    queryKey: ["audit", entityType, search, page],
    queryFn: () => api.get<{ items: Row[]; total: number }>(`/api/audit${qs({ entityType, search, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Quem alterou contas Omie, mapeamentos e configurações, e quem acionou reenvios e outras ações manuais. O autor vem do login no proxy da empresa; sem ele, aparece como não identificado."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <NativeSelect value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} className="w-auto min-w-[14rem]" aria-label="Filtrar por tipo">
          <option value="">Tudo</option>
          {(Object.keys(AUDIT_ENTITY_LABELS) as AuditEntityType[]).map((k) => (
            <option key={k} value={k}>{AUDIT_ENTITY_LABELS[k]}</option>
          ))}
        </NativeSelect>
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar por pessoa, ação, texto ou código da requisição" className="max-w-md" aria-label="Buscar na auditoria" />
      </div>
      <Panel>
        {isLoading ? (
          <div className="grid gap-2 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !data?.items.length ? (
          <EmptyState title="Nada registrado" description={search || entityType ? "Nenhum evento com esses filtros." : "As alterações e ações manuais aparecem aqui."} />
        ) : (
          <ul className="divide-y divide-border">
            {data.items.map((e) => (
              <li key={e.id} className="grid gap-x-4 gap-y-1 px-5 py-3 md:grid-cols-[11rem_minmax(0,1fr)]">
                <div className="text-[13px]">
                  <time dateTime={e.at} className="block tabular-nums">{formatDateTime(e.at)}</time>
                  <span className={e.actor ? "font-semibold" : "text-muted-foreground"}>{e.actor ?? "Não identificado"}</span>
                </div>
                <div className="min-w-0">
                  <p className="break-words">
                    <span className="mr-2 text-[12px] font-semibold text-muted-foreground">{AUDIT_ENTITY_LABELS[e.entityType] ?? e.entityType}</span>
                    {e.summary}
                  </p>
                  {e.changes || e.requestId ? (
                    <details className="group text-[13px]">
                      <summary className="cursor-pointer text-primary">Detalhes</summary>
                      <Changes changes={e.changes} />
                      <p className="mt-2 text-[12px] text-muted-foreground">
                        Ação <Mono>{e.action}</Mono>
                        {e.requestId ? <> · requisição <Mono>{e.requestId}</Mono></> : null}
                        {e.ip ? <> · IP <Mono>{e.ip}</Mono></> : null}
                      </p>
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {data && data.total > PAGE_SIZE ? (
        <div className="mt-4 flex items-center justify-end gap-2 text-[13px]">
          <span className="text-muted-foreground">Página {page} de {pages} ({data.total} eventos)</span>
          <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Página anterior"><ChevronLeft /></Button>
          <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} aria-label="Próxima página"><ChevronRight /></Button>
        </div>
      ) : null}
    </>
  );
}
