import { describe, expect, it } from "vitest";
import { Cnpj } from "./cnpj";

describe("Cnpj", () => {
  it("aceita CNPJ numérico válido com ou sem máscara", () => {
    const masked = Cnpj.create("11.222.333/0001-81");
    expect(masked.ok).toBe(true);
    if (masked.ok) {
      expect(masked.value.value).toBe("11222333000181");
      expect(masked.value.formatted()).toBe("11.222.333/0001-81");
    }
    expect(Cnpj.create("11222333000181").ok).toBe(true);
  });

  it("rejeita dígito verificador errado e sequência repetida", () => {
    expect(Cnpj.create("11.222.333/0001-82").ok).toBe(false);
    expect(Cnpj.create("00000000000000").ok).toBe(false);
    expect(Cnpj.create("123").ok).toBe(false);
  });

  it("aceita CNPJ alfanumérico (IN RFB 2.229/2024)", () => {
    // Exemplo publicado pela Receita Federal: 12.ABC.345/01DE-35
    const result = Cnpj.create("12.ABC.345/01DE-35");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.value).toBe("12ABC34501DE35");
  });

  it("compara ignorando formatação", () => {
    const cnpj = Cnpj.unsafe("11222333000181");
    expect(cnpj.equals("11.222.333/0001-81")).toBe(true);
  });
});
