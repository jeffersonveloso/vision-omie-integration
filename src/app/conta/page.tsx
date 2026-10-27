"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";
import { Panel, PanelHeader, Skeleton } from "@/components/ui/misc";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";

const MIN_LENGTH = 10;

/** Minha conta: dados de quem está logado e troca de senha (obrigatória no primeiro acesso). */
export default function AccountPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useSession();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const user = data?.user;
  const mustChange = Boolean(user?.mustChangePassword);

  const set = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.newPassword !== form.confirm) {
      setErrors({ confirm: "A confirmação não é igual à nova senha." });
      return;
    }
    setPending(true);
    try {
      await api.post("/api/auth/password", { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      toast.success("Senha trocada", { description: "As suas outras sessões foram encerradas." });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      if (mustChange) window.location.assign("/");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      else toast.error("Não foi possível trocar a senha", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setPending(false);
    }
  };

  if (isLoading) return <Skeleton className="h-64" />;
  if (data?.mode === "proxy") {
    return (
      <>
        <PageHeader title="Minha conta" />
        <Panel className="p-5">
          <p>
            Você entrou pelo proxy de autenticação{user?.email ? ` como ${user.email}` : ""}. Senha e acesso são gerenciados lá.
          </p>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Minha conta" description={user ? `${user.name} · ${user.email} · ${user.roleLabel}` : undefined} />
      {mustChange ? (
        <p role="status" className="mb-4 max-w-[40rem] rounded-control border border-rejected/40 bg-rejected-soft px-4 py-3 text-[14px]">
          Você entrou com uma senha temporária. Escolha uma senha sua para continuar usando a aplicação.
        </p>
      ) : null}
      <Panel className="max-w-[40rem]">
        <PanelHeader title="Trocar senha" description={`Pelo menos ${MIN_LENGTH} caracteres. Ao trocar, as suas sessões em outros navegadores são encerradas.`} />
        <form onSubmit={submit} className="grid gap-4 p-5">
          <Field label={mustChange ? "Senha temporária" : "Senha atual"} htmlFor="currentPassword" error={errors.currentPassword}>
            <Input id="currentPassword" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => set("currentPassword", e.target.value)} aria-invalid={Boolean(errors.currentPassword)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nova senha" htmlFor="newPassword" error={errors.newPassword}>
              <Input id="newPassword" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => set("newPassword", e.target.value)} aria-invalid={Boolean(errors.newPassword)} />
            </Field>
            <Field label="Confirme a nova senha" htmlFor="confirm" error={errors.confirm}>
              <Input id="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} aria-invalid={Boolean(errors.confirm)} />
            </Field>
          </div>
          <div>
            <Button type="submit" disabled={pending || !form.currentPassword || form.newPassword.length < MIN_LENGTH}>
              {pending ? <Loader2 className="animate-spin" /> : null} Trocar senha
            </Button>
          </div>
        </form>
      </Panel>
    </>
  );
}
