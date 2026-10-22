"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Label, NativeSelect } from "@/components/ui/form-controls";
import { Mono } from "@/components/ui/misc";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { EffectiveRuleView } from "@/server/modules/mappings/application/mapping-admin-service";
import type { DocumentType, LookupEntity, RuleSpec, SourceType, Transform } from "@/server/modules/mappings/domain/types";
import { type CatalogResponse, describeSpec, type MapSummary, OmieLookupCombobox, VisionFieldCombobox } from "./shared";

const SOURCE_HELP: Record<SourceType, string> = {
  VISION_FIELD: "Copia um campo do pedido do Vision. Também aceita template, por exemplo {cliente.cidade} ({cliente.uf}).",
  CONSTANT: "Envia sempre o mesmo valor. Aceita {{hoje}} (data atual) e {{codigoPedido}}.",
  VALUE_MAP: "Traduz o código do Vision pelo de-para da conta, por exemplo produto 123 do Vision para o produto 4422421 do Omie.",
  IGNORE: "O campo não é enviado ao Omie.",
};

const ITEM_PREFIX: Partial<Record<DocumentType, string>> = { SALES_ORDER: "det[].", SERVICE_ORDER: "ServicosPrestados[]." };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentType: DocumentType;
  rule: EffectiveRuleView | null;
  accountId: string | null;
  accountName: string;
  catalog: CatalogResponse;
  maps: MapSummary[];
}

