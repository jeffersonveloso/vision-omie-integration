"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, flexRender, getCoreRowModel, type RowSelectionState, useReactTable } from "@tanstack/react-table";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RotateCcw, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { TrackMini } from "@/components/integration-track";
import { DocumentChip, ORDER_STATUS_META, StatusBadge } from "@/components/status";
import { SyncButton } from "@/components/sync-button";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, NativeSelect } from "@/components/ui/form-controls";
import { EmptyState, Panel, Skeleton } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/overlays";
import { api, qs } from "@/lib/api";
import { formatDateTime, formatDocument, formatMoney, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OrderListItem } from "@/server/modules/integration/application/queries";
import { ERROR_CATEGORIES, ERROR_CATEGORY_LABELS } from "@/server/modules/integration/domain/integration-error";
import type { OrderStatus } from "@/server/modules/integration/domain/integration-order";
import type { PublicOmieAccount } from "@/server/modules/omie-accounts/domain/omie-account";

interface ListResponse {
  items: OrderListItem[];
  total: number;
  counts: Record<string, number>;
  page: number;
  pageSize: number;
}

const SEGMENTS: Array<{ key: string; label: string; statuses: OrderStatus[] | null }> = [
  { key: "", label: "Todos", statuses: null },
  { key: "ERROR", label: "Com erro", statuses: ["ERROR"] },
  { key: "PENDING", label: "Na fila", statuses: ["PENDING"] },
  { key: "SENT", label: "Aguardando faturamento", statuses: ["SENT"] },
  { key: "REJECTED", label: "NF rejeitada", statuses: ["REJECTED"] },
  { key: "COMPLETED", label: "Concluídos", statuses: ["COMPLETED"] },
  { key: "CANCELLED", label: "Cancelados", statuses: ["CANCELLED"] },
  { key: "IGNORED", label: "Ignorados", statuses: ["IGNORED"] },
];

function useOrderFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = {
    status: params.get("status") ?? "",
    search: params.get("q") ?? "",
    account: params.get("account") ?? "",
    category: params.get("category") ?? "",
    page: Number(params.get("page") ?? 1) || 1,
  };
  const update = (patch: Partial<typeof filters>) => {
    const next = { ...filters, ...patch };
    if (!("page" in patch)) next.page = 1;
    router.replace(`${pathname}${qs({ status: next.status, q: next.search, account: next.account, category: next.category, page: next.page > 1 ? next.page : undefined })}`, { scroll: false });
  };
  return { filters, update };
}

