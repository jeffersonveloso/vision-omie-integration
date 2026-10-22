import { toBrDateFromAny } from "@/server/shared/domain/dates";
import type { Transform } from "./types";

export interface TransformContext {
  timeZone: string;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function phoneDigits(value: unknown): string {
  let digits = asString(value).replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  return digits;
}

export function applyTransform(value: unknown, transform: Transform, ctx: TransformContext): unknown {
  if (value === null || value === undefined) return value;
  switch (transform) {
    case "TRIM":
      return asString(value).trim();
    case "UPPERCASE":
      return asString(value).toUpperCase();
    case "REMOVE_ACCENTS":
      return asString(value).normalize("NFD").replace(/[̀-ͯ]/g, "");
    case "DIGITS_ONLY":
      return asString(value).replace(/\D/g, "");
    case "DOCUMENT":
      return asString(value).replace(/[.\-/\s]/g, "").toUpperCase();
    case "DATE_BR":
      return toBrDateFromAny(value, ctx.timeZone) ?? value;
    case "NUMBER": {
      if (typeof value === "number") return value;
      const normalized = asString(value).trim().replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
      const n = Number(normalized);
      return Number.isFinite(n) ? n : value;
    }
    case "INTEGER": {
      const n = typeof value === "number" ? value : Number(asString(value).trim());
      return Number.isFinite(n) ? Math.trunc(n) : value;
    }
    case "BOOLEAN_SN": {
      if (typeof value === "boolean") return value ? "S" : "N";
      const v = asString(value).trim().toLowerCase();
      if (["true", "1", "s", "sim", "y", "yes"].includes(v)) return "S";
      if (["false", "0", "n", "nao", "não", "no"].includes(v)) return "N";
      return value;
    }
    case "PHONE_DDD": {
      const d = phoneDigits(value);
      return d.length >= 10 ? d.slice(0, 2) : "";
    }
    case "PHONE_NUMBER": {
      const d = phoneDigits(value);
      return d.length >= 10 ? d.slice(2) : d;
    }
    default:
      return value;
  }
}
