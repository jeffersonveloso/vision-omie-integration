import type { DocumentDownloader } from "@/server/modules/integration/application/ports";

/** Baixa PDFs/XMLs pelos links públicos devolvidos pelo Omie (DANFE, NFS-e). */
export class FetchDocumentDownloader implements DocumentDownloader {
  constructor(private readonly timeoutMs = 30_000, private readonly maxBytes = 10 * 1024 * 1024) {}

  async download(url: string): Promise<Buffer | null> {
    if (!/^https?:\/\//i.test(url)) return null;
    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length > this.maxBytes ? null : buffer;
  }
}
