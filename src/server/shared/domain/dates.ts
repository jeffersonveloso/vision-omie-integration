/**
 * Utilitários de data cientes de fuso horário.
 * Vision recebe filtros em `yyyy-MM-dd`; Omie recebe e devolve `dd/MM/yyyy`.
 */

export function formatDateInZone(date: Date, timeZone: string): { y: string; m: string; d: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day") };
}

export function toIsoDate(date: Date, timeZone: string): string {
  const { y, m, d } = formatDateInZone(date, timeZone);
  return `${y}-${m}-${d}`;
}

export function toBrDate(date: Date, timeZone: string): string {
  const { y, m, d } = formatDateInZone(date, timeZone);
  return `${d}/${m}/${y}`;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Converte valores comuns ("2026-10-13", "2026-10-13T10:00:00", "13/10/2026", Date) em Date. */
export function parseFlexibleDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const v = value.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  if (br) {
    const [, d, m, y, hh = "00", mm = "00", ss = "00"] = br;
    const parsed = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Converte qualquer data reconhecível para dd/MM/yyyy (sem conversão de fuso para datas "puras"). */
export function toBrDateFromAny(value: unknown, timeZone: string): string | null {
  if (typeof value === "string") {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(value.trim())) return value.trim();
  }
  const date = parseFlexibleDate(value);
  return date ? toBrDate(date, timeZone) : null;
}

/** Converte dd/MM/yyyy + hh:mm:ss (Omie) em ISO local aproximado. */
export function brDateTimeToIso(date?: string | null, time?: string | null): string | null {
  if (!date) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date.trim());
  if (!m) return null;
  const t = time && /^\d{2}:\d{2}(:\d{2})?$/.test(time.trim()) ? time.trim() : "00:00:00";
  return `${m[3]}-${m[2]}-${m[1]}T${t.length === 5 ? `${t}:00` : t}`;
}
