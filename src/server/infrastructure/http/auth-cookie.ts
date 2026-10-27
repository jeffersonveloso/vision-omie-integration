/**
 * Cookie da sessão do login próprio. Sem dependências do servidor: o `proxy.ts` também usa o nome.
 * O cookie é httpOnly (o JavaScript da página não lê), SameSite=Lax (não vai em POST de outro site) e
 * Secure quando a aplicação está em HTTPS.
 */
export const SESSION_COOKIE = "vo_session";

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

export function sessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  return [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Expires=${expiresAt.toUTCString()}`, secure ? "Secure" : null].filter(Boolean).join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT", secure ? "Secure" : null].filter(Boolean).join("; ");
}

/** HTTPS direto ou atrás de um proxy que informa `X-Forwarded-Proto: https`. */
export function isHttpsRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return new URL(request.url).protocol === "https:";
}
