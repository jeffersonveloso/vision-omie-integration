"use client";

import { Command } from "cmdk";
import { Check, ChevronsUpDown, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./overlays";

export interface ComboOption {
  value: string;
  label: string;
  description?: string;
  inactive?: boolean;
  group?: string;
}

interface ComboboxProps {
  value: string | null | undefined;
  onChange: (value: string, option: ComboOption | null) => void;
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  /** Permite usar um valor digitado que não está na lista (ex.: caminho personalizado). */
  allowCustom?: boolean;
  mono?: boolean;
  className?: string;
  disabled?: boolean;
  id?: string;
}

export function Combobox({ value, onChange, options, placeholder = "Selecione…", searchPlaceholder = "Buscar…", emptyText = "Nada encontrado.", loading, error, onRefresh, allowCustom, mono, className, disabled, id }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find((o) => o.value === value) ?? null;
  const groups = [...new Set(options.map((o) => o.group ?? ""))];

  const pick = (v: string, option: ComboOption | null) => {
    onChange(v, option);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-control border border-border-strong bg-surface px-3 text-left text-sm disabled:opacity-60",
            !value && "text-muted-foreground/80",
            className,
          )}
        >
          <span className={cn("truncate", mono && value && "font-mono text-[13px]")}>{selected ? selected.label : value || placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(32rem,calc(100vw-2rem))]">
        <Command shouldFilter loop className="flex flex-col">
          <div className="flex items-center gap-1 border-b border-border px-2">
            <Command.Input value={search} onValueChange={setSearch} placeholder={searchPlaceholder} className="h-10 w-full bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground/70" />
            {onRefresh ? (
              <button type="button" onClick={onRefresh} className="rounded-control p-1.5 text-muted-foreground hover:bg-surface-sunken hover:text-foreground" title="Recarregar do Omie" aria-label="Recarregar do Omie">
                {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              </button>
            ) : null}
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-1">
            {loading && options.length === 0 ? <div className="flex items-center gap-2 px-3 py-6 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando do Omie…</div> : null}
            {error ? <div className="px-3 py-3 text-[13px] text-error">{error}</div> : null}
            {!loading ? <Command.Empty className="px-3 py-6 text-muted-foreground">{emptyText}</Command.Empty> : null}
            {allowCustom && search.trim() && !options.some((o) => o.value === search.trim()) ? (
              <Command.Item value={`__custom__${search}`} onSelect={() => pick(search.trim(), null)} className="flex cursor-default items-center gap-2 rounded-[5px] px-2.5 py-2 text-sm data-[selected=true]:bg-surface-sunken">
                Usar <span className="font-mono text-[13px]">{search.trim()}</span>
              </Command.Item>
            ) : null}
            {groups.map((group) => (
              <Command.Group key={group || "default"} heading={group || undefined} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
                {options
                  .filter((o) => (o.group ?? "") === group)
                  .map((option) => (
                    <Command.Item
                      key={`${option.value}|${option.label}`}
                      value={`${option.value} ${option.label} ${option.description ?? ""}`}
                      onSelect={() => pick(option.value, option)}
                      className="flex cursor-default items-start gap-2 rounded-[5px] px-2.5 py-2 text-sm data-[selected=true]:bg-surface-sunken"
                    >
                      <Check className={cn("mt-0.5 size-4 shrink-0 text-primary", option.value === value ? "opacity-100" : "opacity-0")} />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate", mono && "font-mono text-[13px]", option.inactive && "text-muted-foreground line-through")}>{option.label}</span>
                        {option.description ? <span className="block truncate text-[12px] text-muted-foreground">{option.description}</span> : null}
                      </span>
                      {!mono && option.value !== option.label && !option.label.startsWith(option.value) ? <span className="shrink-0 font-mono text-[12px] text-muted-foreground">{option.value}</span> : null}
                    </Command.Item>
                  ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
