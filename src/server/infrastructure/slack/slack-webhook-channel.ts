import type { AlertChannel, AlertMessage } from "@/server/modules/alerts/application/alert-channel";

const EMOJI = { error: ":rotating_light:", warning: ":warning:", info: ":white_check_mark:" } as const;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Corpo do Incoming Webhook (Block Kit) com texto simples de fallback para notificações. */
export function toSlackPayload(message: AlertMessage) {
  const body = message.lines.join("\n");
  const blocks: Array<Record<string, unknown>> = [
    { type: "header", text: { type: "plain_text", text: clip(`${EMOJI[message.severity]} ${message.title}`, 150), emoji: true } },
  ];
  if (body) blocks.push({ type: "section", text: { type: "mrkdwn", text: clip(body, 2900) } });
  if (message.action) blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: clip(message.action.label, 75) }, url: message.action.url }] });
  if (message.footer) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: clip(message.footer, 300) }] });
  return { text: clip(`${message.title}${body ? `\n${body}` : ""}`, 3000), blocks };
}

/** Alertas por Incoming Webhook do Slack (https://api.slack.com/messaging/webhooks). */
export class SlackWebhookChannel implements AlertChannel {
  readonly name = "Slack";

  constructor(
    private readonly webhookUrl: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  get configured(): boolean {
    return Boolean(this.webhookUrl);
  }

  escape(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  link(url: string, text: string): string {
    return `<${url}|${this.escape(text).replace(/\|/g, "/")}>`;
  }

  async send(message: AlertMessage): Promise<void> {
    if (!this.webhookUrl) throw new Error("SLACK_WEBHOOK_URL não está configurada no servidor.");
    const response = await this.fetchImpl(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toSlackPayload(message)),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(`O Slack recusou a mensagem (HTTP ${response.status}${detail ? `: ${detail}` : ""}).`);
    }
  }
}
