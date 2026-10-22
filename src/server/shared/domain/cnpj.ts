import { fail, ok, type Result, ValidationError } from "./result";

/**
 * Value Object de CNPJ.
 *
 * Suporta o formato numérico tradicional e o CNPJ alfanumérico (IN RFB nº 2.229/2024,
 * em vigor desde julho/2026): 12 caracteres alfanuméricos + 2 dígitos verificadores.
 * O cálculo do DV usa o valor ASCII − 48 de cada caractere, o que mantém o resultado
 * idêntico ao algoritmo clássico para CNPJs só com números.
 */
export class Cnpj {
  private constructor(readonly value: string) {}

  static normalize(raw: string): string {
    return raw.replace(/[.\-/\s]/g, "").toUpperCase();
  }

  static create(raw: string): Result<Cnpj, ValidationError> {
    const value = Cnpj.normalize(raw ?? "");
    if (!/^[A-Z0-9]{12}\d{2}$/.test(value)) {
      return fail(new ValidationError("CNPJ deve ter 14 caracteres (12 alfanuméricos + 2 dígitos verificadores).", { cnpj: "Formato inválido" }));
    }
    if (/^(\d)\1{13}$/.test(value)) {
      return fail(new ValidationError("CNPJ inválido.", { cnpj: "Sequência repetida" }));
    }
    const base = value.slice(0, 12);
    const dv1 = Cnpj.checkDigit(base);
    const dv2 = Cnpj.checkDigit(base + dv1);
    if (value.slice(12) !== `${dv1}${dv2}`) {
      return fail(new ValidationError("CNPJ inválido: dígitos verificadores não conferem.", { cnpj: "Dígito verificador inválido" }));
    }
    return ok(new Cnpj(value));
  }

  /** Para valores já persistidos/validados. */
  static unsafe(value: string): Cnpj {
    return new Cnpj(Cnpj.normalize(value));
  }

  private static checkDigit(input: string): number {
    const weights = input.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = input.split("").reduce((acc, ch, i) => acc + (ch.charCodeAt(0) - 48) * weights[i], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  }

  formatted(): string {
    const v = this.value;
    return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
  }

  equals(other: Cnpj | string): boolean {
    const otherValue = typeof other === "string" ? Cnpj.normalize(other) : other.value;
    return this.value === otherValue;
  }

  toString(): string {
    return this.value;
  }
}
