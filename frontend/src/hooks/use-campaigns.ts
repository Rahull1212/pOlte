import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateCampaignDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface Campaign {
  id: string;
  name: string;
  description: string;
  priority: string;
  status: string;
  totalTarget: number;
  totalBudget: string;
  startDate: string;
  endDate: string;
}

export interface DashboardSummary {
  active: number;
  upcoming: number;
  completed: number;
  totalTarget: number;
  totalBudget: number;
  overallProgress: number;
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: ["campaigns", "dashboard-summary"],
    queryFn: () => api.get<DashboardSummary>("/campaigns/dashboard-summary"),
  });
}

export function useCampaigns(filters: { status?: string; priority?: string } = {}) {
  const params = new URLSearchParams(filters as Record<string, string>).toString();
  return useQuery({
    queryKey: ["campaigns", filters],
    queryFn: () => api.get<Campaign[]>(`/campaigns${params ? `?${params}` : ""}`),
  });
}

export function useCampaign(id: string) {
  return useQuery({
    queryKey: ["campaigns", id],
    queryFn: () => api.get<Campaign & { allocations: unknown[] }>(`/campaigns/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateCampaignDto) => api.post<Campaign>("/campaigns", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}
