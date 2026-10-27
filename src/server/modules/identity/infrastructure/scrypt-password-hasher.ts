import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { PasswordHasher } from "../domain/user";

const scryptAsync = (password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number; maxmem: number }) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key))));

/**
 * Hash de senha com scrypt (memory-hard, nativo do Node, sem dependência extra).
 * Formato: `scrypt$N$r$p$salt$hash` (base64url), para dar para subir o custo no futuro sem invalidar
 * as senhas já gravadas.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  constructor(private readonly params: { N: number; r: number; p: number } = { N: 2 ** 15, r: 8, p: 1 }) {}

  async hash(password: string): Promise<string> {
    const { N, r, p } = this.params;
    const salt = randomBytes(16);
    const key = await scryptAsync(password.normalize("NFKC"), salt, 32, { N, r, p, maxmem: 256 * N * r });
    return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [scheme, n, r, p, salt, hash] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const N = Number(n);
    const R = Number(r);
    const P = Number(p);
    if (![N, R, P].every((v) => Number.isInteger(v) && v > 0)) return false;
    const expected = Buffer.from(hash, "base64url");
    const key = await scryptAsync(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, { N, r: R, p: P, maxmem: 256 * N * R });
    return key.length === expected.length && timingSafeEqual(key, expected);
  }
}