export function RuleEditorDialog({ open, onOpenChange, documentType, rule, accountId, accountName, catalog, maps }: Props) {
  const queryClient = useQueryClient();
  const custom = !rule;
  const [targetField, setTargetField] = useState("");
  const [spec, setSpec] = useState<RuleSpec>({ sourceType: "VISION_FIELD" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastOpen, setLastOpen] = useState(false);

  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setTargetField(rule?.key ?? "");
      setSpec(rule?.spec ?? rule?.defaultSpec ?? (rule?.managedBy ? { sourceType: "CONSTANT", transforms: [] } : { sourceType: "VISION_FIELD", transforms: [] }));
      setErrors({});
    }
  }

  const key = rule?.key ?? targetField;
  const prefix = ITEM_PREFIX[documentType];
  const isItem = Boolean(prefix && key.startsWith(prefix));
  const visionScope = !isItem ? "header" : documentType === "SALES_ORDER" ? "item" : "service";
  const lookup = (rule?.lookup ?? null) as LookupEntity | null;
  const ownRuleHere = Boolean(rule?.ruleId) && ((accountId && rule?.origin === "ACCOUNT") || (!accountId && rule?.origin === "GLOBAL"));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["rules"] });
    void queryClient.invalidateQueries({ queryKey: ["preview"] });
  };

  const save = useMutation({
    mutationFn: () =>
      api.put("/api/mappings/rules", {
        omieAccountId: accountId,
        documentType,
        targetField: key.trim(),
        sourceType: spec.sourceType,
        sourcePath: spec.sourcePath ?? null,
        constantValue: spec.constantValue ?? null,
        valueMapKey: spec.valueMapKey ?? null,
        transforms: spec.transforms ?? [],
        defaultValue: spec.defaultValue ?? null,
        active: true,
      }),
    onSuccess: () => {
      toast.success("Regra salva", { description: `Vale para ${accountId ? accountName : "todas as contas"} a partir do próximo envio.` });
      invalidate();
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length) setErrors(error.fieldErrors);
      else toast.error("Não foi possível salvar", { description: error.message });
    },
  });

  const reset = useMutation({
    mutationFn: () => api.del(`/api/mappings/rules/${rule!.ruleId}`),
    onSuccess: () => {
      toast.success("Regra removida", { description: "O campo voltou a usar a regra padrão." });
      invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error("Não foi possível remover", { description: e.message }),
  });

  const set = (patch: Partial<RuleSpec>) => {
    setSpec((s) => ({ ...s, ...patch }));
    setErrors({});
  };
  const toggleTransform = (t: Transform, on: boolean) => set({ transforms: on ? [...(spec.transforms ?? []), t] : (spec.transforms ?? []).filter((x) => x !== t) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{custom ? "Campo personalizado" : rule!.label}</DialogTitle>
            <DialogDescription>
              {custom ? "Mapeie qualquer campo do payload do Omie, mesmo que não esteja na lista." : rule!.description}{" "}
              Esta regra vale para <span className="font-semibold text-foreground">{accountId ? accountName : "todas as contas"}</span>.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            {custom ? (
              <Field label="Campo no Omie" htmlFor="target" error={errors.targetField} hint={prefix ? `Caminho no payload do Omie. Para campos dos itens, comece com ${prefix} (ex.: ${prefix}inf_adic.peso_bruto).` : "Caminho no payload do Omie, ex.: inscricao_suframa."}>
                <Input id="target" value={targetField} onChange={(e) => setTargetField(e.target.value.trim())} className="font-mono" placeholder={documentType === "SALES_ORDER" ? "frete.quantidade_volumes" : documentType === "SERVICE_ORDER" ? "InformacoesAdicionais.cCodObra" : "inscricao_suframa"} />
              </Field>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                Campo no Omie: <Mono className="text-foreground">{rule!.key}</Mono>
                {rule!.required ? <span className="ml-2 font-semibold text-error">obrigatório</span> : null}
              </p>
            )}

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-[13px] font-semibold">De onde vem o valor</legend>
              <div className="grid gap-2 sm:grid-cols-4" role="radiogroup">
                {(Object.keys(catalog.sourceTypes) as SourceType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={spec.sourceType === type}
                    onClick={() => set({ sourceType: type })}
                    className={cn("rounded-control border px-3 py-2 text-left text-sm font-semibold transition-colors", spec.sourceType === type ? "border-primary bg-primary/8 text-foreground" : "border-border-strong text-muted-foreground hover:text-foreground")}
                  >
                    {catalog.sourceTypes[type]}
                  </button>
                ))}
              </div>
              <p className="text-[13px] text-muted-foreground">{SOURCE_HELP[spec.sourceType]}</p>
            </fieldset>

            {spec.sourceType === "VISION_FIELD" || spec.sourceType === "VALUE_MAP" ? (
              <Field label={spec.sourceType === "VALUE_MAP" ? "Campo do Vision usado como chave" : "Campo do Vision"} htmlFor="source" error={errors.sourcePath} hint={isItem ? "Campos relativos a cada item. Use $pedido. para ler dados do pedido." : undefined}>
                <VisionFieldCombobox id="source" fields={catalog.visionFields} scope={visionScope} value={spec.sourcePath ?? null} onChange={(v) => set({ sourcePath: v })} />
              </Field>
            ) : null}

            {spec.sourceType === "VALUE_MAP" ? (
              <Field label="Tabela de-para" htmlFor="map" error={errors.valueMapKey} hint="As linhas da tabela são cadastradas por conta, na aba Tabelas de-para.">
                <NativeSelect id="map" value={spec.valueMapKey ?? ""} onChange={(e) => set({ valueMapKey: e.target.value })}>
                  <option value="">Selecione</option>
                  {maps.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}

            {spec.sourceType === "CONSTANT" ? (
              <Field
                label="Valor fixo"
                htmlFor="constant"
                error={errors.constantValue}
                hint={lookup && !accountId ? "Os códigos do Omie mudam de uma base para outra. Escolha uma conta no topo da tela para selecionar da lista do Omie." : undefined}
              >
                {lookup && accountId ? (
                  <OmieLookupCombobox id="constant" accountId={accountId} entity={lookup} value={spec.constantValue ?? null} onChange={(v) => set({ constantValue: v })} />
                ) : (
                  <Input id="constant" value={spec.constantValue ?? ""} onChange={(e) => set({ constantValue: e.target.value })} />
                )}
              </Field>
            ) : null}

            {spec.sourceType !== "IGNORE" ? (
              <>
                <fieldset>
                  <legend className="mb-2 text-[13px] font-semibold">Transformações</legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(Object.keys(catalog.transforms) as Transform[]).map((t) => (
                      <div key={t} className="flex items-center gap-2">
                        <Checkbox id={`t-${t}`} checked={spec.transforms?.includes(t) ?? false} onCheckedChange={(v) => toggleTransform(t, Boolean(v))} />
                        <Label htmlFor={`t-${t}`} className="font-normal">
                          {catalog.transforms[t]}
                        </Label>
                      </div>
                    ))}
                  </div>
                </fieldset>
                {spec.sourceType !== "CONSTANT" ? (
                  <Field label="Valor se vier vazio" htmlFor="default" hint="Opcional. Aceita template e tokens, como {cliente.razaoSocial} ou {{hoje}}.">
                    <Input id="default" value={spec.defaultValue ?? ""} onChange={(e) => set({ defaultValue: e.target.value })} />
                  </Field>
                ) : null}
              </>
            ) : null}

            {rule?.defaultSpec ? (
              <p className="rounded-control bg-surface-sunken px-3 py-2 text-[13px] text-muted-foreground">
                Padrão do sistema: {describeSpec(rule.defaultSpec, maps, catalog.transforms)}
              </p>
            ) : rule?.managedBy ? (
              <p className="rounded-control bg-surface-sunken px-3 py-2 text-[13px] text-muted-foreground">
                Sem regra aqui, vale o que está em {rule.managedBy}. Uma regra salva aqui substitui essa configuração{accountId ? " nesta conta" : " em todas as contas"}.
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter className="justify-between">
            <div>
              {ownRuleHere ? (
                <Button type="button" variant="ghost" onClick={() => reset.mutate()} disabled={reset.isPending}>
                  <RotateCcw /> Voltar ao padrão
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" /> : null} Salvar regra
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
