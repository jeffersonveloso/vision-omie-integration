"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Switch } from "@/components/ui/form-controls";
import { EmptyState, Mono, Panel, Skeleton } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/overlays";
import { api, ApiError } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useSession } from "@/lib/session";
import { USER_ROLE_DESCRIPTIONS, USER_ROLE_LABELS, USER_ROLES, type UserRole, type UserView } from "@/server/modules/identity/domain/user";

type Row = Omit<UserView, "lastLoginAt" | "createdAt"> & { lastLoginAt: string | null; createdAt: string };

interface FormState {
  name: string;
  email: string;
  role: UserRole;
  password: string;
}

const EMPTY: FormState = { name: "", email: "", role: "OPERATOR", password: "" };

function UserDialog({ user, open, onOpenChange, onCreated }: { user: Row | null; open: boolean; onOpenChange: (v: boolean) => void; onCreated: (r: { user: Row; temporaryPassword: string | null }) => void }) {
  const queryClient = useQueryClient();
  const editing = Boolean(user);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastOpen, setLastOpen] = useState(false);

  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm(user ? { name: user.name, email: user.email, role: user.role, password: "" } : EMPTY);
      setErrors({});
    }
  }

  const save = useMutation({
    mutationFn: () =>
      user
        ? api.patch<{ user: Row }>(`/api/users/${user.id}`, { name: form.name, role: form.role }).then((r) => ({ user: r.user, temporaryPassword: null }))
        : api.post<{ user: Row; temporaryPassword: string | null }>("/api/users", { name: form.name, email: form.email, role: form.role, password: form.password || undefined }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      onOpenChange(false);
      if (editing) toast.success("Usuário atualizado");
      else onCreated(result);
    },
    onError: (error) => {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length) setErrors(error.fieldErrors);
      else toast.error("Não foi possível salvar", { description: error.message });
    },
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? `Editar ${user?.name}` : "Novo usuário"}</DialogTitle>
            <DialogDescription>{editing ? "O e-mail não muda. Para tirar o acesso, desative o usuário na lista." : "A pessoa entra com o e-mail e uma senha temporária, e troca a senha no primeiro acesso."}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label="Nome" htmlFor="name" error={errors.name}>
              <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus aria-invalid={Boolean(errors.name)} />
            </Field>
            {editing ? null : (
              <Field label="E-mail" htmlFor="email" error={errors.email}>
                <Input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="off" aria-invalid={Boolean(errors.email)} />
              </Field>
            )}
            <Field label="Perfil" htmlFor="role" error={errors.role} hint={USER_ROLE_DESCRIPTIONS[form.role]}>
              <NativeSelect id="role" value={form.role} onChange={(e) => set("role", e.target.value as UserRole)}>
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {USER_ROLE_LABELS[r]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {editing ? null : (
              <Field label="Senha temporária" htmlFor="password" error={errors.password} hint="Deixe em branco para a aplicação gerar uma. Mínimo de 10 caracteres.">
                <Input id="password" type="text" value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" className="font-mono" aria-invalid={Boolean(errors.password)} />
              </Field>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              {editing ? "Salvar alterações" : "Cadastrar usuário"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Mostra a senha temporária uma única vez, para o administrador repassar. */
function TemporaryPasswordDialog({ value, onClose }: { value: { user: Row; password: string } | null; onClose: () => void }) {
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value.password);
      toast.success("Senha copiada");
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie a senha.");
    }
  };
  return (
    <Dialog open={Boolean(value)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Senha temporária de {value?.user.name}</DialogTitle>
          <DialogDescription>Ela aparece só agora. Repasse por um canal seguro: no primeiro acesso, {value?.user.name.split(" ")[0]} vai escolher uma senha própria.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <p className="text-[13px] text-muted-foreground">
            E-mail: <Mono>{value?.user.email}</Mono>
          </p>
          <div className="flex items-center gap-2">
            <Input readOnly value={value?.password ?? ""} className="font-mono text-[15px]" aria-label="Senha temporária" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" variant="outline" onClick={copy}>
              <Copy /> Copiar
            </Button>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Pronto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const [editing, setEditing] = useState<Row | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resetting, setResetting] = useState<Row | null>(null);
  const [temporary, setTemporary] = useState<{ user: Row; password: string } | null>(null);
  const isAdmin = session?.mode === "local" && session.user?.role === "ADMIN";
  const { data, isLoading, error } = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ users: Row[] }>("/api/users"), enabled: isAdmin });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/api/users/${id}`, { active }),
    onSuccess: (_r, v) => {
      toast.success(v.active ? "Usuário reativado" : "Usuário desativado", { description: v.active ? undefined : "As sessões abertas dele foram encerradas." });
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error("Não foi possível alterar", { description: e.message }),
  });
  const reset = useMutation({
    mutationFn: (id: string) => api.post<{ user: Row; temporaryPassword: string }>(`/api/users/${id}/reset-password`),
    onSuccess: (r) => {
      setResetting(null);
      setTemporary({ user: r.user, password: r.temporaryPassword });
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error("Não foi possível gerar a senha", { description: e.message }),
  });

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  if (session && !isAdmin) {
    return (
      <>
        <PageHeader title="Usuários" />
        <Panel>
          <EmptyState
            title={session.mode === "proxy" ? "Os usuários ficam no proxy de autenticação" : "Só administradores cadastram usuários"}
            description={session.mode === "proxy" ? "Com AUTH_MODE=proxy quem entra é definido no proxy (oauth2-proxy, Cloudflare Access)." : "Peça a um administrador para incluir ou alterar usuários."}
          />
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Quem pode entrar na integração. Administradores também cadastram usuários; operadores fazem todo o resto."
        actions={
          <Button onClick={openNew}>
            <Plus /> Novo usuário
          </Button>
        }
      />
      <Panel>
        {isLoading || !session ? (
          <div className="grid gap-2 p-5">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : error ? (
          <EmptyState title="Não foi possível carregar os usuários" description={error.message} />
        ) : !data?.users.length ? (
          <EmptyState title="Nenhum usuário" action={<Button onClick={openNew}><Plus /> Cadastrar usuário</Button>} />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[13px] text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="h-10 px-4 font-semibold">Nome</th>
                  <th className="px-3 font-semibold">Perfil</th>
                  <th className="px-3 font-semibold">Último acesso</th>
                  <th className="px-3 font-semibold">Acesso</th>
                  <th className="px-3">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => {
                  const self = u.id === session?.user?.id;
                  return (
                    <tr key={u.id} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-3">
                        <span className="font-bold">{u.name}</span>
                        {self ? <span className="text-muted-foreground"> (você)</span> : null}
                        <span className="block text-[13px] text-muted-foreground">{u.email}</span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{u.roleLabel}</td>
                      <td className="px-3 py-3 text-[13px]">
                        {u.lastLoginAt ? formatRelative(u.lastLoginAt) : <span className="text-muted-foreground">Nunca entrou</span>}
                        {u.locked ? <span className="block font-semibold text-rejected">Bloqueado por tentativas erradas</span> : u.mustChangePassword ? <span className="block text-muted-foreground">Senha temporária pendente</span> : null}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <Switch checked={u.active} disabled={self} onCheckedChange={(active) => toggle.mutate({ id: u.id, active })} aria-label={`Acesso de ${u.name}: ${u.active ? "ativo" : "desativado"}`} />
                          <span className={`text-[13px] ${u.active ? "text-foreground" : "text-muted-foreground"}`}>{u.active ? "Ativo" : "Desativado"}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon-sm" variant="ghost" aria-label={`Mais ações para ${u.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onSelect={() => {
                                setEditing(u);
                                setDialogOpen(true);
                              }}
                            >
                              <Pencil /> Editar
                            </DropdownMenuItem>
                            {self ? null : (
                              <DropdownMenuItem onSelect={() => setResetting(u)}>
                                <KeyRound /> Gerar senha temporária
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <UserDialog
        user={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(r) => {
          if (r.temporaryPassword) setTemporary({ user: r.user, password: r.temporaryPassword });
          else toast.success("Usuário cadastrado", { description: "Ele troca a senha no primeiro acesso." });
        }}
      />
      <TemporaryPasswordDialog value={temporary} onClose={() => setTemporary(null)} />

      <Dialog open={Boolean(resetting)} onOpenChange={(v) => !v && setResetting(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Gerar senha temporária para {resetting?.name}?</DialogTitle>
            <DialogDescription>A senha atual deixa de valer, as sessões abertas são encerradas e o bloqueio por tentativas erradas, se houver, é retirado.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetting(null)}>
              Cancelar
            </Button>
            <Button onClick={() => resetting && reset.mutate(resetting.id)} disabled={reset.isPending}>
              {reset.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />} Gerar senha
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
