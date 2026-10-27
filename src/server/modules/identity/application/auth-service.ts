import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Clock, IdGenerator } from "@/server/shared/application/ports";
import { ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError, UnauthorizedError, ValidationError } from "@/server/shared/domain/result";
import {
  normalizeEmail,
  passwordProblem,
  type PasswordHasher,
  type Session,
  type SessionRepository,
  toUserView,
  type User,
  type UserRepository,
  type UserRole,
  type UserView,
} from "../domain/user";

export interface AuthPolicy {
  /** Sessão expira depois deste tempo sem uso. */
  idleHours: number;
  /** Limite absoluto da sessão, mesmo em uso. */
  maxDays: number;
  /** Senhas erradas seguidas até bloquear. */
  maxFailedLogins: number;
  lockMinutes: number;
}

export const DEFAULT_AUTH_POLICY: AuthPolicy = { idleHours: 12, maxDays: 7, maxFailedLogins: 5, lockMinutes: 15 };

/** Renova a validade da sessão no máximo a cada 5 min (evita uma escrita por requisição). */
const TOUCH_INTERVAL_MS = 5 * 60_000;
const INVALID_CREDENTIALS = "E-mail ou senha incorretos.";
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Senha temporária legível (sem 0/O, 1/l/I), para o administrador repassar ao usuário. */
export function generateTemporaryPassword(length = 14): string {
  let out = "";
  for (let i = 0; i < length; i++) out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  return out;
}

export interface Authenticated {
  user: User;
  session: Session;
}

export interface LoginResult extends Authenticated {
  token: string;
  view: UserView;
}

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Login, sessões e troca de senha. Senha errada repetida bloqueia a conta por alguns minutos
 * (o mesmo vale para e-mails que não existem, para não revelar quais existem).
 */
