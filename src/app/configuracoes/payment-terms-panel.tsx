"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, NativeSelect, Switch } from "@/components/ui/form-controls";
import { Panel, PanelHeader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { OmieLookupCombobox, useAccounts } from "@/app/mapeamentos/shared";
import type { PaymentFormSeen } from "@/server/modules/integration/application/queries";
import type { PaymentFormTerm, PaymentTermsSettings } from "@/server/modules/settings/domain/integration-settings";

/** "000 — À vista" (rótulo da lista do Omie) → "À vista". */
const omieDescription = (code: string, label: string | null) => (label ?? "").replace(new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*—\\s*`), "").trim();

/**
 * Configurações › Condições de pagamento.
 * Ordem aplicada a cada pedido: parcelas do Vision (999) → forma de pagamento → condição padrão.
 */
export function PaymentTermsPanel({
  value,
  onChange,
  sendInstallments,
  onSendInstallmentsChange,
  err,
}: {
  value: PaymentTermsSettings;
  onChange: (next: Partial<PaymentTermsSettings>) => void;
  sendInstallments: boolean;
  onSendInstallmentsChange: (v: boolean) => void;
  err: (path: string) => string | null;
}) {
  const accounts = useAccounts();
  const activeAccounts = useMemo(() => (accounts.data?.accounts ?? []).filter((a) => a.active), [accounts.data]);
  const [sourceAccount, setSourceAccount] = useState("");
  useEffect(() => {
    if (!sourceAccount && activeAccounts[0]) setSourceAccount(activeAccounts[0].id);
  }, [activeAccounts, sourceAccount]);

  const seen = useQuery({ queryKey: ["payment-forms-seen"], queryFn: () => api.get<{ forms: PaymentFormSeen[] }>("/api/settings/payment-forms") });
  const rows = value.byPaymentForm;
  const configured = new Set(rows.map((r) => r.visionCode));
  const suggestions = (seen.data?.forms ?? []).filter((f) => !configured.has(f.code));

  const setRow = (index: number, patch: Partial<PaymentFormTerm>) => onChange({ byPaymentForm: rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) });
  const addRow = (row?: Partial<PaymentFormTerm>) => onChange({ byPaymentForm: [...rows, { visionCode: row?.visionCode ?? NaN, visionDescription: row?.visionDescription ?? "", omieCode: "", omieDescription: "" }] });
  const removeRow = (index: number) => onChange({ byPaymentForm: rows.filter((_, i) => i !== index) });

  const conditionPicker = (id: string, code: string | null, onPick: (code: string, description: string) => void, placeholder: string) =>
    sourceAccount ? (
      <OmieLookupCombobox id={id} accountId={sourceAccount} entity="parcelas" value={code} onChange={(v, label) => onPick(v, omieDescription(v, label))} placeholder={placeholder} />
    ) : (
      <Input id={id} value={code ?? ""} onChange={(e) => onPick(e.target.value.trim(), "")} placeholder="Código da condição no Omie (ex.: 000)" className="font-mono" />
    );

  return (
    <Panel>
      <PanelHeader
        title="Condições de pagamento"
        description="Condição enviada ao Omie em cada pedido de venda e ordem de serviço, nesta ordem: as parcelas do pedido no Vision, a condição da forma de pagamento e, por último, a condição padrão. Uma regra em Mapeamentos para o campo Condição de pagamento substitui esta configuração."
      />
      <div className="grid gap-5 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="send-parcels">Usar as parcelas do Vision quando o pedido tiver parcelas</Label>
            <p className="text-[13px] text-muted-foreground">Envia a condição 999 (parcelas informadas) com os vencimentos e valores do pedido. As baixas voltam para essas parcelas.</p>
          </div>
          <Switch id="send-parcels" checked={sendInstallments} onCheckedChange={onSendInstallmentsChange} />
        </div>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-semibold">Por forma de pagamento do Vision</p>
              <p className="text-[13px] text-muted-foreground">Para pedidos sem parcelas, como os de forma &quot;SEM FINANCEIRO&quot;.</p>
            </div>
            {activeAccounts.length > 1 ? (
              <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                Lista de condições da conta
                <NativeSelect value={sourceAccount} onChange={(e) => setSourceAccount(e.target.value)} className="w-auto" aria-label="Conta Omie usada para carregar as condições">
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ) : null}
          </div>
          {!accounts.isLoading && activeAccounts.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Cadastre e ative uma conta Omie para escolher as condições na lista; até lá, informe o código.</p>
          ) : null}

          {rows.length ? (
            <div className="relative overflow-x-auto rounded-control border border-border">
              <table className="w-full min-w-[40rem] text-[13px]">
                <thead className="bg-surface-sunken text-left text-muted-foreground">
                  <tr>
                    <th className="w-28 px-3 py-2 font-semibold">Código no Vision</th>
                    <th className="px-3 py-2 font-semibold">Forma de pagamento</th>
                    <th className="px-3 py-2 font-semibold">Condição no Omie</th>
                    <th className="w-12 px-3 py-2"><span className="sr-only">Remover</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const rowError = err(`paymentTerms.byPaymentForm.${i}.visionCode`) ?? err(`paymentTerms.byPaymentForm.${i}.omieCode`);
                    return (
                      <tr key={i} className="border-t border-border align-top">
                        <td className="px-3 py-2">
                          <Input aria-label="Código da forma de pagamento no Vision" type="number" value={Number.isFinite(row.visionCode) ? row.visionCode : ""} onChange={(e) => setRow(i, { visionCode: e.target.value === "" ? NaN : Number(e.target.value) })} className="font-mono" />
                        </td>
                        <td className="px-3 py-2">
                          <Input aria-label="Descrição da forma de pagamento" value={row.visionDescription} onChange={(e) => setRow(i, { visionDescription: e.target.value })} placeholder="Ex.: SEM FINANCEIRO" />
                        </td>
                        <td className="px-3 py-2">
                          {conditionPicker(`term-${i}`, row.omieCode || null, (omieCode, omieDescription) => setRow(i, { omieCode, omieDescription }), "Escolha a condição do Omie")}
                          {rowError ? <p className="mt-1 text-[12px] text-error">{rowError}</p> : null}
                        </td>
                        <td className="px-3 py-2">
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(i)} aria-label={`Remover a forma ${Number.isFinite(row.visionCode) ? row.visionCode : ""}`}>
                            <Trash2 />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {err("paymentTerms.byPaymentForm") ? <p className="text-[13px] text-error">{err("paymentTerms.byPaymentForm")}</p> : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => addRow()}>
              <Plus /> Adicionar forma de pagamento
            </Button>
            {suggestions.map((f) => (
              <Button key={f.code} type="button" variant="ghost" size="sm" onClick={() => addRow({ visionCode: f.code, visionDescription: f.description ?? "" })} title={`${f.orders} pedido(s) com esta forma, ${f.withoutParcels} sem parcelas`}>
                <Plus /> {f.code}
                {f.description ? ` — ${f.description}` : ""}
                <span className="text-muted-foreground">
                  ({f.orders} pedido{f.orders === 1 ? "" : "s"}
                  {f.withoutParcels ? `, ${f.withoutParcels} sem parcelas` : ""})
                </span>
              </Button>
            ))}
          </div>
          {suggestions.length ? <p className="text-[12px] text-muted-foreground">Formas encontradas nos pedidos já lidos do Vision que ainda não têm condição.</p> : null}
        </div>

        <Field label="Condição padrão para pedidos sem parcelas" htmlFor="default-term" error={err("paymentTerms.defaultCondition")} hint="Vale quando a forma de pagamento do pedido não está na lista acima. Sem condição padrão, o pedido para com a pendência para você decidir.">
          <div className="flex max-w-xl items-center gap-2">
            <div className="min-w-0 flex-1">{conditionPicker("default-term", value.defaultCondition, (code, description) => onChange({ defaultCondition: code || null, defaultConditionDescription: description }), "Nenhuma: o pedido para com pendência")}</div>
            {value.defaultCondition ? (
              <Button type="button" variant="ghost" size="icon" onClick={() => onChange({ defaultCondition: null, defaultConditionDescription: "" })} aria-label="Remover a condição padrão">
                <X />
              </Button>
            ) : null}
          </div>
        </Field>
      </div>
    </Panel>
  );
}