export function OrdersView() {
  const { filters, update } = useOrderFilters();
  const [searchInput, setSearchInput] = useState(filters.search);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const queryClient = useQueryClient();
  const pageSize = 25;

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== filters.search) update({ search: searchInput });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["orders", filters],
    queryFn: () =>
      api.get<ListResponse>(`/api/orders${qs({ status: filters.status, search: filters.search, account: filters.account, category: filters.category, page: filters.page, pageSize })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const accounts = useQuery({ queryKey: ["omie-accounts"], queryFn: () => api.get<{ accounts: PublicOmieAccount[] }>("/api/omie-accounts") });

  const retryOne = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; message: string }>(`/api/orders/${id}/retry`),
    onSuccess: (r) => {
      if (r.ok) toast.success("Pedido reenviado", { description: r.message });
      else toast.error("O pedido continua com erro", { description: r.message });
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error("Não foi possível reenviar", { description: e.message }),
  });
  const retryMany = useMutation({
    mutationFn: (ids: string[]) => api.post<{ total: number; succeeded: number; failed: number }>("/api/orders/retry", { ids }),
    onSuccess: (r) => {
      toast[r.failed ? "warning" : "success"](r.failed ? "Reenvio concluído com pendências" : "Pedidos reenviados", { description: `${r.succeeded} de ${r.total} avançaram.${r.failed ? ` ${r.failed} continuam com erro.` : ""}` });
      setRowSelection({});
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error("Não foi possível reenviar", { description: e.message }),
  });

  const columns = useMemo<ColumnDef<OrderListItem>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            aria-label="Selecionar todos da página"
            checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false}
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(Boolean(v))}
          />
        ),
        cell: ({ row }) => <Checkbox aria-label={`Selecionar pedido ${row.original.visionOrderCode}`} checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(Boolean(v))} />,
      },
      {
        id: "order",
        header: "Pedido",
        cell: ({ row }) => {
          const o = row.original;
          return (
            <Link href={`/pedidos/${o.id}`} className="group block">
              <span className="font-bold group-hover:underline">{o.visionOrderCode}</span>
              <span className="block text-[12px] text-muted-foreground">{o.visionStatusDescription ?? "—"}</span>
            </Link>
          );
        },
      },
      {
        id: "customer",
        header: "Cliente",
        cell: ({ row }) => (
          <div className="max-w-[14rem] min-w-[9rem]">
            <span className="block truncate">{row.original.customerName ?? "—"}</span>
            <span className="block text-[12px] text-muted-foreground">{formatDocument(row.original.customerDocument)}</span>
          </div>
        ),
      },
      {
        id: "account",
        header: "Conta Omie",
        cell: ({ row }) => (
          <div className="min-w-[8rem]">
            <span className="block truncate">{row.original.omieAccountName ?? <span className="text-muted-foreground">não roteado</span>}</span>
            <span className="block text-[12px] text-muted-foreground">{row.original.companyCnpj ? formatDocument(row.original.companyCnpj) : ""}</span>
          </div>
        ),
      },
      {
        id: "track",
        header: "Trilho",
        cell: ({ row }) => <TrackMini status={row.original.status} errorStep={row.original.lastError?.step} processing={row.original.processing} />,
      },
      {
        id: "docs",
        header: "Documentos no Omie",
        cell: ({ row }) =>
          row.original.documents.length ? (
            <div className="flex flex-col items-start gap-1">
              {row.original.documents.map((d) => (
                <DocumentChip key={d.kind} kind={d.kind} status={d.status} number={d.omieNumber} invoice={d.invoiceNumber} />
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "status",
        header: "Situação",
        cell: ({ row }) => {
          const o = row.original;
          return (
            <div className="max-w-[19rem] min-w-[11rem]">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={o.status} />
                {o.updatedAfterSync ? (
                  <Tooltip content="O pedido foi alterado no Vision depois de enviado ao Omie.">
                    <AlertTriangle className="size-4 text-rejected" aria-label="Alterado no Vision após o envio" />
                  </Tooltip>
                ) : null}
              </div>
              {o.lastError ? (
                <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-error" title={o.lastError.message}>
                  <span className="font-semibold">{ERROR_CATEGORY_LABELS[o.lastError.category]}:</span> {o.lastError.message}
                </p>
              ) : null}
              <p className="text-[12px] text-muted-foreground" title={formatDateTime(o.updatedAt)}>
                {o.nextRetryAt ? `Nova tentativa ${formatRelative(o.nextRetryAt)}` : `Atualizado ${formatRelative(o.updatedAt)}`}
              </p>
            </div>
          );
        },
      },
      {
        id: "amount",
        header: () => <span className="block text-right">Valor</span>,
        cell: ({ row }) => <span className="block text-right whitespace-nowrap tabular-nums">{formatMoney(row.original.totalAmount)}</span>,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Ações</span>,
        cell: ({ row }) => {
          const o = row.original;
          const canRetry = o.status === "ERROR" || o.status === "PENDING" || o.status === "REJECTED" || o.status === "SENT";
          return canRetry ? (
            <Tooltip content={o.status === "ERROR" ? "Reenviar agora" : "Processar agora"}>
              <Button size="icon-sm" variant="ghost" aria-label={`Reenviar pedido ${o.visionOrderCode}`} disabled={retryOne.isPending && retryOne.variables === o.id} onClick={() => retryOne.mutate(o.id)}>
                {retryOne.isPending && retryOne.variables === o.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              </Button>
            </Tooltip>
          ) : null;
        },
      },
    ],
    [retryOne],
  );

  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
  });

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const hasFilters = Boolean(filters.search || filters.account || filters.category);

  return (
    <>
      <PageHeader title="Pedidos" description="Todos os pedidos do Vision acompanhados pela integração. Abra um pedido para ver a linha do tempo completa e a causa de qualquer erro." actions={<SyncButton />} />

      <div className="relative mb-4 flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Filtrar por situação">
        {SEGMENTS.map((segment) => {
          const active = filters.status === segment.key;
          const count = segment.key ? (data?.counts[segment.key] ?? 0) : (data?.counts.ALL ?? 0);
          const meta = segment.key ? ORDER_STATUS_META[segment.key as OrderStatus] : null;
          return (
            <button
              key={segment.key || "all"}
              role="tab"
              aria-selected={active}
              onClick={() => update({ status: segment.key, category: segment.key === "ERROR" ? filters.category : "" })}
              className={cn("-mb-px flex h-10 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-semibold whitespace-nowrap text-muted-foreground hover:text-foreground", active && "border-primary text-foreground")}
            >
              {segment.label}
              <span className={cn("rounded-full px-1.5 text-[12px] tabular-nums", meta && count > 0 && (segment.key === "ERROR" || segment.key === "REJECTED") ? cn(meta.bg, meta.text) : "bg-surface-sunken text-muted-foreground")}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Código do pedido, cliente, CNPJ ou nº da NF" className="pl-9" aria-label="Buscar pedidos" />
        </div>
        <NativeSelect value={filters.account} onChange={(e) => update({ account: e.target.value })} className="w-auto min-w-[12rem]" aria-label="Filtrar por conta Omie">
          <option value="">Todas as contas Omie</option>
          {accounts.data?.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
        {filters.status === "ERROR" ? (
          <NativeSelect value={filters.category} onChange={(e) => update({ category: e.target.value })} className="w-auto min-w-[12rem]" aria-label="Filtrar por causa do erro">
            <option value="">Todas as causas</option>
            {ERROR_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {ERROR_CATEGORY_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={() => { setSearchInput(""); update({ search: "", account: "", category: "" }); }}>
            <X /> Limpar filtros
          </Button>
        ) : null}
        {isFetching && !isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Atualizando" /> : null}
      </div>

      {selectedIds.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-panel border border-primary/30 bg-surface px-4 py-2.5">
          <span className="text-sm font-semibold">{selectedIds.length} pedido(s) selecionado(s)</span>
          <Button size="sm" onClick={() => retryMany.mutate(selectedIds)} disabled={retryMany.isPending}>
            {retryMany.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reenviar selecionados
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRowSelection({})}>
            Limpar seleção
          </Button>
        </div>
      ) : null}

      <Panel>
        {error ? <div className="p-5 text-error">{error.message}</div> : null}
        {isLoading ? (
          <div className="grid gap-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : data && data.items.length === 0 ? (
          <EmptyState
            title={hasFilters || filters.status ? "Nenhum pedido com esses filtros" : "Nenhum pedido recebido ainda"}
            description={hasFilters || filters.status ? "Ajuste a busca ou escolha outra situação." : "Os pedidos aparecem aqui depois da primeira coleta no Vision. Use Sincronizar agora para buscar imediatamente."}
          />
        ) : (
          <div className="relative w-full overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th key={h.id} className="h-10 border-b border-border px-3 text-left text-[13px] font-semibold whitespace-nowrap text-muted-foreground first:w-10 first:pl-4">
                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className={cn("border-b border-border last:border-b-0 hover:bg-background/60", row.getIsSelected() && "bg-sent-soft/50")}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2.5 align-middle first:pl-4">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-[13px] text-muted-foreground">
            <span>
              {(filters.page - 1) * pageSize + 1}–{Math.min(filters.page * pageSize, data.total)} de {data.total}
            </span>
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="ghost" disabled={filters.page <= 1} onClick={() => update({ page: filters.page - 1 })} aria-label="Página anterior">
                <ChevronLeft />
              </Button>
              <span className="px-2 tabular-nums">
                Página {filters.page} de {totalPages}
              </span>
              <Button size="icon-sm" variant="ghost" disabled={filters.page >= totalPages} onClick={() => update({ page: filters.page + 1 })} aria-label="Próxima página">
                <ChevronRight />
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>
      <p className="mt-3 text-[12px] text-muted-foreground">Trilho: Vision, Roteamento, Mapeamento, Omie, Faturamento e Retorno. A estação em vermelho é onde o pedido parou.</p>
    </>
  );
}
