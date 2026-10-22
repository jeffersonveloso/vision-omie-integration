/** Mensagem de alerta independente do canal (hoje Slack; e-mail ou Teams entram com outro adaptador). */
export interface AlertMessage {
  severity: "error" | "warning" | "info";
  title: string;
  /** Linhas em formato de lista. Links no formato do canal são montados pelo serviço (`link()`). */
  lines: string[];
  footer?: string;
  action?: { label: string; url: string };
}

export interface AlertChannel {
  readonly name: string;
  readonly configured: boolean;
  /** Link no formato do canal (Slack: `<url|texto>`). */
  link(url: string, text: string): string;
  /** Escapa texto livre (mensagens de erro, nomes) para o formato do canal. */
  escape(text: string): string;
  send(message: AlertMessage): Promise<void>;
}
