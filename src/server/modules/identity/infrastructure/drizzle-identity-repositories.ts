import { and, asc, count, eq, lte, ne } from "drizzle-orm";
import type { Database } from "@/server/infrastructure/database/client";
import { sessions, users } from "@/server/infrastructure/database/schema";
import type { Session, SessionRepository, User, UserRepository, UserRole } from "../domain/user";

const toUser = (row: typeof users.$inferSelect): User => ({ ...row, role: row.role as UserRole });

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async count(): Promise<number> {
    const [{ total }] = await this.db.select({ total: count() }).from(users);
    return Number(total);
  }

  async countActiveAdmins(): Promise<number> {
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.role, "ADMIN"), eq(users.active, true)));
    return Number(total);
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ? toUser(row) : null;
  }

  async list(): Promise<User[]> {
    return (await this.db.select().from(users).orderBy(asc(users.name))).map(toUser);
  }

  async insert(user: User): Promise<void> {
    await this.db.insert(users).values(user);
  }

  async update(id: string, patch: Partial<Omit<User, "id" | "createdAt">>): Promise<void> {
    await this.db.update(users).set(patch).where(eq(users.id, id));
  }
}

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: Database) {}

  async insert(session: Session): Promise<void> {
    await this.db.insert(sessions).values(session);
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
    return row ?? null;
  }

  async touch(id: string, lastSeenAt: Date, expiresAt: Date): Promise<void> {
    await this.db.update(sessions).set({ lastSeenAt, expiresAt }).where(eq(sessions.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  async deleteByUser(userId: string, exceptSessionId?: string): Promise<number> {
    const where = exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)) : eq(sessions.userId, userId);
    return (await this.db.delete(sessions).where(where).returning({ id: sessions.id })).length;
  }

  async purgeExpired(now: Date): Promise<number> {
    return (await this.db.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.id })).length;
  }
}
