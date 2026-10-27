import { describe, expect, it } from "vitest";
import { ScryptPasswordHasher } from "../infrastructure/scrypt-password-hasher";
import { passwordProblem, type Session, type SessionRepository, type User, type UserRepository } from "../domain/user";
import { AuthService, generateTemporaryPassword, hashToken, UserAdminService } from "./auth-service";

class MemoryUsers implements UserRepository {
  rows = new Map<string, User>();
  async count() {
    return this.rows.size;
  }
  async countActiveAdmins() {
    return [...this.rows.values()].filter((u) => u.role === "ADMIN" && u.active).length;
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByEmail(email: string) {
    return [...this.rows.values()].find((u) => u.email === email) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async insert(user: User) {
    this.rows.set(user.id, { ...user });
  }
  async update(id: string, patch: Partial<User>) {
    this.rows.set(id, { ...this.rows.get(id)!, ...patch });
  }
}

class MemorySessions implements SessionRepository {
  rows = new Map<string, Session>();
  async insert(s: Session) {
    this.rows.set(s.id, { ...s });
  }
  async findByTokenHash(h: string) {
    return [...this.rows.values()].find((s) => s.tokenHash === h) ?? null;
  }
  async touch(id: string, lastSeenAt: Date, expiresAt: Date) {
    this.rows.set(id, { ...this.rows.get(id)!, lastSeenAt, expiresAt });
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
  async deleteByUser(userId: string, except?: string) {
    let n = 0;
    for (const s of [...this.rows.values()]) if (s.userId === userId && s.id !== except && this.rows.delete(s.id)) n++;
    return n;
  }
  async purgeExpired(now: Date) {
    let n = 0;
    for (const s of [...this.rows.values()]) if (s.expiresAt <= now && this.rows.delete(s.id)) n++;
    return n;
  }
}

function setup() {
  let now = new Date("2026-10-27T12:00:00Z");
  let seq = 0;
  const clock = { now: () => now };
  const advance = (ms: number) => (now = new Date(now.getTime() + ms));
  const users = new MemoryUsers();
  const sessions = new MemorySessions();
  const deps = { users, sessions, hasher: new ScryptPasswordHasher({ N: 2 ** 10, r: 8, p: 1 }), ids: { next: () => `id-${++seq}` }, clock };
  const auth = new AuthService({ ...deps, policy: { idleHours: 12, maxDays: 7, maxFailedLogins: 3, lockMinutes: 15 } });
  const admin = new UserAdminService(deps);
  return { auth, admin, users, sessions, advance };
}

const client = { ip: "10.0.0.1", userAgent: "vitest" };

describe("hash de senha (scrypt)", () => {
  it("guarda custo, sal e hash; confere só a senha certa", async () => {
    const hasher = new ScryptPasswordHasher({ N: 2 ** 10, r: 8, p: 1 });
    const hash = await hasher.hash("senha-forte-123");
    expect(hash).toMatch(/^scrypt\$1024\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(await hasher.hash("senha-forte-123")).not.toBe(hash);
    expect(await hasher.verify("senha-forte-123", hash)).toBe(true);
    expect(await hasher.verify("senha-forte-124", hash)).toBe(false);
    expect(await hasher.verify("x", "bcrypt$qualquer")).toBe(false);
    expect(await hasher.verify("x", "scrypt$0$8$1$a$b")).toBe(false);
  });
});

describe("política de senha", () => {
  it("exige tamanho, recusa caractere repetido e o próprio e-mail", () => {
    expect(passwordProblem("curta")).toMatch(/10 caracteres/);
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/repetido/);
    expect(passwordProblem("joaquim2026!", "joaquim@ecolife.com.br")).toMatch(/e-mail/);
    expect(passwordProblem("x".repeat(201))).toMatch(/200/);
    expect(passwordProblem("cavalo-bateria-grampo")).toBeNull();
    expect(generateTemporaryPassword()).toMatch(/^[A-HJ-NP-Za-km-z2-9]{14}$/);
  });
});

describe("AuthService", () => {
  it("login cria sessão com o token só em hash; a sessão expira sem uso e no limite absoluto", async () => {
    const { auth, admin, sessions, advance } = setup();
    await admin.create({ email: " Ana@Ecolife.com.br ", name: "Ana", role: "ADMIN", password: "cavalo-bateria-grampo" }, { mustChangePassword: false });
    const login = await auth.login({ email: "ANA@ecolife.com.br", password: "cavalo-bateria-grampo" }, client);
    expect(login.view).toMatchObject({ email: "ana@ecolife.com.br", role: "ADMIN" });
    const stored = [...sessions.rows.values()][0];
    expect(stored.tokenHash).toBe(hashToken(login.token));
    expect(JSON.stringify(stored)).not.toContain(login.token);

    // Uso a cada 11 h mantém a sessão viva (renovação), até o limite de 7 dias.
    for (let i = 0; i < 15; i++) {
      advance(11 * 3_600_000);
      expect(await auth.authenticate(login.token)).not.toBeNull();
    }
    advance(11 * 3_600_000);
    expect(await auth.authenticate(login.token)).toBeNull();
    expect(sessions.rows.size).toBe(0);

    const again = await auth.login({ email: "ana@ecolife.com.br", password: "cavalo-bateria-grampo" }, client);
    advance(12 * 3_600_000 + 1);
    expect(await auth.authenticate(again.token)).toBeNull();
    expect(await auth.authenticate("token-inexistente")).toBeNull();
    expect(await auth.authenticate(undefined)).toBeNull();
  });

  it("bloqueia depois de senhas erradas seguidas, também para e-mail que não existe", async () => {
    const { auth, admin, advance } = setup();
    await admin.create({ email: "ana@ecolife.com.br", name: "Ana", role: "ADMIN", password: "cavalo-bateria-grampo" }, { mustChangePassword: false });
    for (let i = 0; i < 3; i++) await expect(auth.login({ email: "ana@ecolife.com.br", password: "errada-errada" }, client)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(auth.login({ email: "ana@ecolife.com.br", password: "cavalo-bateria-grampo" }, client)).rejects.toMatchObject({ code: "TOO_MANY_ATTEMPTS", retryAfterSeconds: 900 });
    for (let i = 0; i < 3; i++) await expect(auth.login({ email: "ninguem@ecolife.com.br", password: "qualquer-uma" }, client)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(auth.login({ email: "ninguem@ecolife.com.br", password: "qualquer-uma" }, client)).rejects.toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
    advance(15 * 60_000);
    await expect(auth.login({ email: "ana@ecolife.com.br", password: "cavalo-bateria-grampo" }, client)).resolves.toMatchObject({ view: { locked: false } });
  });

  it("usuário desativado não entra nem mantém sessão; troca de senha encerra as outras sessões", async () => {
    const { auth, admin, sessions } = setup();
    const { user } = await admin.create({ email: "bia@ecolife.com.br", name: "Bia", role: "OPERATOR", password: "senha-temporaria-1" });
    expect(user.mustChangePassword).toBe(true);
    const a = await auth.login({ email: "bia@ecolife.com.br", password: "senha-temporaria-1" }, client);
    const b = await auth.login({ email: "bia@ecolife.com.br", password: "senha-temporaria-1" }, client);
    await expect(auth.changePassword(user.id, a.session.id, { currentPassword: "outra-coisa-aqui", newPassword: "nova-senha-da-bia" })).rejects.toMatchObject({ fieldErrors: { currentPassword: expect.any(String) } });
    await expect(auth.changePassword(user.id, a.session.id, { currentPassword: "senha-temporaria-1", newPassword: "senha-temporaria-1" })).rejects.toMatchObject({ fieldErrors: { newPassword: expect.any(String) } });
    const changed = await auth.changePassword(user.id, a.session.id, { currentPassword: "senha-temporaria-1", newPassword: "nova-senha-da-bia" });
    expect(changed.mustChangePassword).toBe(false);
    expect(await auth.authenticate(a.token)).not.toBeNull();
    expect(await auth.authenticate(b.token)).toBeNull();

    await admin.create({ email: "chefe@ecolife.com.br", name: "Chefe", role: "ADMIN", password: "girassol-azul-77" });
    await admin.update(user.id, { active: false }, "outro");
    expect(sessions.rows.size).toBe(0);
    await expect(auth.login({ email: "bia@ecolife.com.br", password: "nova-senha-da-bia" }, client)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
});

describe("UserAdminService", () => {
  it("cria com senha temporária, recusa e-mail repetido e protege o último administrador", async () => {
    const { admin } = setup();
    const created = await admin.create({ email: "ana@ecolife.com.br", name: "Ana", role: "ADMIN" });
    expect(created.temporaryPassword).toHaveLength(14);
    await expect(admin.create({ email: "ANA@ecolife.com.br", name: "Outra", role: "OPERATOR" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(admin.create({ email: "c@ecolife.com.br", name: "C", role: "OPERATOR", password: "curta" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(admin.update(created.user.id, { active: false }, created.user.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin.update(created.user.id, { role: "OPERATOR" }, "alguém")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(admin.update("nao-existe", { name: "X" }, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(admin.resetPassword("nao-existe")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(admin.get("nao-existe")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { after } = await admin.update(created.user.id, { name: "Ana Souza" }, created.user.id);
    expect(after.name).toBe("Ana Souza");
  });

  it("primeiro administrador pelas variáveis só quando não há usuários; terminal cria ou redefine", async () => {
    const { admin, auth } = setup();
    expect(await admin.bootstrapAdmin({ email: "admin@ecolife.com.br" })).toBeNull();
    const first = await admin.bootstrapAdmin({ email: "admin@ecolife.com.br", password: "senha-inicial-123" });
    expect(first).toMatchObject({ role: "ADMIN", name: "Administrador", mustChangePassword: false });
    expect(await admin.bootstrapAdmin({ email: "outro@ecolife.com.br", password: "senha-inicial-123" })).toBeNull();

    expect((await admin.upsertFromCli({ email: "ops@ecolife.com.br", name: "Ops", role: "OPERATOR", password: "senha-de-ops-123" })).created).toBe(true);
    const reset = await admin.upsertFromCli({ email: "admin@ecolife.com.br", name: "", role: "ADMIN", password: "girassol-verde-88" });
    expect(reset).toMatchObject({ created: false, user: { name: "Administrador", active: true } });
    await expect(admin.upsertFromCli({ email: "admin@ecolife.com.br", name: "", role: "ADMIN", password: "curta" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(auth.login({ email: "admin@ecolife.com.br", password: "girassol-verde-88" }, client)).resolves.toBeTruthy();
    expect(await auth.purgeExpiredSessions()).toBe(0);
  });

  it("primeiro administrador criado ao mesmo tempo por outro processo não derruba a inicialização", async () => {
    const { admin, users } = setup();
    const original = users.insert.bind(users);
    users.insert = async (user) => {
      await original({ ...user, id: "do-outro-processo" });
      throw new Error('duplicate key value violates unique constraint "users_email_unique"');
    };
    expect(await admin.bootstrapAdmin({ email: "admin@ecolife.com.br", password: "senha-inicial-123" })).toBeNull();
    users.rows.clear();
    users.insert = async () => {
      throw new Error("banco fora do ar");
    };
    await expect(admin.bootstrapAdmin({ email: "admin@ecolife.com.br", password: "senha-inicial-123" })).rejects.toThrow("banco fora do ar");
  });
});
