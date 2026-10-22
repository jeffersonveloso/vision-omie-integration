import { Cnpj } from "@/server/shared/domain/cnpj";
import { parseFlexibleDate } from "@/server/shared/domain/dates";
import { getPath } from "@/server/modules/mappings/domain/object-path";

/**
 * Modelo do pedido no Vision (ControllerAPI › definição `Pedido` do Swagger v1).
 * O payload é mantido como objeto aberto: campos novos do Vision ficam disponíveis
 * para o mapeamento dinâmico sem alteração de código.
 */
export type VisionOrderPayload = Record<string, unknown> & {
  codigo?: number;
  codigoEmpresa?: number;
  razaoSocialEmpresa?: string;
  codigoCliente?: number;
  cliente?: Record<string, unknown>;
  dataCadastro?: string;
  dataAtualizacao?: string;
  itens?: Array<Record<string, unknown>>;
  servicos?: Array<Record<string, unknown>>;
  parcelas?: Array<Record<string, unknown>>;
  codigoStatus?: number;
  descricaoStatus?: string;
};

/** Item resumido devolvido por GET /api/pedido/busca/atualizados. */
export interface VisionOrderSummary {
  code: number;
  companyCode: number | null;
  statusCode: number | null;
  statusDescription: string | null;
  updatedAt: Date | null;
  customerName: string | null;
  raw: Record<string, unknown>;
}

export interface VisionParcel {
  code: number | null;
  dueDate: string | null;
  amount: number;
}

export interface VisionOrderSnapshot {
  code: number;
  companyCode: number | null;
  companyName: string | null;
  statusCode: number | null;
  statusDescription: string | null;
  updatedAt: Date | null;
  customerCode: number | null;
  customerName: string | null;
  customerDocument: string | null;
  hasProducts: boolean;
  hasServices: boolean;
  totalAmount: number;
  parcels: VisionParcel[];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** Interpreta um item da lista de "atualizados" tolerando variações de nomes. */
export function parseVisionOrderSummary(raw: Record<string, unknown>): VisionOrderSummary | null {
  const code = num(raw.codigoPedido ?? raw.codigo ?? raw.CodigoPedido ?? raw.id);
  if (code === null) return null;
  return {
    code,
    companyCode: num(raw.codigoEmpresa ?? raw.CodigoEmpresa),
    statusCode: num(raw.codigoStatus ?? raw.CodigoStatus ?? raw.status),
    statusDescription: str(raw.descricaoStatus ?? raw.DescricaoStatus),
    updatedAt: parseFlexibleDate(raw.dataAtualizacao ?? raw.DataAtualizacao ?? raw.dataAlteracao),
    customerName: str(getPath(raw, "cliente.razaoSocial") ?? raw.razaoSocialCliente ?? raw.nomeCliente ?? raw.razaoSocial),
    raw,
  };
}

function lineTotal(line: Record<string, unknown>): number {
  const total = num(line.valorTotal);
  if (total !== null) return total;
  return (num(line.quantidade) ?? 0) * (num(line.valorUnitario) ?? 0);
}

export function snapshotVisionOrder(payload: VisionOrderPayload): VisionOrderSnapshot {
  const items = Array.isArray(payload.itens) ? payload.itens : [];
  const services = Array.isArray(payload.servicos) ? payload.servicos : [];
  const parcels = Array.isArray(payload.parcelas) ? payload.parcelas : [];
  const goods = items.reduce((acc, i) => acc + lineTotal(i), 0) + services.reduce((acc, s) => acc + lineTotal(s), 0);
  const total = goods + (num(payload.valorFrete) ?? 0) + (num(payload.valorOutras) ?? 0) - (num(payload.valorDesconto) ?? 0);
  const document = str(getPath(payload, "cliente.cpfcnpj"));
  return {
    code: num(payload.codigo ?? payload.codigoPedido) ?? 0,
    companyCode: num(payload.codigoEmpresa),
    companyName: str(payload.razaoSocialEmpresa),
    statusCode: num(payload.codigoStatus),
    statusDescription: str(payload.descricaoStatus),
    updatedAt: parseFlexibleDate(payload.dataAtualizacao),
    customerCode: num(payload.codigoCliente ?? getPath(payload, "cliente.codigo")),
    customerName: str(getPath(payload, "cliente.razaoSocial") ?? getPath(payload, "cliente.nomeFantasia")),
    customerDocument: document ? Cnpj.normalize(document) : null,
    hasProducts: items.length > 0,
    hasServices: services.length > 0,
    totalAmount: Math.round(total * 100) / 100,
    parcels: parcels.map((p) => ({ code: num(p.codigoParcela), dueDate: str(p.dataVencimento), amount: num(p.valorParcela) ?? 0 })),
  };
}

/** Lê o CNPJ da empresa faturadora no pedido, tentando os caminhos configurados em ordem. */
export function extractCompanyCnpj(payload: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = getPath(payload, path);
    if (value !== null && value !== undefined && String(value).trim() !== "") return Cnpj.normalize(String(value));
  }
  return null;
}
