import { Cnpj } from "@/server/shared/domain/cnpj";
import type { OmieAccount } from "@/server/modules/omie-accounts/domain/omie-account";
import type { OmieAccountRepository } from "@/server/modules/omie-accounts/domain/omie-account-repository";
import type { ValueMapEntryRepository } from "@/server/modules/mappings/domain/repositories";
import { normalizeVisionKey } from "@/server/modules/mappings/domain/value-map";
import type { IntegrationSettings } from "@/server/modules/settings/domain/integration-settings";
import { IntegrationError } from "../domain/integration-error";
import { extractCompanyCnpj, type VisionOrderPayload } from "../domain/vision-order";

export interface RouteResult {
  account: OmieAccount;
  cnpj: string;
  via: "CNPJ" | "COMPANY_CODE";
}

/**
 * Roteamento "Dual CNPJ": o CNPJ da empresa faturadora no pedido do Vision define
 * para qual base Omie o pedido vai. Alternativa: tabela de-para código da empresa → CNPJ.
 */
export class AccountRouter {
  constructor(
    private readonly accounts: OmieAccountRepository,
    private readonly entries: ValueMapEntryRepository,
  ) {}

  async resolve(payload: VisionOrderPayload, settings: IntegrationSettings): Promise<RouteResult> {
    const cnpj = extractCompanyCnpj(payload, settings.routing.cnpjFieldPaths);
    if (cnpj) return { account: await this.byCnpj(cnpj), cnpj, via: "CNPJ" };

    const companyCode = payload.codigoEmpresa;
    if (companyCode === undefined || companyCode === null) {
      throw new IntegrationError({
        category: "ROUTING",
        code: "CNPJ_NOT_FOUND",
        message: "O pedido não informa o CNPJ da empresa faturadora nem o código da empresa.",
        hint: `Confira em Configurações › Roteamento os caminhos do CNPJ no pedido (atuais: ${settings.routing.cnpjFieldPaths.join(", ")}).`,
        step: "ROUTE",
      });
    }
    const matches = await this.entries.findAcrossAccounts(settings.routing.companyCodeMapKey, normalizeVisionKey(companyCode));
    if (matches.length === 0) {
      throw new IntegrationError({
        category: "ROUTING",
        code: "COMPANY_NOT_MAPPED",
        message: `O pedido não traz o CNPJ da empresa e a empresa ${companyCode}${payload.razaoSocialEmpresa ? ` (${payload.razaoSocialEmpresa})` : ""} não está associada a nenhuma conta Omie.`,
        hint: `Cadastre a empresa ${companyCode} na tabela de-para "Empresa Vision → CNPJ" da conta Omie correta, ou ajuste os caminhos do CNPJ em Configurações.`,
        step: "ROUTE",
        details: { codigoEmpresa: companyCode },
      });
    }
    const accountIds = [...new Set(matches.map((m) => m.omieAccountId))];
    if (accountIds.length > 1) {
      throw new IntegrationError({
        category: "ROUTING",
        code: "COMPANY_AMBIGUOUS",
        message: `A empresa ${companyCode} está associada a mais de uma conta Omie.`,
        hint: "Mantenha a empresa em apenas uma conta na tabela \"Empresa Vision → CNPJ\".",
        step: "ROUTE",
      });
    }
    const account = await this.accounts.findById(accountIds[0]);
    if (!account) throw new IntegrationError({ category: "ROUTING", code: "ACCOUNT_NOT_FOUND", message: "Conta Omie do roteamento não existe mais.", step: "ROUTE" });
    this.assertActive(account);
    return { account, cnpj: account.cnpj.value, via: "COMPANY_CODE" };
  }

  private async byCnpj(cnpj: string): Promise<OmieAccount> {
    const account = await this.accounts.findByCnpj(cnpj);
    if (!account) {
      const formatted = /^[A-Z0-9]{12}\d{2}$/.test(cnpj) ? Cnpj.unsafe(cnpj).formatted() : cnpj;
      throw new IntegrationError({
        category: "ROUTING",
        code: "ACCOUNT_NOT_REGISTERED",
        message: `Nenhuma conta Omie cadastrada para o CNPJ ${formatted}.`,
        hint: "Cadastre a base Omie deste CNPJ em Contas Omie e reenvie o pedido.",
        step: "ROUTE",
        details: { cnpj },
      });
    }
    this.assertActive(account);
    return account;
  }

  private assertActive(account: OmieAccount): void {
    if (!account.active) {
      throw new IntegrationError({
        category: "ROUTING",
        code: "ACCOUNT_INACTIVE",
        message: `A conta Omie "${account.name}" (${account.cnpj.formatted()}) está com a integração desativada.`,
        hint: "Ative a integração da conta em Contas Omie e reenvie o pedido.",
        step: "ROUTE",
      });
    }
  }
}
