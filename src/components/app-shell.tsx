"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Building2, ClipboardList, Cog, FileClock, Gauge, History, LogOut, Menu, UserRound, UsersRound, Waypoints, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Painel", icon: Gauge },
  { href: "/pedidos", label: "Pedidos", icon: ClipboardList },
  { href: "/mapeamentos", label: "Mapeamentos", icon: Waypoints },
  { href: "/contas-omie", label: "Contas Omie", icon: Building2 },
  { href: "/execucoes", label: "Execuções", icon: History },
  { href: "/auditoria", label: "Auditoria", icon: FileClock },
  { href: "/configuracoes", label: "Configurações", icon: Cog },
];
/** Só para administradores do login próprio. */
const ADMIN_NAV = [{ href: "/usuarios", label: "Usuários", icon: UsersRound }];

interface Health {
  /** Só vem para quem está logado. */
  scheduler?: { running: boolean; jobs: Array<{ name: string; enabled: boolean; nextRunAt: string | null; busy: boolean }> };
}

function SchedulerStatus() {
  const { data } = useQuery({ queryKey: ["health"], queryFn: () => api.get<Health>("/api/health"), refetchInterval: 30_000 });
  const sync = data?.scheduler?.jobs.find((j) => j.name === "sync");
  const reconcile = data?.scheduler?.jobs.find((j) => j.name === "reconcile");
  const line = (label: string, job?: NonNullable<Health["scheduler"]>["jobs"][number]) =>
    !data?.scheduler?.running ? "agendador parado" : !job?.enabled ? "desligada" : job.busy ? "rodando agora" : `próxima ${formatRelative(job.nextRunAt)}`;
  return (
    <div className="grid gap-1 border-t border-white/10 px-4 py-4 text-[12px] text-nav-muted">
      <div className="flex items-center gap-2">
        <span className={cn("size-1.5 rounded-full", data?.scheduler?.running ? "bg-[#7fd1a0]" : "bg-[#e0a24c]")} />
        <span className="text-nav-foreground">Coleta e envio</span>
      </div>
      <span className="pl-3.5">{line("sync", sync)}</span>
      <div className="mt-1 flex items-center gap-2">
        <span className={cn("size-1.5 rounded-full", data?.scheduler?.running && reconcile?.enabled ? "bg-[#7fd1a0]" : "bg-[#e0a24c]")} />
        <span className="text-nav-foreground">Retorno ao Vision</span>
      </div>
      <span className="pl-3.5">{line("reconcile", reconcile)}</span>
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const items = session?.mode === "local" && session.user?.role === "ADMIN" ? [...NAV, ...ADMIN_NAV] : NAV;
  return (
    <nav className="grid gap-0.5 px-2">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-control px-3 py-2 text-[14px] text-nav-foreground/85 transition-colors hover:bg-white/5 hover:text-nav-foreground",
              active && "bg-nav-active font-semibold text-nav-foreground",
            )}
          >
            <Icon className="size-[18px] opacity-80" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-5 py-5 text-nav-foreground">
      <span className="flex size-8 items-center justify-center rounded-[7px] bg-[#e7f2ee] text-nav">
        <ArrowLeftRight className="size-4" strokeWidth={2.5} />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-bold">Vision ⇄ Omie</span>
        <span className="block text-[12px] text-nav-muted">Integração Ecolife</span>
      </span>
    </Link>
  );
}

/** Quem está logado, com Minha conta e Sair (no login próprio). */
function UserBox({ onNavigate }: { onNavigate?: () => void }) {
  const queryClient = useQueryClient();
  const { data } = useSession();
  const [leaving, setLeaving] = useState(false);
  const user = data?.user;
  if (!user) return null;
  const logout = async () => {
    setLeaving(true);
    try {
      await api.post("/api/auth/logout");
    } finally {
      queryClient.clear();
      window.location.assign("/login");
    }
  };
  return (
    <div className="grid gap-2 border-t border-white/10 px-4 py-3 text-[13px]">
      <div className="min-w-0">
        <p className="truncate font-semibold text-nav-foreground" title={user.email ?? undefined}>
          {user.name}
        </p>
        <p className="truncate text-[12px] text-nav-muted">{user.roleLabel}</p>
      </div>
      {data?.mode === "local" && user.id ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/conta" onClick={onNavigate} className="inline-flex items-center gap-1.5 text-nav-foreground/85 hover:text-nav-foreground">
            <UserRound className="size-3.5" /> Minha conta
          </Link>
          <button type="button" onClick={logout} disabled={leaving} className="inline-flex items-center gap-1.5 text-nav-foreground/85 hover:text-nav-foreground disabled:opacity-60">
            <LogOut className="size-3.5" /> Sair
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Sem sessão válida (cookie vencido), volta para o login. */
function SessionGuard() {
  const pathname = usePathname();
  const { error } = useSession();
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401 && pathname !== "/login") {
      window.location.assign(`/login${pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`}`);
    }
    if (error instanceof ApiError && error.code === "PASSWORD_CHANGE_REQUIRED" && pathname !== "/conta") window.location.assign("/conta");
  }, [error, pathname]);
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  // A tela de login não tem menu.
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-nav lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto pt-2">
          <NavLinks />
        </div>
        <SchedulerStatus />
        <UserBox />
      </aside>
      <SessionGuard />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-between bg-nav px-4 py-2 lg:hidden">
          <Link href="/" className="text-[15px] font-bold text-nav-foreground">
            Vision ⇄ Omie
          </Link>
          <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-control p-2 text-nav-foreground" aria-label={open ? "Fechar menu" : "Abrir menu"} aria-expanded={open}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </header>
        {open ? (
          <div className="fixed inset-x-0 top-[52px] z-40 bg-nav pb-3 shadow-xl lg:hidden">
            <NavLinks onNavigate={() => setOpen(false)} />
            <UserBox onNavigate={() => setOpen(false)} />
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.01em]">{title}</h1>
        {description ? <p className="mt-1 max-w-[72ch] text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
