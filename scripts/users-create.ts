/**
 * Cria um usuário do login próprio pelo terminal, ou redefine a senha de um que já existe
 * (útil para o primeiro administrador e para quem perdeu o acesso de administrador).
 *
 *   npm run users:create -- --email ana@ecolife.com.br --name "Ana Souza" [--role ADMIN|OPERATOR]
 *
 * A senha é pedida no terminal (sem aparecer na tela) ou lida de NEW_USER_PASSWORD.
 * Usa o mesmo banco da aplicação (DATABASE_URL ou PGlite em PGLITE_DATA_DIR).
 */
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { systemClock, uuidGenerator } from "../src/server/shared/application/ports";
import { createDatabase } from "../src/server/infrastructure/database/client";
import { UserAdminService } from "../src/server/modules/identity/application/auth-service";
import { USER_ROLES, type UserRole } from "../src/server/modules/identity/domain/user";
import { DrizzleSessionRepository, DrizzleUserRepository } from "../src/server/modules/identity/infrastructure/drizzle-identity-repositories";
import { ScryptPasswordHasher } from "../src/server/modules/identity/infrastructure/scrypt-password-hasher";

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput?: (s: string) => void };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    // Esconde o que é digitado (mostra só a pergunta).
    output._writeToOutput = (s: string) => {
      if (s.includes(question)) process.stdout.write(question);
    };
  });
}

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string", default: "ADMIN" } } });
  const role = (values.role ?? "ADMIN").toUpperCase() as UserRole;
  if (!values.email || !USER_ROLES.includes(role)) {
    console.error('Uso: npm run users:create -- --email ana@ecolife.com.br --name "Ana Souza" [--role ADMIN|OPERATOR]');
    process.exit(2);
  }
  let password = process.env.NEW_USER_PASSWORD ?? "";
  if (!password) {
    if (!process.stdin.isTTY) {
      console.error("Defina NEW_USER_PASSWORD ou rode num terminal interativo.");
      process.exit(2);
    }
    password = await askHidden("Senha: ");
    if ((await askHidden("Repita a senha: ")) !== password) {
      console.error("As senhas não conferem.");
      process.exit(2);
    }
  }
  const handle = await createDatabase({ url: process.env.DATABASE_URL?.trim() || undefined, pgliteDir: process.env.PGLITE_DATA_DIR ?? "./.data/pglite" });
  try {
    const service = new UserAdminService({ users: new DrizzleUserRepository(handle.db), sessions: new DrizzleSessionRepository(handle.db), hasher: new ScryptPasswordHasher(), ids: uuidGenerator, clock: systemClock });
    const { user, created } = await service.upsertFromCli({ email: values.email, name: values.name ?? "", role, password });
    console.log(`${created ? "Usuário criado" : "Senha redefinida e acesso reativado"}: ${user.name} <${user.email}> (${user.roleLabel}).`);
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
