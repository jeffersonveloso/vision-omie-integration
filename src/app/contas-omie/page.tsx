"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, EyeOff, Loader2, MoreHorizontal, Pencil, Plug, Plus, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Label, Switch, Textarea } from "@/components/ui/form-controls";
import { EmptyState, Mono, Panel, Skeleton } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from "@/components/ui/overlays";
import { api, ApiError } from "@/lib/api";
import { formatRelative, maskCnpj } from "@/lib/format";
import type { PublicOmieAccount } from "@/server/modules/omie-accounts/domain/omie-account";

interface FormState {
  name: string;
  cnpj: string;
  appKey: string;
  appSecret: string;
  description: string;
  active: boolean;
}

const EMPTY: FormState = { name: "", cnpj: "", appKey: "", appSecret: "", description: "", active: true };

function AccountDialog({ account, open, onOpenChange }: { account: PublicOmieAccount | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const editing = Boolean(account);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);

  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm(account ? { name: account.name, cnpj: account.cnpjFormatted, appKey: account.appKey, appSecret: "", description: account.description ?? "", active: account.active } : EMPTY);
      setErrors({});
      setShowSecret(false);
    }
  }

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, appSecret: form.appSecret || null, description: form.description || null };
      return account ? api.put(`/api/omie-accounts/${account.id}`, body) : api.post("/api/omie-accounts", body);
    },
    onSuccess: () => {
      toast.success(editing ? "Conta atualizada" : "Conta cadastrada", { description: editing ? undefined : "Use Testar conexão para conferir as credenciais e o CNPJ." });
      void queryClient.invalidateQueries({ queryKey: ["omie-accounts"] });
      onOpenChange(false);
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
            <DialogTitle>{editing ? `Editar ${account?.name}` : "Nova conta Omie"}</DialogTitle>
            <DialogDescription>Os pedidos do Vision cuja empresa faturadora tem este CNPJ serão enviados para esta base.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label="Nome da base" htmlFor="name" error={errors.name}>
              <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ecolife Matriz" autoFocus aria-invalid={Boolean(errors.name)} />
            </Field>
            <Field label="CNPJ" htmlFor="cnpj" error={errors.cnpj} hint="Aceita o CNPJ numérico e o novo CNPJ alfanumérico.">
              <Input id="cnpj" value={form.cnpj} onChange={(e) => set("cnpj", maskCnpj(e.target.value))} placeholder="00.000.000/0000-00" inputMode="text" className="font-mono" aria-invalid={Boolean(errors.cnpj)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="App Key" htmlFor="appKey" error={errors.appKey}>
                <Input id="appKey" value={form.appKey} onChange={(e) => set("appKey", e.target.value.trim())} autoComplete="off" className="font-mono" aria-invalid={Boolean(errors.appKey)} />
              </Field>
              <Field label="App Secret" htmlFor="appSecret" error={errors.appSecret} hint={editing ? "Deixe em branco para manter o atual." : "Fica criptografado no banco."}>
                <div className="relative">
                  <Input
                    id="appSecret"
                    type={showSecret ? "text" : "password"}
                    value={form.appSecret}
                    onChange={(e) => set("appSecret", e.target.value.trim())}
                    autoComplete="new-password"
                    className="pr-10 font-mono"
                    placeholder={editing ? "••••••••••" : ""}
                    aria-invalid={Boolean(errors.appSecret)}
                  />
                  <button type="button" onClick={() => setShowSecret((v) => !v)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={showSecret ? "Ocultar App Secret" : "Mostrar App Secret"}>
                    {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
            </div>
            <Field label="Descrição" htmlFor="description" error={errors.description}>
              <Textarea id="description" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Ex.: base da filial de Pedro Leopoldo, emite NFS-e" className="min-h-20" />
            </Field>
            <div className="flex items-start gap-3 rounded-control border border-border bg-background/50 p-3">
              <Checkbox id="active" checked={form.active} onCheckedChange={(v) => set("active", Boolean(v))} className="mt-0.5" />
              <div>
                <Label htmlFor="active">Integração ativa</Label>
                <p className="text-[13px] text-muted-foreground">Desmarcada, os pedidos deste CNPJ ficam parados com erro de roteamento até a conta ser ativada.</p>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              {editing ? "Salvar alterações" : "Cadastrar conta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function OmieAccountsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PublicOmieAccount | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<PublicOmieAccount | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["omie-accounts"], queryFn: () => api.get<{ accounts: PublicOmieAccount[] }>("/api/omie-accounts") });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/api/omie-accounts/${id}`, { active }),
    onSuccess: (_r, v) => {
      toast.success(v.active ? "Integração ativada" : "Integração desativada");
      void queryClient.invalidateQueries({ queryKey: ["omie-accounts"] });
    },
    onError: (e) => toast.error("Não foi possível alterar", { description: e.message }),
  });
  const test = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; message: string }>(`/api/omie-accounts/${id}/test`),
    onSuccess: (r) => {
      if (r.ok) toast.success("Conexão OK", { description: r.message });
      else toast.error("Falha na conexão", { description: r.message });
      void queryClient.invalidateQueries({ queryKey: ["omie-accounts"] });
    },
    onError: (e) => toast.error("Falha na conexão", { description: e.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/omie-accounts/${id}`),
    onSuccess: () => {
      toast.success("Conta excluída");
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ["omie-accounts"] });
    },
    onError: (e) => toast.error("Não foi possível excluir", { description: e.message }),
  });

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Contas Omie"
        description="Cada conta é uma base Omie. O CNPJ da empresa faturadora no pedido do Vision decide para qual conta o pedido vai."
        actions={
          <Button onClick={openNew}>
            <Plus /> Nova conta
          </Button>
        }
      />
      <Panel>
        {isLoading ? (
          <div className="grid gap-2 p-5">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : !data?.accounts.length ? (
          <EmptyState
            title="Nenhuma conta cadastrada"
            description="Cadastre uma conta para cada CNPJ que fatura no Omie. Você vai precisar do App Key e do App Secret do aplicativo no Developer Omie."
            action={
              <Button onClick={openNew}>
                <Plus /> Cadastrar conta
              </Button>
            }
          />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[13px] text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="h-10 px-4 font-semibold">Base</th>
                  <th className="px-3 font-semibold">CNPJ</th>
                  <th className="px-3 font-semibold">App Key</th>
                  <th className="px-3 font-semibold">Última verificação</th>
                  <th className="px-3 font-semibold">Integração</th>
                  <th className="px-3">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3">
                      <span className="font-bold">{a.name}</span>
                      {a.description ? <span className="block max-w-[28rem] text-[13px] text-muted-foreground">{a.description}</span> : null}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <Mono>{a.cnpjFormatted}</Mono>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <Mono className="text-muted-foreground">{a.appKeyMasked}</Mono>
                    </td>
                    <td className="px-3 py-3">
                      {a.lastCheck ? (
                        <Tooltip content={a.lastCheck.message}>
                          <span className={`inline-flex items-center gap-1.5 text-[13px] ${a.lastCheck.ok ? "text-done" : "text-error"}`}>
                            {a.lastCheck.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                            {a.lastCheck.ok ? "Conectada" : "Falhou"} {formatRelative(a.lastCheck.at)}
                          </span>
                        </Tooltip>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">Nunca testada</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Switch checked={a.active} onCheckedChange={(active) => toggle.mutate({ id: a.id, active })} aria-label={`Integração ${a.active ? "ativa" : "inativa"} para ${a.name}`} />
                        <span className={`text-[13px] ${a.active ? "text-foreground" : "text-muted-foreground"}`}>{a.active ? "Ativa" : "Inativa"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <Button size="sm" variant="outline" onClick={() => test.mutate(a.id)} disabled={test.isPending && test.variables === a.id}>
                        {test.isPending && test.variables === a.id ? <Loader2 className="animate-spin" /> : <Plug />} Testar conexão
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" className="ml-1" aria-label={`Mais ações para ${a.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditing(a);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onSelect={() => setDeleting(a)}>
                            <Trash2 /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <AccountDialog account={editing} open={dialogOpen} onOpenChange={setDialogOpen} />

      <Dialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Excluir {deleting?.name}?</DialogTitle>
            <DialogDescription>As tabelas de-para e regras desta conta também serão excluídas. Pedidos já enviados continuam no histórico, mas novos pedidos deste CNPJ vão parar com erro de roteamento.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => deleting && remove.mutate(deleting.id)} disabled={remove.isPending}>
              {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />} Excluir conta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
