"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";

/** Só caminhos internos: evita usar o ?next= para mandar o usuário para outro site. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") && !value.startsWith("/login") ? value : "/";
}

function LoginForm() {
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { data: session } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  // Já logado, ou login feito pelo proxy: não há o que fazer aqui.
  useEffect(() => {
    if (session?.mode === "proxy" || session?.user) window.location.replace(session?.user?.mustChangePassword ? "/conta" : next);
  }, [session, next]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const { user } = await api.post<{ user: { mustChangePassword: boolean } }>("/api/auth/login", { email, password });
      queryClient.clear();
      window.location.replace(user.mustChangePassword ? "/conta" : next);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setFieldErrors(e.fieldErrors);
      else setError(e instanceof Error ? e.message : "Não foi possível entrar.");
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <Field label="E-mail" htmlFor="email" error={fieldErrors.email}>
        <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required aria-invalid={Boolean(fieldErrors.email)} />
      </Field>
      <Field label="Senha" htmlFor="password" error={fieldErrors.password}>
        <div className="relative">
          <Input id="password" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="pr-10" aria-invalid={Boolean(fieldErrors.password)} />
          <button type="button" onClick={() => setShow((v) => !v)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={show ? "Ocultar senha" : "Mostrar senha"}>
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>
      {error ? (
        <p role="alert" className="rounded-control border border-error/30 bg-error-soft px-3 py-2 text-[13px] text-error">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="mt-1">
        {pending ? <Loader2 className="animate-spin" /> : null} Entrar
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-nav px-4 py-10">
      <div className="w-full max-w-[24rem]">
        <div className="mb-6 flex items-center gap-2.5 text-nav-foreground">
          <span className="flex size-9 items-center justify-center rounded-[8px] bg-[#e7f2ee] text-nav">
            <ArrowLeftRight className="size-4" strokeWidth={2.5} />
          </span>
          <span className="leading-tight">
            <span className="block text-[17px] font-bold">Vision ⇄ Omie</span>
            <span className="block text-[13px] text-nav-muted">Integração Ecolife</span>
          </span>
        </div>
        <section className="rounded-panel border border-border bg-surface p-6 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.6)]">
          <h1 className="mb-1 text-[22px] font-bold">Entrar</h1>
          <p className="mb-5 text-[13px] text-muted-foreground">Use o e-mail e a senha que o administrador cadastrou para você.</p>
          <Suspense fallback={<Loader2 className="size-5 animate-spin text-muted-foreground" />}>
            <LoginForm />
          </Suspense>
        </section>
        <p className="mt-4 text-[13px] text-nav-muted">Esqueceu a senha? Peça a um administrador uma senha temporária.</p>
      </div>
    </main>
  );
}
