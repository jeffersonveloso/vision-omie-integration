import type { AppLogger, LogLevel } from "@/server/shared/application/ports";

/** Logger estruturado (JSON por linha) — fácil de coletar em Loki/CloudWatch/Datadog. */
export class ConsoleLogger implements AppLogger {
  constructor(private readonly context: string) {}

  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, context: this.context, message, ...(meta ?? {}) });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }
}
