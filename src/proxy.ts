import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/infrastructure/http/auth-cookie";

/**
 * Checagem rápida do login próprio (AUTH_MODE=local): sem o cookie da sessão, as telas vão para /login.
 * É só um filtro: quem valida a sessão de verdade (no banco) são as rotas /api, que entregam os dados.
 */
export function proxy(request: NextRequest) {
  if (process.env.AUTH_MODE?.trim().toLowerCase() === "proxy") return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname === "/login" || request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  // Telas apenas: /api tem a própria autenticação; arquivos estáticos ficam de fora.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|txt)$).*)"],
};
