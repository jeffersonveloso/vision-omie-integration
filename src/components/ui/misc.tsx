import type * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-control bg-surface-sunken", className)} {...props} />;
}

export function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("rounded-panel border border-border bg-surface", className)} {...props} />;
}

export function PanelHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3.5", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Mono({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("font-mono text-[0.92em] tracking-tight", className)} {...props} />;
}

export function EmptyState({ title, description, action, className }: { title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-2 px-5 py-10", className)}>
      <p className="text-[15px] font-bold">{title}</p>
      {description ? <p className="max-w-prose text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border-strong bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px]">{children}</kbd>;
}

export function JsonView({ value, className, maxHeight = "28rem" }: { value: unknown; className?: string; maxHeight?: string }) {
  return (
    <pre
      className={cn("overflow-auto rounded-control border border-border bg-surface-sunken p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all", className)}
      style={{ maxHeight }}
    >
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}
export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("text-left text-[13px] text-muted-foreground [&_th]:h-10 [&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:font-semibold [&_th]:whitespace-nowrap", className)} {...props} />;
}
export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-middle [&_tr:last-child_td]:border-b-0", className)} {...props} />;
}
