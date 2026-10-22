import type { Clock, IdGenerator } from "@/server/shared/application/ports";
import { Cnpj } from "@/server/shared/domain/cnpj";
import { ConflictError, NotFoundError } from "@/server/shared/domain/result";
import type { OmieGatewayFactory } from "@/server/modules/integration/application/ports";
import { IntegrationError } from "@/server/modules/integration/domain/integration-error";
import type { LookupEntity, LookupOption } from "@/server/modules/mappings/domain/types";
import { OmieAccount, type OmieAccountInput, type PublicOmieAccount } from "../domain/omie-account";
import type { OmieAccountRepository } from "../domain/omie-account-repository";

export interface LookupCache {
  get(accountId: string, entity: LookupEntity, maxAgeMs: number): Promise<LookupOption[] | null>;
  set(accountId: string, entity: LookupEntity, options: LookupOption[]): Promise<void>;
}

/** Casos de uso do cadastro de contas Omie (bases de destino por CNPJ). */
export class OmieAccountService {
  constructor(
    private readonly accounts: OmieAccountRepository,
    private readonly omie: OmieGatewayFactory,
    private readonly lookupCache: LookupCache,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async list(): Promise<PublicOmieAccount[]> {
    return (await this.accounts.list()).map((a) => a.toPublic());
  }

  async get(id: string): Promise<OmieAccount> {
    const account = await this.accounts.findById(id);
    if (!account) throw new NotFoundError("Conta Omie", id);
    return account;
  }

  async create(input: OmieAccountInput): Promise<PublicOmieAccount> {
    const created = OmieAccount.create(input, this.ids.next(), this.clock.now());
    if (!created.ok) throw created.error;
    await this.ensureUniqueCnpj(created.value.cnpj.value, null);
    await this.accounts.save(created.value);
    return created.value.toPublic();
  }

  async update(id: string, input: Omit<OmieAccountInput, "appSecret"> & { appSecret?: string | null }): Promise<PublicOmieAccount> {
    const account = await this.get(id);
    const updated = account.update(input, this.clock.now());
    if (!updated.ok) throw updated.error;
    await this.ensureUniqueCnpj(account.cnpj.value, account.id);
    await this.accounts.save(account);
    return account.toPublic();
  }

  async setActive(id: string, active: boolean): Promise<PublicOmieAccount> {
    const account = await this.get(id);
    account.setActive(active, this.clock.now());
    await this.accounts.save(account);
    return account.toPublic();
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.accounts.delete(id);
  }

  /**
   * Testa as credenciais chamando ListarEmpresas e confere se o CNPJ cadastrado
   * pertence à base — evita rotear pedidos para a base errada.
   */
  async testConnection(id: string): Promise<{ ok: boolean; message: string; companies: Array<{ cnpj: string; name: string }> }> {
    const account = await this.get(id);
    const now = this.clock.now();
    try {
      const companies = await this.omie.forAccount(account.credentials()).listCompanies();
      const match = companies.find((c) => account.cnpj.equals(c.cnpj));
      const result = match
        ? { ok: true, message: `Conexão OK. Empresa encontrada: ${match.name}.` }
        : {
            ok: false,
            message: `Credenciais válidas, mas o CNPJ ${account.cnpj.formatted()} não pertence a esta base. Empresas encontradas: ${companies.map((c) => `${c.name} (${Cnpj.unsafe(c.cnpj).formatted()})`).join(", ") || "nenhuma"}.`,
          };
      account.recordConnectionCheck({ at: now, ...result });
      await this.accounts.save(account);
      return { ...result, companies: companies.map((c) => ({ cnpj: c.cnpj, name: c.name })) };
    } catch (error) {
      const message = error instanceof IntegrationError ? `${error.message}${error.hint ? ` — ${error.hint}` : ""}` : String(error);
      account.recordConnectionCheck({ at: now, ok: false, message });
      await this.accounts.save(account);
      return { ok: false, message, companies: [] };
    }
  }

  /** Lista registros de um cadastro Omie (categorias, produtos...) para os combos do mapeamento. */
  async lookup(id: string, entity: LookupEntity, options: { refresh?: boolean; search?: string } = {}): Promise<{ options: LookupOption[]; cached: boolean }> {
    const account = await this.get(id);
    let cached = true;
    let list = options.refresh ? null : await this.lookupCache.get(id, entity, 15 * 60_000);
    if (!list) {
      cached = false;
      list = await this.omie.forAccount(account.credentials()).listLookup(entity);
      await this.lookupCache.set(id, entity, list);
    }
    const term = options.search?.trim().toLowerCase();
    const filtered = term ? list.filter((o) => o.value.toLowerCase().includes(term) || o.label.toLowerCase().includes(term)) : list;
    return { options: filtered, cached };
  }

  private async ensureUniqueCnpj(cnpj: string, currentId: string | null): Promise<void> {
    const other = await this.accounts.findByCnpj(cnpj);
    if (other && other.id !== currentId) {
      throw new ConflictError(`O CNPJ ${Cnpj.unsafe(cnpj).formatted()} já está cadastrado na conta "${other.name}". Cada CNPJ direciona para uma única base Omie.`);
    }
  }
}