export class AuthService {
  private dummyHash: Promise<string> | null = null;
  /** Tentativas com e-mails inexistentes (em memória: só serve para responder igual a uma conta real). */
  private readonly unknownAttempts = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly deps: { users: UserRepository; sessions: SessionRepository; hasher: PasswordHasher; ids: IdGenerator; clock: Clock; policy?: AuthPolicy },
  ) {}

  private get policy(): AuthPolicy {
    return this.deps.policy ?? DEFAULT_AUTH_POLICY;
  }

  private lockedError(until: Date | number): TooManyRequestsError {
    const seconds = Math.max(1, Math.ceil((Number(until) - this.deps.clock.now().getTime()) / 1000));
    const minutes = Math.ceil(seconds / 60);
    return new TooManyRequestsError(`Muitas tentativas com senha incorreta. Tente de novo em ${minutes} minuto${minutes > 1 ? "s" : ""}.`, seconds);
  }

  async login(input: { email: string; password: string }, client: ClientInfo): Promise<LoginResult> {
    const { users, hasher, clock } = this.deps;
    const email = normalizeEmail(input.email);
    const now = clock.now();
    const user = await users.findByEmail(email);

    if (!user) {
      const attempt = this.unknownAttempts.get(email);
      if (attempt && attempt.lockedUntil > now.getTime()) throw this.lockedError(attempt.lockedUntil);
      // Mesmo custo de uma verificação real, para o tempo de resposta não revelar se o e-mail existe.
      await hasher.verify(input.password, await (this.dummyHash ??= hasher.hash(randomBytes(16).toString("hex"))));
      // Ao bloquear, o contador volta a zero: depois do bloqueio começa uma nova série de tentativas.
      const count = (attempt?.count ?? 0) + 1;
      const locked = count >= this.policy.maxFailedLogins;
      this.unknownAttempts.set(email, { count: locked ? 0 : count, lockedUntil: locked ? now.getTime() + this.policy.lockMinutes * 60_000 : 0 });
      if (this.unknownAttempts.size > 10_000) this.unknownAttempts.clear();
      throw new UnauthorizedError(INVALID_CREDENTIALS, "INVALID_CREDENTIALS");
    }

    if (user.lockedUntil && user.lockedUntil > now) throw this.lockedError(user.lockedUntil);
    const valid = await hasher.verify(input.password, user.passwordHash);
    if (!valid || !user.active) {
      if (!valid) {
        const failed = user.failedLogins + 1;
        const lock = failed >= this.policy.maxFailedLogins;
        await users.update(user.id, { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(now.getTime() + this.policy.lockMinutes * 60_000) : null, updatedAt: now });
      }
      throw new UnauthorizedError(INVALID_CREDENTIALS, "INVALID_CREDENTIALS");
    }

    await users.update(user.id, { failedLogins: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now });
    const fresh: User = { ...user, failedLogins: 0, lockedUntil: null, lastLoginAt: now };
    const { token, session } = await this.createSession(fresh.id, client);
    return { token, session, user: fresh, view: toUserView(fresh, now) };
  }

  private async createSession(userId: string, client: ClientInfo): Promise<{ token: string; session: Session }> {
    const now = this.deps.clock.now();
    const token = randomBytes(32).toString("base64url");
    const session: Session = {
      id: this.deps.ids.next(),
      tokenHash: hashToken(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: this.expiryFrom(now, now),
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, 300) ?? null,
    };
    await this.deps.sessions.insert(session);
    return { token, session };
  }

  private expiryFrom(lastSeen: Date, createdAt: Date): Date {
    const idle = lastSeen.getTime() + this.policy.idleHours * 3_600_000;
    const absolute = createdAt.getTime() + this.policy.maxDays * 86_400_000;
    return new Date(Math.min(idle, absolute));
  }

  /** Valida o token do cookie. Sessão expirada, usuário desativado ou inexistente → null. */
  async authenticate(token: string | null | undefined): Promise<Authenticated | null> {
    if (!token || token.length > 200) return null;
    const { sessions, users, clock } = this.deps;
    const session = await sessions.findByTokenHash(hashToken(token));
    if (!session) return null;
    const now = clock.now();
    if (session.expiresAt <= now) {
      await sessions.delete(session.id);
      return null;
    }
    const user = await users.findById(session.userId);
    if (!user || !user.active) {
      await sessions.delete(session.id);
      return null;
    }
    if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      const expiresAt = this.expiryFrom(now, session.createdAt);
      await sessions.touch(session.id, now, expiresAt);
      return { user, session: { ...session, lastSeenAt: now, expiresAt } };
    }
    return { user, session };
  }

  async logout(token: string | null | undefined): Promise<Session | null> {
    if (!token) return null;
    const session = await this.deps.sessions.findByTokenHash(hashToken(token));
    if (session) await this.deps.sessions.delete(session.id);
    return session;
  }

  /** Troca a própria senha. Encerra as outras sessões do usuário (mantém a atual). */
  async changePassword(userId: string, currentSessionId: string, input: { currentPassword: string; newPassword: string }): Promise<UserView> {
    const { users, sessions, hasher, clock } = this.deps;
    const user = await users.findById(userId);
    if (!user) throw new NotFoundError("Usuário", userId);
    if (!(await hasher.verify(input.currentPassword, user.passwordHash))) {
      throw new ValidationError("A senha atual não confere.", { currentPassword: "A senha atual não confere." });
    }
    const problem = passwordProblem(input.newPassword, user.email);
    if (problem) throw new ValidationError(problem, { newPassword: problem });
    if (input.newPassword === input.currentPassword) throw new ValidationError("A nova senha precisa ser diferente da atual.", { newPassword: "A nova senha precisa ser diferente da atual." });
    const now = clock.now();
    const passwordHash = await hasher.hash(input.newPassword);
    await users.update(user.id, { passwordHash, mustChangePassword: false, passwordChangedAt: now, updatedAt: now });
    await sessions.deleteByUser(user.id, currentSessionId);
    return toUserView({ ...user, passwordHash, mustChangePassword: false, passwordChangedAt: now }, now);
  }

  purgeExpiredSessions(): Promise<number> {
    return this.deps.sessions.purgeExpired(this.deps.clock.now());
  }
}

export interface CreateUserInput {
  email: string;
  name: string;
  role: UserRole;
  /** Vazio = gera uma senha temporária. */
  password?: string;
}

/** Cadastro de usuários (somente administradores). */
export class UserAdminService {
  constructor(private readonly deps: { users: UserRepository; sessions: SessionRepository; hasher: PasswordHasher; ids: IdGenerator; clock: Clock }) {}

  async list(): Promise<UserView[]> {
    const now = this.deps.clock.now();
    return (await this.deps.users.list()).map((u) => toUserView(u, now));
  }

  async get(id: string): Promise<UserView> {
    const user = await this.deps.users.findById(id);
    if (!user) throw new NotFoundError("Usuário", id);
    return toUserView(user, this.deps.clock.now());
  }

