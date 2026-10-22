"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "./ui/overlays";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 10_000, refetchOnWindowFocus: true, retry: 1 },
          mutations: { retry: 0 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={200}>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: "!rounded-panel !border !border-border !bg-surface !text-foreground !font-sans !shadow-[0_16px_40px_-16px_rgba(10,23,20,0.45)]",
              description: "!text-muted-foreground",
              error: "!border-error/40",
              success: "!border-done/40",
            },
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
