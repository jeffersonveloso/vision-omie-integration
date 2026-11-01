"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DownloadCloud, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Label, Textarea } from "@/components/ui/form-controls";
import { Mono } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { api, ApiError } from "@/lib/api";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/server/modules/integration/domain/integration-order";
import type { ImportOutcome } from "@/server/modules/integration/application/use-cases/jobs";

type Mode = "codes" | "period";
/** Data local (aaaa-mm-dd): toISOString daria o dia seguinte à noite no Brasil. */
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Trazer pedidos do Vision fora da coleta automática: pelo código (homologação, pedido que ficou de fora)
 * ou por período. Não muda até onde a coleta automática chegou.
 */
export function ImportOrdersButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("codes");
  const [codes, setCodes] = useState("");
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 7 * 86_400_000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [sendNow, setSendNow] = useState(true);
  const [includeIneligible, setIncludeIneligible] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportOutcome | null>(null);

  const run = useMutation({
    mutationFn: () => api.post<ImportOutcome>("/api/sync/import", mode === "codes" ? { codes, process: sendNow, includeIneligible } : { from, to, process: sendNow }),
    onSuccess: (r) => {
      setResult(r);
      void queryClient.invalidateQueries();
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      else toast.error("Não foi possível trazer os pedidos", { description: e.message });
    },
  });

  const reset = (v: boolean) => {
    setOpen(v);
    if (!v) {
      setResult(null);
      setErrors({});
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <DownloadCloud /> Trazer do Vision
      </Button>
      <Dialog open={open} onOpenChange={reset}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Trazer pedidos do Vision</DialogTitle>
            <DialogDescription>Para pedidos específicos ou um período que a coleta automática não pegou. A coleta automática continua de onde estava.</DialogDescription>
          </DialogHeader>
          {result ? (
            <ImportResult result={result} />
          ) : (
            <form
              id="import-form"
              className="contents"
              onSubmit={(e) => {
                e.preventDefault();
                setErrors({});
                run.mutate();
              }}
            >
              <DialogBody className="grid gap-4">
                <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
                  <TabsList>
                    <TabsTrigger value="codes">Pelo código</TabsTrigger>
                    <TabsTrigger value="period">Por período</TabsTrigger>
                  </TabsList>
                  <TabsContent value="codes" className="mt-4 grid gap-4">
                    <Field label="Códigos dos pedidos no Vision" htmlFor="import-codes" error={errors.codes} hint="Separados por vírgula, espaço ou um por linha. Até 100 por vez.">
                      <Textarea id="import-codes" value={codes} onChange={(e) => setCodes(e.target.value)} placeholder="14062, 14100" className="min-h-20 font-mono" autoFocus aria-invalid={Boolean(errors.codes)} />
                    </Field>
                    <div className="flex items-start gap-3">
                      <Checkbox id="import-ineligible" checked={includeIneligible} onCheckedChange={(v) => setIncludeIneligible(Boolean(v))} className="mt-0.5" />
                      <div>
                        <Label htmlFor="import-ineligible">Trazer mesmo fora das situações elegíveis</Label>
                        <p className="text-[13px] text-muted-foreground">Sem esta opção, pedidos em situações que não estão em Configurações › Coleta ficam de fora.</p>
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="period" className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="Atualizados de" htmlFor="import-from" error={errors.from}>
                      <Input id="import-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-invalid={Boolean(errors.from)} />
                    </Field>
                    <Field label="Até" htmlFor="import-to" error={errors.to} hint="Até 92 dias.">
                      <Input id="import-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={Boolean(errors.to)} />
                    </Field>
                  </TabsContent>
                </Tabs>
                <div className="flex items-start gap-3 rounded-control border border-border bg-background/50 p-3">
                  <Checkbox id="import-send" checked={sendNow} onCheckedChange={(v) => setSendNow(Boolean(v))} className="mt-0.5" />
                  <div>
                    <Label htmlFor="import-send">Enviar ao Omie agora</Label>
                    <p className="text-[13px] text-muted-foreground">Desmarcado, os pedidos entram na fila e vão na próxima sincronização. Pedidos já enviados não são reenviados.</p>
                  </div>
                </div>
              </DialogBody>
            </form>
          )}
          <DialogFooter>
            {result ? (
              <>
                <Button variant="ghost" onClick={() => setResult(null)}>
                  Trazer outros
                </Button>
                <Button onClick={() => reset(false)}>Fechar</Button>
              </>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={() => reset(false)}>
                  Cancelar
                </Button>
                <Button type="submit" form="import-form" disabled={run.isPending || (mode === "codes" && !codes.trim())}>
                  {run.isPending ? <Loader2 className="animate-spin" /> : <DownloadCloud />} Trazer pedidos
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImportResult({ result }: { result: ImportOutcome }) {
  const lines = [
    `${result.fetched} pedido(s) lido(s) no Vision: ${result.discovered} novo(s), ${result.updated} atualizado(s), ${result.unchanged} sem mudança.`,
    result.processed ? `${result.processed} enviado(s) ao Omie agora: ${result.succeeded} com sucesso${result.failed ? `, ${result.failed} com erro` : ""}.` : null,
  ].filter(Boolean);
  return (
    <DialogBody className="grid gap-3 text-[14px]" aria-live="polite">
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
      {result.notFound.length ? (
        <p className="text-error">
          Não encontrado(s) no Vision: <Mono>{result.notFound.join(", ")}</Mono>
        </p>
      ) : null}
      {result.notEligible.length ? (
        <p className="text-rejected">
          Fora das situações elegíveis (não entraram):{" "}
          {result.notEligible.map((n) => `${n.code}${n.statusDescription ? ` (${n.statusDescription})` : ""}`).join(", ")}. Marque &quot;Trazer mesmo fora das situações elegíveis&quot; para incluir.
        </p>
      ) : null}
      {result.orders.length ? (
        <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-control border border-border">
          {result.orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2">
              <Link href={`/pedidos/${o.id}`} className="font-semibold text-primary underline-offset-2 hover:underline">
                Pedido {o.visionOrderCode}
              </Link>
              <span className="text-[13px] text-muted-foreground">{ORDER_STATUS_LABELS[o.status as OrderStatus] ?? o.status}</span>
              {o.lastError ? <span className="basis-full text-[13px] text-error">{o.lastError}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </DialogBody>
  );
}