  /**
   * Cria um usuário. Sem senha informada, gera uma temporária (devolvida uma única vez) e o usuário
   * troca no primeiro acesso.
   */
  async create(input: CreateUserInput, options: { mustChangePassword?: boolean } = {}): Promise<{ user: UserView; temporaryPassword: string | null }> {
    const { users, hasher, ids, clock } = this.deps;
    const email = normalizeEmail(input.email);
    if (await users.findByEmail(email)) throw new ConflictError(`Já existe um usuário com o e-mail ${email}.`);
    const temporaryPassword = input.password ? null : generateTemporaryPassword();
    const password = input.password ?? temporaryPassword!;
    const problem = passwordProblem(password, email);
    if (problem) throw new ValidationError(problem, { password: problem });
    const now = clock.now();
    const user: User = {
      id: ids.next(),
      email,
      name: input.name.trim(),
      role: input.role,
      active: true,
      passwordHash: await hasher.hash(password),
      mustChangePassword: options.mustChangePassword ?? true,
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: null,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await users.insert(user);
    return { user: toUserView(user, now), temporaryPassword };
  }

  /**
   * Altera nome, perfil ou situação. Desativar encerra as sessões. Ninguém tira o próprio acesso de
   * administrador nem se desativa, e sempre sobra pelo menos um administrador ativo.
   */
  async update(id: string, patch: { name?: string; role?: UserRole; active?: boolean }, actingUserId: string | null): Promise<{ before: UserView; after: UserView }> {
    const { users, sessions, clock } = this.deps;
    const user = await users.findById(id);
    if (!user) throw new NotFoundError("Usuário", id);
    const now = clock.now();
    const losesAdmin = user.role === "ADMIN" && user.active && ((patch.role && patch.role !== "ADMIN") || patch.active === false);
    if (losesAdmin && actingUserId === id) throw new ForbiddenError("Você não pode tirar o seu próprio acesso de administrador nem se desativar.");
    if (losesAdmin && (await users.countActiveAdmins()) <= 1) throw new ConflictError("É preciso manter pelo menos um administrador ativo.");
    const next: User = {
      ...user,
      name: patch.name?.trim() || user.name,
      role: patch.role ?? user.role,
      active: patch.active ?? user.active,
      // Reativar também desbloqueia.
      ...(patch.active === true && !user.active ? { failedLogins: 0, lockedUntil: null } : {}),
      updatedAt: now,
    };
    await users.update(id, { name: next.name, role: next.role, active: next.active, failedLogins: next.failedLogins, lockedUntil: next.lockedUntil, updatedAt: now });
    if (!next.active) await sessions.deleteByUser(id);
    return { before: toUserView(user, now), after: toUserView(next, now) };
  }

  /** Gera uma senha temporária, desbloqueia a conta e encerra as sessões. O usuário troca no próximo acesso. */
  async resetPassword(id: string): Promise<{ user: UserView; temporaryPassword: string }> {
    const { users, sessions, hasher, clock } = this.deps;
    const user = await users.findById(id);
    if (!user) throw new NotFoundError("Usuário", id);
    const temporaryPassword = generateTemporaryPassword();
    const now = clock.now();
    const passwordHash = await hasher.hash(temporaryPassword);
    await users.update(id, { passwordHash, mustChangePassword: true, failedLogins: 0, lockedUntil: null, passwordChangedAt: now, updatedAt: now });
    await sessions.deleteByUser(id);
    return { user: toUserView({ ...user, mustChangePassword: true, lockedUntil: null }, now), temporaryPassword };
  }

  /**
   * Primeiro administrador a partir de AUTH_ADMIN_EMAIL / AUTH_ADMIN_PASSWORD: só quando ainda não há
   * nenhum usuário. Depois disso as variáveis são ignoradas.
   */
  async bootstrapAdmin(input: { email?: string; password?: string; name?: string }): Promise<UserView | null> {
    if (!input.email || !input.password) return null;
    if ((await this.deps.users.count()) > 0) return null;
    try {
      const { user } = await this.create({ email: input.email, password: input.password, name: input.name || "Administrador", role: "ADMIN" }, { mustChangePassword: false });
      return user;
    } catch (error) {
      // Servidor web e worker sobem juntos: se o outro processo criou primeiro, não há o que fazer.
      if ((await this.deps.users.count()) > 0) return null;
      throw error;
    }
  }

  /** Cria ou redefine a senha de um usuário pelo terminal (npm run users:create). */
  async upsertFromCli(input: { email: string; name: string; role: UserRole; password: string }): Promise<{ user: UserView; created: boolean }> {
    const existing = await this.deps.users.findByEmail(normalizeEmail(input.email));
    if (!existing) return { user: (await this.create(input, { mustChangePassword: false })).user, created: true };
    const problem = passwordProblem(input.password, existing.email);
    if (problem) throw new ValidationError(problem, { password: problem });
    const now = this.deps.clock.now();
    const patch = { name: input.name || existing.name, role: input.role, active: true, passwordHash: await this.deps.hasher.hash(input.password), mustChangePassword: false, failedLogins: 0, lockedUntil: null, passwordChangedAt: now, updatedAt: now };
    await this.deps.users.update(existing.id, patch);
    await this.deps.sessions.deleteByUser(existing.id);
    return { user: toUserView({ ...existing, ...patch }, now), created: false };
  }
}
