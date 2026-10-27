"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface SessionUser {
  id: string | null;
  email: string | null;
  name: string;
  role: "ADMIN" | "OPERATOR" | "API" | "PROXY";
  roleLabel: string;
  mustChangePassword: boolean;
}

export interface SessionInfo {
  mode: "local" | "proxy";
  user: SessionUser | null;
}

/** Quem está logado. `isError` com 401 = sem sessão (a tela de login cuida disso). */
export function useSession(enabled = true) {
  return useQuery({ queryKey: ["session"], queryFn: () => api.get<SessionInfo>("/api/auth/me"), staleTime: 60_000, retry: false, enabled });
}
