import { useQuery } from "@tanstack/react-query";
import { Role } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userName: string;
  userRole: Role;
  createdAt: string;
}

/** Super Admin only — powers the Activity Feed. */
export function useRecentActivity(limit = 8) {
  return useQuery({
    queryKey: ["audit-logs", limit],
    queryFn: () => api.get<AuditEntry[]>(`/audit-logs?limit=${limit}`),
  });
}
