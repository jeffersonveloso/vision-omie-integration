import { Cnpj } from "@/server/shared/domain/cnpj";
import { fail, ok, type Result, ValidationError } from "@/server/shared/domain/result";

export interface ConnectionCheck {
  at: Date;
  ok: boolean;
  message: string;
}

export interface OmieAccountProps {
  id: string;
  /** Nome da base Omie (ex.: "Ecolife Matriz"). */
  name: string;
  appKey: string;
  appSecret: string;
  cnpj: Cnpj;
  description: string | null;
  /** Checkbox "integração ativa": contas inativas não recebem pedidos. */
  active: boolean;
  lastCheck: ConnectionCheck | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OmieAccountInput {
  name: string;
  appKey: string;
  appSecret: string;
  cnpj: string;
  description?: string | null;
  active: boolean;
}

/**
 * Agregado "Conta Omie": cada conta corresponde a uma base/licença Omie e
 * recebe os pedidos do Vision cujo CNPJ faturador coincide com o seu.
 */
export class OmieAccount {
  private constructor(private props: OmieAccountProps) {}

  static create(input: OmieAccountInput, id: string, now: Date): Result<OmieAccount, ValidationError> {
    const validated = OmieAccount.validate(input);
    if (!validated.ok) return validated;
    return ok(
      new OmieAccount({
        id,
        name: input.name.trim(),
        appKey: input.appKey.trim(),
        appSecret: input.appSecret.trim(),
        cnpj: validated.value,
        description: input.description?.trim() || null,
        active: input.active,
        lastCheck: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  static restore(props: OmieAccountProps): OmieAccount {
    return new OmieAccount(props);
  }

  private static validate(input: Partial<OmieAccountInput>): Result<Cnpj, ValidationError> {
    const errors: Record<string, string> = {};
    if (!input.name?.trim()) errors.name = "Informe o nome da base.";
    else if (input.name.trim().length > 100) errors.name = "Máximo de 100 caracteres.";
    if (!input.appKey?.trim()) errors.appKey = "Informe o App Key.";
    if (!input.appSecret?.trim()) errors.appSecret = "Informe o App Secret.";
    if (input.description && input.description.length > 500) errors.description = "Máximo de 500 caracteres.";
    const cnpj = Cnpj.create(input.cnpj ?? "");
    if (!cnpj.ok) errors.cnpj = cnpj.error.message;
    if (Object.keys(errors).length > 0 || !cnpj.ok) {
      return fail(new ValidationError("Dados da conta Omie inválidos.", errors));
    }
    return ok(cnpj.value);
  }

  /** Atualiza dados cadastrais. `appSecret` vazio mantém o segredo atual. */
  update(input: Omit<OmieAccountInput, "appSecret"> & { appSecret?: string | null }, now: Date): Result<void, ValidationError> {
    const secret = input.appSecret?.trim() ? input.appSecret : this.props.appSecret;
    const validated = OmieAccount.validate({ ...input, appSecret: secret });
    if (!validated.ok) return validated;
    const credentialsChanged = input.appKey.trim() !== this.props.appKey || secret.trim() !== this.props.appSecret;
    this.props = {
      ...this.props,
      name: input.name.trim(),
      appKey: input.appKey.trim(),
      appSecret: secret.trim(),
      cnpj: validated.value,
      description: input.description?.trim() || null,
      active: input.active,
      lastCheck: credentialsChanged ? null : this.props.lastCheck,
      updatedAt: now,
    };
    return ok(undefined);
  }

  setActive(active: boolean, now: Date): void {
    this.props = { ...this.props, active, updatedAt: now };
  }

  recordConnectionCheck(check: ConnectionCheck): void {
    this.props = { ...this.props, lastCheck: check };
  }

  get id() { return this.props.id; }
  get name() { return this.props.name; }
  get appKey() { return this.props.appKey; }
  get appSecret() { return this.props.appSecret; }
  get cnpj() { return this.props.cnpj; }
  get description() { return this.props.description; }
  get active() { return this.props.active; }
  get lastCheck() { return this.props.lastCheck; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }

  credentials(): { appKey: string; appSecret: string } {
    return { appKey: this.props.appKey, appSecret: this.props.appSecret };
  }

  /** Representação segura para a interface: o segredo nunca sai do servidor. */
  toPublic() {
    return {
      id: this.props.id,
      name: this.props.name,
      appKey: this.props.appKey,
      appKeyMasked: maskKey(this.props.appKey),
      hasAppSecret: Boolean(this.props.appSecret),
      cnpj: this.props.cnpj.value,
      cnpjFormatted: this.props.cnpj.formatted(),
      description: this.props.description,
      active: this.props.active,
      lastCheck: this.props.lastCheck
        ? { at: this.props.lastCheck.at.toISOString(), ok: this.props.lastCheck.ok, message: this.props.lastCheck.message }
        : null,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    };
  }
}

export type PublicOmieAccount = ReturnType<OmieAccount["toPublic"]>;

function maskKey(key: string): string {
  if (key.length <= 6) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(Math.max(4, key.length - 8))}${key.slice(-4)}`;
}
