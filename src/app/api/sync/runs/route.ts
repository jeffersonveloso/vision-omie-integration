import type { NextRequest } from "next/server";
import { handler, json } from "@/server/infrastructure/http/route-handler";

export const GET = handler(async (request, c) => {
  const search = (request as NextRequest).nextUrl.searchParams;
  const job = search.get("job") ?? undefined;
  return json({ runs: await c.queries.runs(Number(search.get("limit") ?? 50), job), scheduler: c.scheduler.status() });
});
