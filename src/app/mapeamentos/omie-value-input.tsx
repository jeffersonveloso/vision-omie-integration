"use client";

import { useState } from "react";
import { Input, NativeSelect } from "@/components/ui/form-controls";
import { cn } from "@/lib/utils";
import type { LookupEntity } from "@/server/modules/mappings/domain/types";
import { OmieLookupCombobox, useAccounts } from "./shared";

type Mode = "omie" | "text";

interface Props {
  id: string;
  value: string | null;
  onChange: (value: string) => void;
  /** Cadastro do Omie ligado ao campo (categorias, contas correntes...); null = o usuário escolhe. */
  fieldEntity: LookupEntity | null;
  entityLabels: Record<LookupEntity, string>;
  /** Conta da regra; null = regra para todas as contas (o usuário escolhe em qual base consultar). */
  accountId: string | null;
  /** Começa em "Digitar" (ex.: valor com template). */
  preferText?: boolean;
  placeholder?: string;
}

/**
 * Valor do Omie de duas formas: escolhendo de um cadastro da base (sem precisar saber o código interno)
 * ou digitando (código conhecido, template como {{hoje}}). Usado em "Valor fixo" e "Valor se vier vazio".
 */
export function OmieValueInput({ id, value, onChange, fieldEntity, entityLabels, accountId, preferText, placeholder }: Props) {
  const accounts = useAccounts();
  const list = accounts.data?.accounts ?? [];
  const hasTemplate = Boolean(value && /\{\{?[^}]+\}\}?/.test(value));
  const [mode, setMode] = useState<Mode>(preferText || hasTemplate || (!fieldEntity && value) ? "text" : fieldEntity ? "omie" : "text");
  const [entity, setEntity] = useState<LookupEntity>(fieldEntity ?? (Object.keys(entityLabels)[0] as LookupEntity));
  const [browseAccount, setBrowseAccount] = useState("");
  const account = accountId ?? (browseAccount || list[0]?.id || "");
  const accountName = list.find((a) => a.id === account)?.name ?? "";
  const canBrowse = list.length > 0;

  return (
    <div className="grid gap-2">
      <div role="radiogroup" aria-label="Como informar o valor" className="inline-flex w-fit rounded-control border border-border bg-surface-sunken p-0.5 text-[13px]">
        {(
          [
            ["omie", "Escolher do Omie"],
            ["text", "Digitar"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            disabled={m === "omie" && !canBrowse}
            onClick={() => setMode(m)}
            className={cn("rounded-[5px] px-3 py-1 font-semibold transition-colors disabled:opacity-50", mode === m ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "omie" && canBrowse ? (
        <>
          <div className="flex flex-wrap gap-2">
            <NativeSelect value={entity} onChange={(e) => setEntity(e.target.value as LookupEntity)} className="h-9 w-auto min-w-[11rem]" aria-label="Cadastro do Omie">
              {(Object.keys(entityLabels) as LookupEntity[]).map((e) => (
                <option key={e} value={e}>
                  {entityLabels[e]}
                  {e === fieldEntity ? " (deste campo)" : ""}
                </option>
              ))}
            </NativeSelect>
            {!accountId && list.length > 1 ? (
              <NativeSelect value={account} onChange={(e) => setBrowseAccount(e.target.value)} className="h-9 w-auto min-w-[11rem]" aria-label="Base Omie para consultar">
                {list.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
          </div>
          <OmieLookupCombobox key={`${account}:${entity}`} id={id} accountId={account} entity={entity} value={value} onChange={(v) => onChange(v)} placeholder={placeholder} />
          {!accountId && list.length > 1 ? (
            <p className="text-[12px] text-rejected">
              Regra para todas as contas: o código escolhido é da base {accountName}. Se as bases tiverem códigos diferentes, salve a regra por conta (escolha a conta no topo da tela).
            </p>
          ) : null}
        </>
      ) : (
        <Input id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn(value && /^\d+$/.test(value) && "font-mono")} />
      )}
      {!canBrowse && !accounts.isLoading ? <p className="text-[12px] text-muted-foreground">Cadastre uma conta Omie para escolher os valores da lista do Omie.</p> : null}
    </div>
  );
}
