"use client";

import { Check, Clock } from "lucide-react";
import { DOC_SHORT } from "@/components/status";
import { JsonView, Mono, Panel, PanelHeader } from "@/components/ui/misc";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OrderDetail } from "@/server/modules/integration/application/queries";
import { DOCUMENT_KIND_LABELS } from "@/server/modules/integration/domain/omie-document";

const STATUS_TEXT = { PENDING: "Não enviado", SENT: "No Omie, aguardando nota", AUTHORIZED: "Nota autorizada", REJECTED: "Nota rejeitada", CANCELLED: "Cancelado" } as const;
const STATUS_CLASS = { PENDING: "text-queued", SENT: "text-sent", AUTHORIZED: "text-done", REJECTED: "text-rejected", CANCELLED: "text-muted" } as const;

function Returned({ label, at }: { label: string; at?: string | null }) {
  return (
    <li className="flex items-center gap-2">
      {at ? <Check className="size-3.5 text-done" strokeWidth={3} /> : <Clock className="size-3.5 text-muted-foreground" />}
      <span className={cn(!at && "text-muted-foreground")}>{label}</span>
      {at ? <span className="text-muted-foreground">{formatDateTime(at)}</span> : null}
    </li>
  );
}

/** Documentos gerados no Omie (PV e/ou OS), nota fiscal, títulos e o que já voltou ao Vision. */
export function DocumentsPanel({ order }: { order: OrderDetail }) {
  return (
    <Panel>
      <PanelHeader title="Documentos no Omie" description={order.documentsFull.length ? undefined : "Nenhum documento gerado ainda."} />
      <div className="divide-y divide-border">
        {order.documentsFull.map((doc) => {
          const f = doc.fiscal;
          return (
            <article key={doc.id} className="grid gap-3 px-5 py-4 text-[13px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[14px] font-bold">
                  {DOCUMENT_KIND_LABELS[doc.kind]} {doc.omieNumber ? <span className="font-normal text-muted-foreground">nº {doc.omieNumber}</span> : null}
                </h3>
                <span className={cn("font-semibold", STATUS_CLASS[doc.status])}>{STATUS_TEXT[doc.status]}</span>
              </div>
              <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Código de integração</dt>
                <dd><Mono>{doc.integrationCode}</Mono></dd>
                <dt className="text-muted-foreground">ID no Omie</dt>
                <dd><Mono>{doc.omieId ?? "—"}</Mono></dd>
                <dt className="text-muted-foreground">Enviado em</dt>
                <dd>{formatDateTime(doc.sentAt)}</dd>
                {f?.invoiceNumber ? (
                  <>
                    <dt className="text-muted-foreground">{doc.kind === "SALES_ORDER" ? "NF-e" : "NFS-e"}</dt>
                    <dd>
                      {f.invoiceNumber}
                      {f.series ? ` série ${f.series}` : ""}
                      {f.authorizedAt ? `, autorizada em ${formatDateTime(f.authorizedAt)}` : ""}
                    </dd>
                  </>
                ) : null}
                {f?.accessKey ? (
                  <>
                    <dt className="text-muted-foreground">Chave de acesso</dt>
                    <dd className="break-all"><Mono>{f.accessKey}</Mono></dd>
                  </>
                ) : null}
                {f?.verificationCode ? (
                  <>
                    <dt className="text-muted-foreground">Código de verificação</dt>
                    <dd><Mono>{f.verificationCode}</Mono></dd>
                  </>
                ) : null}
                {f?.protocol ? (
                  <>
                    <dt className="text-muted-foreground">Protocolo</dt>
                    <dd><Mono>{f.protocol}</Mono></dd>
                  </>
                ) : null}
                {f?.rejectionMessage ? (
                  <>
                    <dt className="text-rejected">Motivo da rejeição</dt>
                    <dd className="text-rejected">{f.rejectionCode ? `${f.rejectionCode} — ` : ""}{f.rejectionMessage}</dd>
                  </>
                ) : null}
                {f?.pdfUrl ? (
                  <>
                    <dt className="text-muted-foreground">Documento</dt>
                    <dd><a href={f.pdfUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">Abrir PDF da nota</a></dd>
                  </>
                ) : null}
              </dl>

              {doc.status !== "PENDING" && doc.status !== "SENT" ? (
                <div>
                  <p className="mb-1 font-semibold">Informado ao Vision</p>
                  <ul className="grid gap-1">
                    {doc.status === "AUTHORIZED" || doc.status === "CANCELLED" ? <Returned label="Autorização" at={doc.fiscalReturn.authorization?.sentAt} /> : null}
                    {doc.status === "REJECTED" ? <Returned label="Rejeição" at={doc.fiscalReturn.rejection?.sentAt} /> : null}
                    {doc.status === "CANCELLED" ? <Returned label="Cancelamento" at={doc.fiscalReturn.cancellation?.sentAt} /> : null}
                  </ul>
                </div>
              ) : null}

              {doc.titles.length ? (
                <div className="relative overflow-x-auto">
                  <p className="mb-1 font-semibold">Títulos a receber</p>
                  <table className="w-full text-[13px]">
                    <thead className="text-left text-[12px] text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-3 font-semibold">Parcela</th>
                        <th className="py-1 pr-3 font-semibold">Vencimento</th>
                        <th className="py-1 pr-3 text-right font-semibold">Valor</th>
                        <th className="py-1 pr-3 font-semibold">Situação</th>
                        <th className="py-1 font-semibold">Baixas no Vision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.titles.map((t) => (
                        <tr key={t.omieTitleId} className="border-t border-border">
                          <td className="py-1.5 pr-3">
                            {t.parcelLabel ?? t.parcelNumber ?? "—"}
                            {t.visionParcelCode ? <span className="block text-[12px] text-muted-foreground">Vision {t.visionParcelCode}</span> : <span className="block text-[12px] text-rejected">sem parcela no Vision</span>}
                          </td>
                          <td className="py-1.5 pr-3">{formatDate(t.dueDate)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(t.amount)}</td>
                          <td className="py-1.5 pr-3">{t.status ?? "—"}</td>
                          <td className="py-1.5">
                            {t.payments.length === 0 ? (
                              <span className="text-muted-foreground">nenhuma</span>
                            ) : (
                              <ul>
                                {t.payments.map((p) => (
                                  <li key={p.omieBaixaId} className={cn(p.cancelledAt && "text-muted-foreground line-through")}>
                                    {formatMoney(p.amount)} em {formatDate(p.paidAt)}{" "}
                                    <span className={cn("text-[12px]", p.returnedAt ? "text-done" : "text-queued")}>{p.cancelledAt ? (p.cancellationReturnedAt ? "estorno informado" : "estorno pendente") : p.returnedAt ? "informada" : "pendente"}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {doc.requestPayload ? (
                <details>
                  <summary className="cursor-pointer font-semibold text-primary">Payload enviado ao Omie ({DOC_SHORT[doc.kind]})</summary>
                  <JsonView value={doc.requestPayload} className="mt-2" maxHeight="22rem" />
                </details>
              ) : null}
            </article>
          );
        })}
      </div>
    </Panel>
  );
}
