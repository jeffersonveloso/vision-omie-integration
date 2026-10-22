import { toBrDateFromAny } from "@/server/shared/domain/dates";
import type { FinancialTitle } from "./omie-document";
import type { VisionParcel } from "./vision-order";

/**
 * Vincula os títulos gerados pelo Omie às parcelas do pedido no Vision (necessário para
 * informar `codigoParcela` nas baixas). Estratégia:
 *  1) mesma quantidade → pareia pela ordem de vencimento;
 *  2) senão → pareia pela data de vencimento idêntica.
 */
export function matchTitlesToVisionParcels(titles: FinancialTitle[], parcels: VisionParcel[], timeZone: string): Map<number, number | null> {
  const result = new Map<number, number | null>();
  const validParcels = parcels.filter((p) => p.code !== null);
  const byDue = (a: { dueDate: string | null }, b: { dueDate: string | null }) => dueKey(a.dueDate, timeZone).localeCompare(dueKey(b.dueDate, timeZone));
  const sortedTitles = [...titles].sort((a, b) => (a.parcelNumber ?? 0) - (b.parcelNumber ?? 0) || byDue(a, b));
  const sortedParcels = [...validParcels].sort(byDue);

  if (sortedTitles.length === sortedParcels.length) {
    sortedTitles.forEach((t, i) => result.set(t.omieTitleId, sortedParcels[i].code));
    return result;
  }
  const used = new Set<number>();
  for (const title of sortedTitles) {
    const match = sortedParcels.find((p) => !used.has(p.code!) && dueKey(p.dueDate, timeZone) === dueKey(title.dueDate, timeZone));
    if (match) {
      used.add(match.code!);
      result.set(title.omieTitleId, match.code);
    } else {
      result.set(title.omieTitleId, null);
    }
  }
  return result;
}

function dueKey(value: string | null, timeZone: string): string {
  const br = value ? toBrDateFromAny(value, timeZone) : null;
  if (!br) return "9999-99-99";
  const [d, m, y] = br.split("/");
  return `${y}-${m}-${d}`;
}
