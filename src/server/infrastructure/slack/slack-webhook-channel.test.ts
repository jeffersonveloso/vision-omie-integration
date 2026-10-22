import { describe, expect, it } from "vitest";
import { SlackWebhookChannel, toSlackPayload } from "./slack-webhook-channel";

describe("canal Slack", () => {
  it("monta o Block Kit com cabeçalho, lista, botão e rodapé", () => {
    const payload = toSlackPayload({ severity: "warning", title: "2 pedidos entraram em erro", lines: ["Mapeamento: 2", "• a", "• b"], footer: "rodapé", action: { label: "Abrir", url: "https://app/pedidos" } });
    expect(payload.text).toContain("2 pedidos entraram em erro");
    expect(payload.blocks.map((b) => b.type)).toEqual(["header", "section", "actions", "context"]);
    expect(JSON.stringify(payload.blocks[0])).toContain(":warning:");
  });

  it("escapa texto livre e monta links", () => {
    const channel = new SlackWebhookChannel("https://hooks.slack.test/x");
    expect(channel.escape("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
    expect(channel.link("https://app/pedidos/1", "Pedido <1|2>")).toBe("<https://app/pedidos/1|Pedido &lt;1/2&gt;>");
  });

  it("envia por POST e explica quando o Slack recusa", async () => {
    const sent: Array<{ url: string; body: unknown }> = [];
    let status = 200;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(status === 200 ? "ok" : "invalid_payload", { status });
    }) as typeof fetch;
    const channel = new SlackWebhookChannel("https://hooks.slack.test/x", fetchImpl);
    await channel.send({ severity: "info", title: "Teste", lines: [] });
    expect(sent[0].url).toBe("https://hooks.slack.test/x");
    status = 400;
    await expect(channel.send({ severity: "info", title: "Teste", lines: [] })).rejects.toThrow("HTTP 400: invalid_payload");
    await expect(new SlackWebhookChannel(undefined).send({ severity: "info", title: "x", lines: [] })).rejects.toThrow("SLACK_WEBHOOK_URL");
  });
});
