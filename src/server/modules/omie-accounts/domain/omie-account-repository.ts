import type { OmieAccount } from "./omie-account";

export interface OmieAccountRepository {
  findById(id: string): Promise<OmieAccount | null>;
  findByCnpj(cnpj: string): Promise<OmieAccount | null>;
  list(): Promise<OmieAccount[]>;
  save(account: OmieAccount): Promise<void>;
  delete(id: string): Promise<void>;
}
