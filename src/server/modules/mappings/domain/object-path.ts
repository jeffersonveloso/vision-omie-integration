/**
 * Leitura/escrita de caminhos em objetos: `a.b.c`, `lista[0].campo`.
 * Usado tanto para ler o pedido Vision quanto para montar o payload Omie.
 */

type Segment = string | number;

export function parsePath(path: string): Segment[] {
  const segments: Segment[] = [];
  for (const part of path.split(".")) {
    if (!part) continue;
    const re = /([^[\]]+)|\[(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(part))) {
      if (match[1] !== undefined) segments.push(match[1]);
      else segments.push(Number(match[2]));
    }
  }
  return segments;
}

export function getPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of parsePath(path)) {
    if (current === null || current === undefined) return undefined;
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      if (typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current;
}

export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = parsePath(path);
  let current: Record<string, unknown> | unknown[] = target;
  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    const nextIsIndex = typeof segments[index + 1] === "number";
    const container = current as Record<string | number, unknown>;
    if (isLast) {
      container[segment] = value;
      return;
    }
    if (container[segment] === undefined || container[segment] === null || typeof container[segment] !== "object") {
      container[segment] = nextIsIndex ? [] : {};
    }
    current = container[segment] as Record<string, unknown> | unknown[];
  });
}

/** Lista caminhos "folha" de um objeto (para sugerir campos do Vision na interface). */
export function collectLeafPaths(source: unknown, prefix = "", depth = 0, out = new Map<string, unknown>()): Map<string, unknown> {
  if (depth > 6) return out;
  if (Array.isArray(source)) {
    const first = source.find((x) => x !== null && x !== undefined);
    if (first !== undefined && typeof first === "object") collectLeafPaths(first, `${prefix}[]`, depth + 1, out);
    else if (prefix) out.set(`${prefix}[]`, first);
    return out;
  }
  if (source && typeof source === "object") {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object") collectLeafPaths(value, path, depth + 1, out);
      else if (!out.has(path)) out.set(path, value);
    }
  }
  return out;
}
