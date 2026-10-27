import { z } from "zod";
import type { AppContainer } from "@/server/container";
import { USER_ROLES } from "@/server/modules/identity/domain/user";
import { DomainError } from "@/server/shared/domain/result";

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome.").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido.").max(200),
  role: z.enum(USER_ROLES, { message: "Escolha o perfil." }),
  /** Vazio = a aplicação gera uma senha temporária. */
  password: z.string().max(200).optional().transform((v) => (v ? v : undefined)),
});

/** Usuários, senhas e login só existem no login próprio (com AUTH_MODE=proxy quem identifica é o proxy). */
export function requireLocalAuth(c: AppContainer): void {
  if (c.config.AUTH_MODE !== "local") throw new DomainError("LOCAL_AUTH_DISABLED", "O login próprio está desligado (AUTH_MODE=proxy): usuários e senhas ficam no proxy de autenticação.");
}

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2, "Informe o nome.").max(120).optional(),
    role: z.enum(USER_ROLES).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nada para alterar.");
