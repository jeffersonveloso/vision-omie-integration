/**
 * Usuários e sessões do login próprio da aplicação (AUTH_MODE=local).
 * Com AUTH_MODE=proxy a identidade vem do proxy autenticado e este módulo não é usado.
 */
export const USER_ROLES = ["ADMIN", "OPERATOR"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrador",
  OPERATOR: "Operador",
};

export const USER_ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  ADMIN: "Tudo, inclusive cadastrar usuários.",
  OPERATOR: "Tudo, menos cadastrar usuários.",
};

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  passwordHash: string;
  mustChangePassword: boolean;
  failedLogins: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  passwordChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** O que sai da API: nunca o hash da senha nem os contadores internos. */
export interface UserView {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  roleLabel: string;
  active: boolean;
  mustChangePassword: boolean;
  locked: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export function toUserView(user: User, now: Date): UserView {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    roleLabel: USER_ROLE_LABELS[user.role],
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    locked: !!user.lockedUntil && user.lockedUntil > now,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

export interface Session {
  id: string;
  tokenHash: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

export interface UserRepository {
  count(): Promise<number>;
  countActiveAdmins(): Promise<number>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  list(): Promise<User[]>;
  insert(user: User): Promise<void>;
  update(id: string, patch: Partial<Omit<User, "id" | "createdAt">>): Promise<void>;
}

export interface SessionRepository {
  insert(session: Session): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  touch(id: string, lastSeenAt: Date, expiresAt: Date): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByUser(userId: string, exceptSessionId?: string): Promise<number>;
  purgeExpired(now: Date): Promise<number>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export const PASSWORD_MIN_LENGTH = 10;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Política de senha: tamanho mínimo, não pode ser o e-mail nem um caractere repetido. Devolve o problema ou null. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (password.length > 200) return "A senha pode ter no máximo 200 caracteres.";
  if (/^(.)\1+$/.test(password)) return "A senha não pode ser um mesmo caractere repetido.";
  if (email && password.toLowerCase().includes(normalizeEmail(email).split("@")[0]) && normalizeEmail(email).split("@")[0].length >= 4) {
    return "A senha não pode conter o seu e-mail.";
  }
  return null;
}
