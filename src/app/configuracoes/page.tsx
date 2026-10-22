"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCircle2, Loader2, Plug, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, NativeSelect, Switch, Textarea } from "@/components/ui/form-controls";
import { Mono, Panel, PanelHeader, Skeleton } from "@/components/ui/misc";
import { api, ApiError } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { LINE_TOTAL_POLICY_LABELS, type LineTotalPolicy } from "@/server/modules/integration/domain/line-totals";
import type { IntegrationSettings } from "@/server/modules/settings/domain/integration-settings";
import { CollectionWindow } from "./collection-window";
import { PaymentTermsPanel } from "./payment-terms-panel";

interface SettingsResponse {
  settings: IntegrationSettings;
  environment: {
    visionApiUrl: string;
    visionUserConfigured: boolean;
    omieApiUrl: string;
    timeZone: string;
    database: string;
    schedulerEnabled: boolean;
    webhookEnabled: boolean;
    encryptionKeyConfigured: boolean;
    initialLookbackDaysEnv: number;
    slackConfigured: boolean;
    appBaseUrl: string | null;
  };
  scheduler: { running: boolean; jobs: Array<{ name: string; enabled: boolean; nextRunAt: string | null; lastRunAt: string | null }> };
}

function ToggleRow({ id, label, description, checked, onChange }: { id: string; label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function SettingsForm({ initial, data }: { initial: IntegrationSettings; data: SettingsResponse }) {
  const queryClient = useQueryClient();
  const [s, setS] = useState<IntegrationSettings>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [visionTest, setVisionTest] = useState<{ ok: boolean; message: string } | null>(null);

  const patch = <K extends keyof IntegrationSettings>(section: K, values: Partial<IntegrationSettings[K]>) => setS((prev) => ({ ...prev, [section]: { ...prev[section], ...values } }));
  const err = (path: string) => errors[path] ?? null;
  const numbers = (text: string) => text.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));

  const save = useMutation({
    mutationFn: () => api.put<SettingsResponse>("/api/settings", s),
    onSuccess: () => {
      toast.success("Configurações salvas", { description: "O agendamento foi recarregado." });
      setErrors({});
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) {
        setErrors(e.fieldErrors);
        toast.error("Revise os campos destacados");
      } else toast.error("Não foi possível salvar", { description: e.message });
    },
  });
  const [alertTest, setAlertTest] = useState<{ ok: boolean; message: string } | null>(null);
  const testAlert = useMutation({ mutationFn: () => api.post<{ ok: boolean; message: string }>("/api/settings/test-alert"), onSuccess: setAlertTest, onError: (e) => setAlertTest({ ok: false, message: e.message }) });
  const testVision = useMutation({ mutationFn: () => api.post<{ ok: boolean; message: string }>("/api/settings/test-vision"), onSuccess: setVisionTest, onError: (e) => setVisionTest({ ok: false, message: e.message }) });
  const job = (name: string) => data.scheduler.jobs.find((j) => j.name === name);
  const env = data.environment;

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Panel>
        <PanelHeader title="Conexão com o Vision" description="Credenciais definidas nas variáveis de ambiente do servidor (VISION_API_URL, VISION_USERNAME, VISION_PASSWORD)." actions={<Button type="button" variant="outline" onClick={() => testVision.mutate()} disabled={testVision.isPending}>{testVision.isPending ? <Loader2 className="animate-spin" /> : <Plug />} Testar conexão</Button>} />
        <div className="grid gap-2 px-5 py-4 text-[13px]">
          <p>ControllerAPI: <Mono>{env.visionApiUrl}</Mono></p>
          <p>Usuário de integração: {env.visionUserConfigured ? "configurado" : <span className="font-semibold text-error">não configurado</span>}</p>
          {visionTest ? (
            <p className={`flex items-start gap-2 ${visionTest.ok ? "text-done" : "text-error"}`}>
              {visionTest.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
              {visionTest.message}
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Coleta e envio (Vision para Omie)" description={job("sync")?.enabled ? `Próxima execução ${formatRelative(job("sync")?.nextRunAt)}.` : "Rotina desligada."} />
        <div className="grid gap-5 px-5 py-4">
          <ToggleRow id="sync-enabled" label="Coletar pedidos automaticamente" checked={s.sync.enabled} onChange={(enabled) => patch("sync", { enabled })} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Agendamento (cron)" htmlFor="sync-cron" error={err("sync.cron")} hint="*/5 * * * * = a cada 5 minutos">
              <Input id="sync-cron" value={s.sync.cron} onChange={(e) => patch("sync", { cron: e.target.value })} className="font-mono" />
            </Field>
            <Field
              label="Primeira coleta: dias para trás"
              htmlFor="lookback"
              error={err("sync.initialLookbackDays")}
              hint={`Vale na primeira coleta e depois de recomeçar. Valor inicial do servidor: SYNC_INITIAL_LOOKBACK_DAYS=${env.initialLookbackDaysEnv}.`}
            >
              <Input id="lookback" type="number" min={0} max={365} value={s.sync.initialLookbackDays} onChange={(e) => patch("sync", { initialLookbackDays: Number(e.target.value) })} />
            </Field>
            <Field label="Sobreposição da janela (dias)" htmlFor="overlap" error={err("sync.overlapDays")} hint="Evita perder pedidos na virada do dia.">
              <Input id="overlap" type="number" min={0} value={s.sync.overlapDays} onChange={(e) => patch("sync", { overlapDays: Number(e.target.value) })} />
            </Field>
            <Field label="Pedidos por página" htmlFor="page-size" error={err("sync.pageSize")}>
              <Input id="page-size" type="number" min={1} value={s.sync.pageSize} onChange={(e) => patch("sync", { pageSize: Number(e.target.value) })} />
            </Field>
            <Field label="Situações elegíveis no Vision" htmlFor="statuses" error={err("sync.eligibleStatusCodes")} hint="Códigos separados por vírgula. Vazio = todas.">
              <Input id="statuses" defaultValue={s.sync.eligibleStatusCodes.join(", ")} onBlur={(e) => patch("sync", { eligibleStatusCodes: numbers(e.target.value) })} />
            </Field>
            <Field label="Máximo de pedidos por execução" htmlFor="max-run" error={err("sync.maxOrdersPerRun")}>
              <Input id="max-run" type="number" min={1} value={s.sync.maxOrdersPerRun} onChange={(e) => patch("sync", { maxOrdersPerRun: Number(e.target.value) })} />
            </Field>
            <Field label="Pedidos em paralelo" htmlFor="concurrency" error={err("sync.concurrency")} hint="O Omie aceita até 4 chamadas simultâneas.">
              <Input id="concurrency" type="number" min={1} max={4} value={s.sync.concurrency} onChange={(e) => patch("sync", { concurrency: Number(e.target.value) })} />
            </Field>
          </div>
          <CollectionWindow unsavedLookback={s.sync.initialLookbackDays !== initial.sync.initialLookbackDays} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Novas tentativas automáticas" description="Valem para falhas temporárias (Omie ou Vision fora do ar, limite de consumo). Erros de mapeamento e cadastro esperam correção e reenvio manual." />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <Field label="Máximo de tentativas" htmlFor="max-retries" error={err("retry.maxAutoRetries")}>
            <Input id="max-retries" type="number" min={0} value={s.retry.maxAutoRetries} onChange={(e) => patch("retry", { maxAutoRetries: Number(e.target.value) })} />
          </Field>
          <Field label="Espera entre tentativas (minutos)" htmlFor="backoff" error={err("retry.backoffMinutes")} hint="Uma espera por tentativa, separadas por vírgula.">
            <Input id="backoff" defaultValue={s.retry.backoffMinutes.join(", ")} onBlur={(e) => patch("retry", { backoffMinutes: numbers(e.target.value) })} />
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Retorno ao Vision (Omie para Vision)" description={job("reconcile")?.enabled ? `Próxima execução ${formatRelative(job("reconcile")?.nextRunAt)}.` : "Rotina desligada."} />
        <div className="grid gap-5 px-5 py-4">
          <ToggleRow id="rec-enabled" label="Acompanhar notas e títulos no Omie" description="Consulta a situação fiscal e financeira e devolve os eventos à ControllerAPI do Vision." checked={s.reconcile.enabled} onChange={(enabled) => patch("reconcile", { enabled })} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Agendamento (cron)" htmlFor="rec-cron" error={err("reconcile.cron")}>
              <Input id="rec-cron" value={s.reconcile.cron} onChange={(e) => patch("reconcile", { cron: e.target.value })} className="font-mono" />
            </Field>
            <Field label="Acompanhar por (dias)" htmlFor="window" error={err("reconcile.windowDays")} hint="Depois disso o pedido sai do acompanhamento.">
              <Input id="window" type="number" min={1} value={s.reconcile.windowDays} onChange={(e) => patch("reconcile", { windowDays: Number(e.target.value) })} />
            </Field>
            <Field label="Máximo de pedidos por execução" htmlFor="rec-max" error={err("reconcile.maxOrdersPerRun")}>
              <Input id="rec-max" type="number" min={1} value={s.reconcile.maxOrdersPerRun} onChange={(e) => patch("reconcile", { maxOrdersPerRun: Number(e.target.value) })} />
            </Field>
          </div>
          <ToggleRow id="rec-fin" label="Devolver títulos e baixas" checked={s.reconcile.returnFinancial} onChange={(returnFinancial) => patch("reconcile", { returnFinancial })} />
          <ToggleRow id="rec-xml" label="Anexar XML da nota na autorização" checked={s.reconcile.attachXml} onChange={(attachXml) => patch("reconcile", { attachXml })} />
          <ToggleRow id="rec-pdf" label="Anexar PDF da nota na autorização" description="Baixa o DANFE ou a NFS-e pelo link do Omie." checked={s.reconcile.attachPdf} onChange={(attachPdf) => patch("reconcile", { attachPdf })} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Roteamento e documentos" />
        <div className="grid gap-5 px-5 py-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Onde está o CNPJ da empresa no pedido do Vision" htmlFor="cnpj-paths" error={err("routing.cnpjFieldPaths")} hint="Um caminho por linha, em ordem de prioridade. O pedido do Vision hoje não traz esse CNPJ, só o código da empresa: nesse caso a integração usa a tabela Empresa Vision → CNPJ de cada conta.">
              <Textarea id="cnpj-paths" defaultValue={s.routing.cnpjFieldPaths.join("\n")} onBlur={(e) => patch("routing", { cnpjFieldPaths: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} className="min-h-24 font-mono text-[13px]" />
            </Field>
            <div className="grid content-start gap-4">
              <Field label="Prefixo do código de integração" htmlFor="prefix" error={err("documents.integrationCodePrefix")} hint={`Ex.: ${s.documents.integrationCodePrefix}-14100 no pedido e ${s.documents.integrationCodePrefix}-14100-OS na ordem de serviço. Mudar o prefixo pode duplicar documentos já enviados.`}>
                <Input id="prefix" value={s.documents.integrationCodePrefix} onChange={(e) => patch("documents", { integrationCodePrefix: e.target.value.toUpperCase() })} className="font-mono" />
              </Field>
            </div>
          </div>
          <ToggleRow id="send-pv" label="Gerar pedido de venda para produtos" checked={s.documents.sendSalesOrders} onChange={(sendSalesOrders) => patch("documents", { sendSalesOrders })} />
          <ToggleRow id="send-os" label="Gerar ordem de serviço para serviços" checked={s.documents.sendServiceOrders} onChange={(sendServiceOrders) => patch("documents", { sendServiceOrders })} />
          <ToggleRow id="upsert" label="Atualizar o cadastro do cliente no Omie a cada envio" description="Desligado, o cliente é cadastrado só na primeira vez." checked={s.documents.upsertCustomer} onChange={(upsertCustomer) => patch("documents", { upsertCustomer })} />
          <Field
            label="Quando quantidade × valor unitário não fecha o total da linha"
            htmlFor="line-total"
            hint="A API do Vision pode arredondar a quantidade ou o valor unitário. Recalcular faz a nota fechar o total do pedido; linhas com desconto sempre bloqueiam."
          >
            <NativeSelect id="line-total" value={s.documents.lineTotalMismatch} onChange={(e) => patch("documents", { lineTotalMismatch: e.target.value as LineTotalPolicy })} className="max-w-md">
              {(Object.keys(LINE_TOTAL_POLICY_LABELS) as LineTotalPolicy[]).map((p) => (
                <option key={p} value={p}>
                  {LINE_TOTAL_POLICY_LABELS[p]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      </Panel>

      <PaymentTermsPanel
        value={s.paymentTerms}
        onChange={(next) => patch("paymentTerms", next)}
        sendInstallments={s.documents.sendVisionInstallments}
        onSendInstallmentsChange={(sendVisionInstallments) => patch("documents", { sendVisionInstallments })}
        err={err}
      />

      <Panel>
        <details>
          <summary className="cursor-pointer px-5 py-3.5">
            <span className="text-[15px] font-bold">Convenções do retorno ao Vision</span>
            <span className="block text-[13px] text-muted-foreground">Valores dos campos de controle da ControllerAPI. Ajuste conforme a orientação do suporte do Vision.</span>
          </summary>
          <div className="grid gap-4 border-t border-border px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="codigoIntegracao" htmlFor="ci"><Input id="ci" type="number" value={s.visionReturn.codigoIntegracao} onChange={(e) => patch("visionReturn", { codigoIntegracao: Number(e.target.value) })} /></Field>
            <Field label="tipoNotaFiscal (produto)" htmlFor="tnp"><Input id="tnp" type="number" value={s.visionReturn.tipoNotaFiscalProduto} onChange={(e) => patch("visionReturn", { tipoNotaFiscalProduto: Number(e.target.value) })} /></Field>
            <Field label="tipoNotaFiscal (serviço)" htmlFor="tns"><Input id="tns" type="number" value={s.visionReturn.tipoNotaFiscalServico} onChange={(e) => patch("visionReturn", { tipoNotaFiscalServico: Number(e.target.value) })} /></Field>
            <Field label="origemParcela" htmlFor="op"><Input id="op" type="number" value={s.visionReturn.origemParcela} onChange={(e) => patch("visionReturn", { origemParcela: Number(e.target.value) })} /></Field>
            <Field label="tipo (produto)" htmlFor="tp"><Input id="tp" value={s.visionReturn.tipoProduto} onChange={(e) => patch("visionReturn", { tipoProduto: e.target.value })} /></Field>
            <Field label="tipo (serviço)" htmlFor="ts"><Input id="ts" value={s.visionReturn.tipoServico} onChange={(e) => patch("visionReturn", { tipoServico: e.target.value })} /></Field>
            <Field label="Espécie (produto)" htmlFor="ep"><Input id="ep" value={s.visionReturn.especieProduto} onChange={(e) => patch("visionReturn", { especieProduto: e.target.value })} /></Field>
            <Field label="Espécie (serviço)" htmlFor="es"><Input id="es" value={s.visionReturn.especieServico} onChange={(e) => patch("visionReturn", { especieServico: e.target.value })} /></Field>
            <Field label="Modelo (produto)" htmlFor="mp"><Input id="mp" value={s.visionReturn.modeloProduto} onChange={(e) => patch("visionReturn", { modeloProduto: e.target.value })} /></Field>
            <Field label="Modelo (serviço)" htmlFor="ms"><Input id="ms" value={s.visionReturn.modeloServico} onChange={(e) => patch("visionReturn", { modeloServico: e.target.value })} /></Field>
            <Field label="Conta corrente padrão nas baixas" htmlFor="cc" hint="Código no Vision, usado sem de-para.">
              <Input id="cc" type="number" value={s.visionReturn.defaultCodigoContaCorrente ?? ""} onChange={(e) => patch("visionReturn", { defaultCodigoContaCorrente: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
          </div>
        </details>
      </Panel>

      <Panel>
        <PanelHeader
          title="Alertas no Slack"
          description="Avisos no canal da equipe quando uma rotina falha, quando pedidos entram em erro e quando uma nota é rejeitada. Novas tentativas do mesmo erro não repetem o aviso."
          actions={
            <Button type="button" variant="outline" onClick={() => testAlert.mutate()} disabled={testAlert.isPending || !env.slackConfigured}>
              {testAlert.isPending ? <Loader2 className="animate-spin" /> : <BellRing />} Enviar mensagem de teste
            </Button>
          }
        />
        <div className="grid gap-5 px-5 py-4">
          <div className="grid gap-1 text-[13px]">
            <p>
              Webhook do Slack:{" "}
              {env.slackConfigured ? "configurado" : <span className="font-semibold text-error">não configurado — defina SLACK_WEBHOOK_URL no servidor (Incoming Webhook do canal)</span>}
            </p>
            <p>Links nos alertas: {env.appBaseUrl ? <Mono>{env.appBaseUrl}</Mono> : <span className="text-muted-foreground">sem links para a plataforma (defina APP_BASE_URL)</span>}</p>
            {alertTest ? (
              <p className={`flex items-start gap-2 ${alertTest.ok ? "text-done" : "text-error"}`}>
                {alertTest.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
                {alertTest.message}
              </p>
            ) : null}
          </div>
          <ToggleRow id="alerts-enabled" label="Enviar alertas no Slack" checked={s.alerts.enabled} onChange={(enabled) => patch("alerts", { enabled })} />
          <div className={s.alerts.enabled ? "grid gap-5" : "grid gap-5 opacity-60"}>
            <ToggleRow id="alerts-job" label="Rotina com falha" description="Vision ou Omie fora do ar, credencial recusada ou erro geral na coleta, no envio ou no retorno." checked={s.alerts.onJobFailure} onChange={(onJobFailure) => patch("alerts", { onJobFailure })} />
            <ToggleRow id="alerts-orders" label="Pedidos que entraram em erro" description="Uma mensagem por execução, agrupada por causa, com link para cada pedido." checked={s.alerts.onOrderErrors} onChange={(onOrderErrors) => patch("alerts", { onOrderErrors })} />
            <ToggleRow id="alerts-rejection" label="Nota rejeitada" description="NF-e ou NFS-e rejeitada, com o motivo devolvido pela SEFAZ ou prefeitura." checked={s.alerts.onRejection} onChange={(onRejection) => patch("alerts", { onRejection })} />
            <Field label="Intervalo mínimo entre avisos de rotina com falha (minutos)" htmlFor="alerts-cooldown" error={err("alerts.cooldownMinutes")} hint="Evita uma mensagem a cada 5 minutos enquanto um sistema estiver fora do ar." className="max-w-sm">
              <Input id="alerts-cooldown" type="number" min={0} value={s.alerts.cooldownMinutes} onChange={(e) => patch("alerts", { cooldownMinutes: Number(e.target.value) })} />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Retenção de logs" description={`A limpeza roda todo dia às 03:17 (${env.timeZone}). O erro atual de cada pedido fica no próprio pedido, mesmo depois que os registros antigos saem da linha do tempo.`} />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
          <Field label="Linha do tempo e execuções (dias)" htmlFor="ret-logs" error={err("logs.retentionDays")} hint="Informações, avisos, chamadas às APIs e webhooks recebidos.">
            <Input id="ret-logs" type="number" min={7} value={s.logs.retentionDays} onChange={(e) => patch("logs", { retentionDays: Number(e.target.value) })} />
          </Field>
          <Field label="Registros de erro (dias)" htmlFor="ret-errors" error={err("logs.errorRetentionDays")} hint="Erros da linha do tempo e histórico de execuções.">
            <Input id="ret-errors" type="number" min={7} value={s.logs.errorRetentionDays} onChange={(e) => patch("logs", { errorRetentionDays: Number(e.target.value) })} />
          </Field>
          <Field label="Auditoria (dias)" htmlFor="ret-audit" error={err("logs.auditRetentionDays")} hint="Alterações de cadastro e ações manuais.">
            <Input id="ret-audit" type="number" min={30} value={s.logs.auditRetentionDays} onChange={(e) => patch("logs", { auditRetentionDays: Number(e.target.value) })} />
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Ambiente" description="Informações do servidor. Alteradas pelas variáveis de ambiente." />
        <dl className="grid grid-cols-[minmax(0,14rem)_1fr] gap-x-3 gap-y-2 px-5 py-4 text-[13px]">
          <dt className="text-muted-foreground">API do Omie</dt><dd><Mono>{env.omieApiUrl}</Mono></dd>
          <dt className="text-muted-foreground">Banco de dados</dt><dd>{env.database === "pglite" ? "PGlite embarcado (somente desenvolvimento)" : "PostgreSQL"}</dd>
          <dt className="text-muted-foreground">Fuso horário</dt><dd>{env.timeZone}</dd>
          <dt className="text-muted-foreground">Agendador interno</dt><dd>{env.schedulerEnabled ? "ligado" : "desligado (use um cron externo chamando POST /api/sync/run)"}</dd>
          <dt className="text-muted-foreground">Criptografia dos App Secrets</dt><dd>{env.encryptionKeyConfigured ? "chave própria configurada" : <span className="font-semibold text-rejected">chave de desenvolvimento — defina APP_ENCRYPTION_KEY em produção</span>}</dd>
          <dt className="text-muted-foreground">Webhook do Omie</dt><dd>{env.webhookEnabled ? <>ativo em <Mono>/api/webhooks/omie?token=…</Mono></> : "desligado (defina OMIE_WEBHOOK_TOKEN para ativar)"}</dd>
        </dl>
      </Panel>

      <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Button type="submit" size="lg" disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : null} Salvar configurações
        </Button>
      </div>
    </form>
  );
}

export default function SettingsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: () => api.get<SettingsResponse>("/api/settings") });
  return (
    <>
      <PageHeader title="Configurações" description="Coleta, novas tentativas, roteamento, condições de pagamento e convenções do retorno ao Vision." />
      {isLoading || !data ? <Skeleton className="h-[40rem]" /> : <SettingsForm key={JSON.stringify(data.settings)} initial={data.settings} data={data} />}
    </>
  );
}
