const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const relative = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : dateTime.format(d);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : dateOnly.format(d);
}

export function formatMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : money.format(value);
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const diff = new Date(value).getTime() - Date.now();
  const minutes = Math.round(diff / 60_000);
  if (Math.abs(minutes) < 1) return "agora";
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

export function formatDuration(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return "—";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** Formata CPF/CNPJ (inclusive CNPJ alfanumérico). */
export function formatDocument(value: string | null | undefined): string {
  if (!value) return "—";
  const v = value.replace(/[.\-/\s]/g, "").toUpperCase();
  if (v.length === 14) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
  if (v.length === 11) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
  return value;
}

/** Máscara de digitação de CNPJ (aceita letras nas 12 primeiras posições). */
export function maskCnpj(input: string): string {
  const v = input.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 14);
  let out = v.slice(0, 2);
  if (v.length > 2) out += `.${v.slice(2, 5)}`;
  if (v.length > 5) out += `.${v.slice(5, 8)}`;
  if (v.length > 8) out += `/${v.slice(8, 12)}`;
  if (v.length > 12) out += `-${v.slice(12)}`;
  return out;
}
