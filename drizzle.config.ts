import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/infrastructure/database/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
});
