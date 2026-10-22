/** Portas transversais (Dependency Inversion): a aplicação depende destas abstrações, nunca de implementações. */

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface SecretCipher {
  encrypt(plain: string): string;
  decrypt(cipherText: string): string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppLogger {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface UseCase<Input, Output> {
  execute(input: Input): Promise<Output>;
}

export const systemClock: Clock = { now: () => new Date() };

export const uuidGenerator: IdGenerator = { next: () => crypto.randomUUID() };
