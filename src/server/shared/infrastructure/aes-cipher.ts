import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SecretCipher } from "@/server/shared/application/ports";

/**
 * AES-256-GCM para segredos em repouso (App Secret do Omie).
 * Formato: `v1:<iv b64>:<tag b64>:<cipher b64>`.
 */
export class AesGcmCipher implements SecretCipher {
  private readonly key: Buffer;

  constructor(rawKey: string | undefined, onInsecureKey?: () => void) {
    if (rawKey) {
      const decoded = Buffer.from(rawKey, "base64");
      this.key = decoded.length === 32 ? decoded : createHash("sha256").update(rawKey).digest();
    } else {
      onInsecureKey?.();
      this.key = createHash("sha256").update("vision-omie-dev-only-key").digest();
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
  }

  decrypt(value: string): string {
    const [version, iv, tag, data] = value.split(":");
    if (version !== "v1" || !iv || !tag || !data) throw new Error("Segredo em formato desconhecido.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  }
}
