import { VISION_FIELD_CATALOG } from "@/server/infrastructure/vision/vision-field-catalog";
import { handler, json } from "@/server/infrastructure/http/route-handler";
import {
  DOCUMENT_TYPE_LABELS,
  LOOKUP_ENTITY_LABELS,
  SOURCE_TYPE_LABELS,
  TRANSFORM_LABELS,
} from "@/server/modules/mappings/domain/types";
import { ITEM_COLLECTIONS } from "@/server/modules/mappings/domain/target-field-catalog";

/** Metadados da tela de mapeamento: tipos, transformações e campos do Vision (Swagger + pedidos reais). */
export const GET = handler(async (_req, c) => {
  const discovered = await c.queries.visionFieldPaths(40);
  const known = new Map(VISION_FIELD_CATALOG.map((f) => [`${f.scope}:${f.path}`, f]));
  const visionFields: Array<{ path: string; scope: "header" | "item" | "service"; type: string; description: string; example: unknown; discovered: boolean }> = VISION_FIELD_CATALOG.map((f) => ({ ...f, example: null, discovered: false }));
  for (const d of discovered) {
    let scope: "header" | "item" | "service" = "header";
    let path = d.path;
    if (path.startsWith("itens[].")) {
      scope = "item";
      path = path.slice("itens[].".length);
    } else if (path.startsWith("servicos[].")) {
      scope = "service";
      path = path.slice("servicos[].".length);
    } else if (path.includes("[]")) continue;
    const existing = known.get(`${scope}:${path}`);
    const entry = visionFields.find((f) => f.scope === scope && f.path === path);
    if (entry) {
      entry.example = d.example;
      entry.discovered = true;
    } else if (!existing) {
      visionFields.push({ path, scope, type: typeof d.example, description: "Encontrado nos pedidos recebidos", example: d.example, discovered: true });
    }
  }
  return json({
    documentTypes: DOCUMENT_TYPE_LABELS,
    sourceTypes: SOURCE_TYPE_LABELS,
    transforms: TRANSFORM_LABELS,
    lookupEntities: LOOKUP_ENTITY_LABELS,
    itemCollections: ITEM_COLLECTIONS,
    visionFields: visionFields.sort((a, b) => a.scope.localeCompare(b.scope) || a.path.localeCompare(b.path)),
  });
});
