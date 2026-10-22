import { IntegrationError } from "@/server/modules/integration/domain/integration-error";
import { handler, json } from "@/server/infrastructure/http/route-handler";

export const POST = handler(async (_req, c) => {
  try {
    const result = await c.vision.testConnection();
    return json({ ok: true, message: result.message });
  } catch (error) {
    const message = error instanceof IntegrationError ? `${error.message}${error.hint ? ` ${error.hint}` : ""}` : String(error);
    return json({ ok: false, message });
  }
});
