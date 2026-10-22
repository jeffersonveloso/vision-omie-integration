import { handler, json } from "@/server/infrastructure/http/route-handler";

/** Formas de pagamento vistas nos pedidos já lidos do Vision, para a tela de condições de pagamento. */
export const GET = handler(async (_req, c) => json({ forms: await c.queries.paymentFormsSeen() }));
