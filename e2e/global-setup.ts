import { execFileSync } from "node:child_process";
import { APP_URL } from "../playwright.config";

/** Mesma configuração de demonstração do `npm run demo:seed`: contas, regras, de-para e uma coleta. */
export default function globalSetup(): void {
  execFileSync("npx", ["tsx", "scripts/seed-demo.ts"], { env: { ...process.env, APP_URL }, stdio: "inherit" });
}
