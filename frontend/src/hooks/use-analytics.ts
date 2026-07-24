import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export interface CampaignProgress {
  targetAchievementPct: number;
  budgetUtilizationPct: number;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  pendingApprovalBudget: number;
}

export interface RegionProgress {
  regionId: string;
  regionName: string;
  target: number;
  achieved: number;
  achievementPct: number;
  allocatedBudget: number;
  spentBudget: number;
}

export function useCampaignProgress(campaignId: string) {
  return useQuery({
    queryKey: ["analytics", "campaign", campaignId],
    queryFn: () => api.get<CampaignProgress>(`/analytics/campaign/${campaignId}`),
    enabled: Boolean(campaignId),
  });
}

export function useDistrictProgress(campaignId: string) {
  return useQuery({
    queryKey: ["analytics", "district-progress", campaignId],
    queryFn: () => api.get<RegionProgress[]>(`/analytics/district-progress?campaignId=${campaignId}`),
    enabled: Boolean(campaignId),
  });
}
