import { Check, X } from "lucide-react";
import type { IntegrationStep } from "@/server/modules/integration/domain/integration-error";
import type { OrderStatus } from "@/server/modules/integration/domain/integration-order";
import { cn } from "@/lib/utils";
import { Tooltip } from "./ui/overlays";

/**
 * O "trilho" do pedido: as seis estações do fluxo de integração.
 * Mostra até onde o pedido chegou e em qual estação ele parou.
 */
export const STATIONS = [
  { key: "vision", label: "Vision", detail: "Coleta e consulta do pedido completo" },
  { key: "route", label: "Roteamento", detail: "Conta Omie pelo CNPJ da empresa" },
  { key: "map", label: "Mapeamento", detail: "Regras de campo e tabelas de-para" },
  { key: "omie", label: "Omie", detail: "Cliente, pedido de venda e/ou OS" },
  { key: "fiscal", label: "Faturamento", detail: "NF-e / NFS-e no Omie" },
  { key: "return", label: "Retorno", detail: "Autorização, títulos e baixas no Vision" },
] as const;

export type StationState = "done" | "current" | "todo" | "failed" | "rejected" | "muted";

const STEP_STATION: Record<IntegrationStep, number> = {
  COLLECT: 0,
  FETCH_DETAIL: 0,
  ROUTE: 1,
  MAP: 2,
  CUSTOMER_SYNC: 3,
  SEND_SALES_ORDER: 3,
  SEND_SERVICE_ORDER: 3,
  CHECK_FISCAL: 4,
  RETURN_FISCAL: 5,
  CHECK_FINANCIAL: 5,
  RETURN_FINANCIAL: 5,
};

export function stationOf(step: IntegrationStep | null | undefined): number {
  return step ? STEP_STATION[step] : 0;
}

export function trackStates(status: OrderStatus, errorStep?: IntegrationStep | null): StationState[] {
  const fill = (fn: (i: number) => StationState) => STATIONS.map((_, i) => fn(i));
  switch (status) {
    case "IGNORED":
      return fill(() => "muted");
    case "CANCELLED":
      return fill(() => "muted");
    case "COMPLETED":
      return fill(() => "done");
    case "SENT":
      return fill((i) => (i < 4 ? "done" : i === 4 ? "current" : "todo"));
    case "REJECTED":
      return fill((i) => (i < 4 ? "done" : i === 4 ? "rejected" : "todo"));
    case "ERROR": {
      const failed = stationOf(errorStep);
      return fill((i) => (i < failed ? "done" : i === failed ? "failed" : "todo"));
    }
    default:
      return fill((i) => (i === 0 ? "done" : i === 1 ? "current" : "todo"));
  }
}

const nodeClass: Record<StationState, string> = {
  done: "bg-foreground border-foreground",
  current: "bg-surface border-sent ring-2 ring-sent/25",
  todo: "bg-surface border-border-strong",
  failed: "bg-error border-error",
  rejected: "bg-rejected border-rejected",
  muted: "bg-muted/40 border-muted/40",
};

const lineClass = (left: StationState, right: StationState) =>
  left === "done" && (right === "done" || right === "failed" || right === "rejected" || right === "current") ? "bg-foreground" : left === "muted" ? "bg-muted/30" : "bg-border-strong";

/** Versão compacta para tabelas. */
export function TrackMini({ status, errorStep, processing }: { status: OrderStatus; errorStep?: IntegrationStep | null; processing?: boolean }) {
  const states = trackStates(status, errorStep);
  const stopIndex = states.findIndex((s) => s === "failed" || s === "rejected" || s === "current");
  const where = stopIndex >= 0 ? STATIONS[stopIndex].label : status === "COMPLETED" ? "Fluxo completo" : STATIONS[0].label;
  return (
    <Tooltip content={<span>{status === "ERROR" ? `Parou em ${where}` : status === "COMPLETED" ? "Passou por todas as estações" : `Estação atual: ${where}`}</span>}>
      <span className="inline-flex items-center" role="img" aria-label={`Trilho do pedido: ${where}`}>
        {states.map((state, i) => (
          <span key={STATIONS[i].key} className="inline-flex items-center">
            {i > 0 ? <span className={cn("h-[2px] w-3", lineClass(states[i - 1], state))} /> : null}
            <span className={cn("size-2.5 rounded-full border-2", nodeClass[state], state === "current" && processing && "animate-pulse")} />
          </span>
        ))}
      </span>
    </Tooltip>
  );
}

/** Versão grande para o detalhe do pedido. */
export function TrackFull({ status, errorStep, captions }: { status: OrderStatus; errorStep?: IntegrationStep | null; captions?: Partial<Record<number, string>> }) {
  const states = trackStates(status, errorStep);
  return (
    <ol className="grid grid-cols-3 gap-y-5 sm:grid-cols-6" aria-label="Estações do fluxo">
      {STATIONS.map((station, i) => {
        const state = states[i];
        return (
          <li key={station.key} className="relative flex flex-col items-start">
            <div className="flex w-full items-center">
              <span
                className={cn(
                  "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold",
                  nodeClass[state],
                  state === "done" && "text-background",
                  (state === "failed" || state === "rejected") && "text-white",
                )}
              >
                {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : state === "failed" ? <X className="size-3.5" strokeWidth={3} /> : state === "rejected" ? "!" : null}
              </span>
              {i < STATIONS.length - 1 ? <span className={cn("h-[3px] flex-1", lineClass(state, states[i + 1]))} /> : null}
            </div>
            <span className={cn("mt-2 text-[13px] font-bold", state === "failed" && "text-error", state === "rejected" && "text-rejected", (state === "todo" || state === "muted") && "text-muted-foreground")}>{station.label}</span>
            <span className="pr-3 text-[12px] leading-snug text-muted-foreground">{captions?.[i] ?? station.detail}</span>
          </li>
        );
      })}
    </ol>
  );
}
