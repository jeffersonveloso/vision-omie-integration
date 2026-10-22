import type { AppLogger, Clock } from "@/server/shared/application/ports";
import { addMinutes } from "@/server/shared/domain/dates";
import type { RunNotice, RunNotifier } from "@/server/modules/integration/application/ports";
import { ERROR_CATEGORY_LABELS, type ErrorCategory } from "@/server/modules/integration/domain/integration-error";
import type { CheckpointRepository } from "@/server/modules/integration/domain/repositories";
import type { SettingsRepository } from "@/server/modules/settings/domain/integration-settings";
import type { AlertChannel, AlertMessage } from "./alert-channel";

const JOB_LABEL = { SYNC: "Coleta e envio (Vision → Omie)", RECONCILE: "Retorno ao Vision (Omie → Vision)", RETRY: "Novas tentativas" } as const;
const MAX_LINES = 10;
const COOLDOWN_KEY = (key: string) => `alerts.cooldown.${key}`;

/**
 * Regras dos alertas (Configurações › Alertas no Slack):
 *  - rotina com falha (Vision/Omie fora do ar, erro geral) — no máximo um aviso igual a cada `cooldownMinutes`;
 *  - pedidos que entraram em erro na execução — novas tentativas do mesmo erro não repetem o aviso;
 *  - notas que passaram a ser rejeitadas.
 * Falhar ao avisar nunca interrompe a integração: vira log de erro.
 */
export class AlertService implements RunNotifier {
  constructor(
    private readonly deps: {
      channel: AlertChannel;
      settings: SettingsRepository;
      checkpoints: CheckpointRepository;
      clock: Clock;
      logger: AppLogger;
      timeZone: string;
      appBaseUrl: string | null;
    },
  ) {}

  get configured(): boolean {
    return this.deps.channel.configured;
  }

  async notifyRun(notice: RunNotice): Promise<void> {
    try {
      const { alerts } = await this.deps.settings.get();
      if (!alerts.enabled || !this.deps.channel.configured) return;
      const messages: AlertMessage[] = [];
      if (alerts.onJobFailure && notice.run.error && (await this.passCooldown(`job.${notice.run.job}`, alerts.cooldownMinutes))) messages.push(this.jobFailure(notice));
      if (alerts.onOrderErrors && notice.failures.length) messages.push(this.orderErrors(notice));
      if (alerts.onRejection && notice.rejections.length) messages.push(this.rejections(notice));
      for (const message of messages) await this.deps.channel.send(message);
    } catch (error) {
      this.deps.logger.error("Falha ao enviar alerta", { channel: this.deps.channel.name, runId: notice.run.id, error: String(error) });
    }
  }

  /** Mensagem de teste do botão em Configurações. Lança erro para a tela mostrar o motivo. */
  async sendTest(actor: string | null): Promise<void> {
    await this.deps.channel.send({
      severity: "info",
      title: "Teste de alerta da integração Vision ⇄ Omie",
      lines: [`Os alertas desta integração chegam neste canal.${actor ? ` Teste enviado por ${this.deps.channel.escape(actor)}.` : ""}`],
      footer: this.footer(),
      action: this.url("/configuracoes") ? { label: "Abrir configurações", url: this.url("/configuracoes")! } : undefined,
    });
  }

  private jobFailure(notice: RunNotice): AlertMessage {
    const { run } = notice;
    return {
      severity: "error",
      title: `${JOB_LABEL[run.job]} com falha`,
      lines: [this.deps.channel.escape(run.error ?? "Falha sem descrição."), run.status === "PARTIAL" ? "Os pedidos que já estavam na fila foram processados." : "Nenhum pedido foi processado nesta execução."],
      footer: this.footer(run.id),
      action: this.url("/execucoes") ? { label: "Ver execuções", url: this.url("/execucoes")! } : undefined,
    };
  }

  private orderErrors(notice: RunNotice): AlertMessage {
    const { failures } = notice;
    const byCategory = new Map<ErrorCategory, number>();
    for (const f of failures) byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
    const summary = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${ERROR_CATEGORY_LABELS[c]}: ${n}`).join(" · ");
    const lines = failures.slice(0, MAX_LINES).map((f) => `• ${this.orderRef(f.orderId, f.visionOrderCode)} — *${ERROR_CATEGORY_LABELS[f.category]}*: ${this.deps.channel.escape(f.message)}`);
    if (failures.length > MAX_LINES) lines.push(`… e mais ${failures.length - MAX_LINES} pedido(s).`);
    return {
      severity: "warning",
      title: failures.length === 1 ? `Pedido ${failures[0].visionOrderCode} entrou em erro` : `${failures.length} pedidos entraram em erro`,
      lines: [summary, ...lines],
      footer: this.footer(notice.run.id),
      action: this.url("/pedidos?status=ERROR") ? { label: "Abrir pedidos com erro", url: this.url("/pedidos?status=ERROR")! } : undefined,
    };
  }

  private rejections(notice: RunNotice): AlertMessage {
    const { rejections } = notice;
    const lines = rejections.slice(0, MAX_LINES).map((r) => `• ${this.orderRef(r.orderId, r.visionOrderCode)} — ${this.deps.channel.escape(r.message)}`);
    if (rejections.length > MAX_LINES) lines.push(`… e mais ${rejections.length - MAX_LINES} nota(s).`);
    return {
      severity: "warning",
      title: rejections.length === 1 ? `Nota do pedido ${rejections[0].visionOrderCode} rejeitada` : `${rejections.length} notas rejeitadas`,
      lines: [...lines, "O motivo já foi devolvido ao Vision. Corrija o pedido e reenvie pela plataforma."],
      footer: this.footer(notice.run.id),
      action: this.url("/pedidos?status=REJECTED") ? { label: "Abrir notas rejeitadas", url: this.url("/pedidos?status=REJECTED")! } : undefined,
    };
  }

  private orderRef(orderId: string, code: number): string {
    const url = this.url(`/pedidos/${orderId}`);
    return url ? this.deps.channel.link(url, `Pedido ${code}`) : `*Pedido ${code}*`;
  }

  private url(path: string): string | null {
    return this.deps.appBaseUrl ? `${this.deps.appBaseUrl}${path}` : null;
  }

  private footer(runId?: string): string {
    const when = new Intl.DateTimeFormat("pt-BR", { timeZone: this.deps.timeZone, dateStyle: "short", timeStyle: "short" }).format(this.deps.clock.now());
    return `Integração Vision ⇄ Omie · ${when}${runId ? ` · execução ${runId.slice(0, 8)}` : ""}`;
  }

  /** true se o aviso pode sair agora; já registra o horário para os próximos. */
  private async passCooldown(key: string, minutes: number): Promise<boolean> {
    if (minutes <= 0) return true;
    const now = this.deps.clock.now();
    const last = await this.deps.checkpoints.get<{ at: string }>(COOLDOWN_KEY(key));
    if (last && addMinutes(new Date(last.at), minutes) > now) return false;
    await this.deps.checkpoints.set(COOLDOWN_KEY(key), { at: now.toISOString() });
    return true;
  }
}
