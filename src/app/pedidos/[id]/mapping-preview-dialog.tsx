"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/form-controls";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { JsonView } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { api, qs } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { MappingPreview } from "@/server/modules/integration/application/use-cases/preview-order-mapping";
import { DOCUMENT_TYPE_LABELS } from "@/server/modules/mappings/domain/types";
import type { PublicOmieAccount } from "@/server/modules/omie-accounts/domain/omie-account";

const ORIGIN_LABEL = { DEFAULT: "Padrão do sistema", GLOBAL: "Todas as contas", ACCOUNT: "Desta conta", SYSTEM: "Integração" } as const;

function display(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Simula o mapeamento do pedido: payload final, pendências e origem de cada campo — sem chamar o Omie. */
export function MappingPreviewDialog({ orderId, open, onOpenChange }: { orderId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [account, setAccount] = useState("");
  const [refresh, setRefresh] = useState(0);
  const accounts = useQuery({ queryKey: ["omie-accounts"], queryFn: () => api.get<{ accounts: PublicOmieAccount[] }>("/api/omie-accounts"), enabled: open });
  const preview = useQuery({
    queryKey: ["preview", orderId, account, refresh],
    queryFn: () => api.get<MappingPreview>(`/api/orders/${orderId}/preview${qs({ account, refresh: refresh > 0 ? "1" : undefined })}`),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Simulação do mapeamento</DialogTitle>
          <DialogDescription>O que seria enviado ao Omie com as regras atuais. Nada é gravado nem enviado.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect value={account} onChange={(e) => setAccount(e.target.value)} className="w-auto min-w-[16rem]" aria-label="Conta Omie da simulação">
              <option value="">Conta pelo CNPJ do pedido</option>
              {accounts.data?.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" size="sm" onClick={() => setRefresh((n) => n + 1)} disabled={preview.isFetching}>
              {preview.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />} Buscar o pedido de novo no Vision
            </Button>
          </div>
          {preview.error ? <p className="text-error">{preview.error.message}</p> : null}
          {preview.isLoading ? (
            <div className="flex items-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Montando os payloads…
            </div>
          ) : preview.data ? (
            <>
              {preview.data.routingError ? <p className="rounded-control border border-error/30 bg-error-soft p-3 text-error">{preview.data.routingError}</p> : null}
              {preview.data.account ? (
                <p className="text-[13px] text-muted-foreground">
                  Conta usada: <span className="font-semibold text-foreground">{preview.data.account.name}</span> ({preview.data.account.cnpj})
                </p>
              ) : null}
              {preview.data.documents.length ? (
                <Tabs defaultValue={(preview.data.documents.find((d) => d.issues.some((i) => i.severity === "error")) ?? preview.data.documents.find((d) => d.type !== "CUSTOMER") ?? preview.data.documents[0]).type}>
                  <TabsList>
                    {preview.data.documents.map((d) => {
                      const errors = d.issues.filter((i) => i.severity === "error").length;
                      return (
                        <TabsTrigger key={d.type} value={d.type}>
                          {DOCUMENT_TYPE_LABELS[d.type]}
                          {errors ? <span className="rounded-full bg-error-soft px-1.5 text-[12px] text-error">{errors}</span> : null}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                  {preview.data.documents.map((d) => (
                    <TabsContent key={d.type} value={d.type} className="grid gap-4">
                      {d.issues.length ? (
                        <ul className="grid gap-1.5">
                          {d.issues.map((issue, i) => (
                            <li key={i} className={cn("rounded-control border p-2.5 text-[13px]", issue.severity === "error" ? "border-error/30 bg-error-soft" : "border-rejected/30 bg-rejected-soft")}>
                              <span className={cn("font-semibold", issue.severity === "error" ? "text-error" : "text-rejected")}>{issue.message}</span>
                              {issue.hint ? <span className="block text-muted-foreground">{issue.hint}</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[13px] font-semibold text-done">Nenhuma pendência de mapeamento.</p>
                      )}
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="min-w-0">
                          <p className="mb-1.5 text-[13px] font-semibold">Payload para o Omie</p>
                          <JsonView value={d.payload} maxHeight="26rem" />
                        </div>
                        <div className="min-w-0">
                          <p className="mb-1.5 text-[13px] font-semibold">Origem de cada campo</p>
                          <div className="max-h-[26rem] overflow-auto rounded-control border border-border">
                            <table className="w-full text-[12px]">
                              <thead className="sticky top-0 bg-surface-sunken text-left text-muted-foreground">
                                <tr>
                                  <th className="px-2 py-1.5 font-semibold">Campo</th>
                                  <th className="px-2 py-1.5 font-semibold">Origem</th>
                                  <th className="px-2 py-1.5 font-semibold">Valor</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.trace.map((t, i) => (
                                  <tr key={i} className="border-t border-border align-top">
                                    <td className="px-2 py-1.5">
                                      {t.label}
                                      {t.itemIndex !== undefined ? <span className="text-muted-foreground"> (item {t.itemIndex + 1})</span> : null}
                                    </td>
                                    <td className="px-2 py-1.5 text-muted-foreground">
                                      {t.source}
                                      <span className="block">{ORIGIN_LABEL[t.origin]}</span>
                                    </td>
                                    <td className="px-2 py-1.5 font-mono break-words">{display(t.value)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              ) : null}
            </>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
