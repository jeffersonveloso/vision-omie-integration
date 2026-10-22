import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/misc";
import { OrdersView } from "./orders-view";

export const metadata: Metadata = { title: "Pedidos" };

export default function OrdersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <OrdersView />
    </Suspense>
  );
}
