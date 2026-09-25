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

export interface CampaignWithProgress {
  id: string;
  name: string;
  status: string;
  priority: string;
  progressPct: number;
}

export interface RegionLeaderboardEntry {
  regionId: string;
  regionName: string;
  achievementPct: number;
}

export interface CadreLeaderboardEntry {
  id: string;
  name: string;
  completed: number;
  total: number;
}

/**
 * WhatsApp delivery, derived live from the Message Log rather than stored —
 * so these numbers and the Message Log page can never disagree.
 *
 * `delivered` includes `read`, and `sent` includes both: they are stages of
 * one message's life, not separate buckets. Rates are of `total`.
 */
export interface CommunicationStats {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  deliveryRatePct: number;
  readRatePct: number;
  failureRatePct: number;
}

export interface AnalyticsOverview {
  targetAchievementPct: number;
  totalTarget: number;
  totalAchieved: number;
  budgetUtilizationPct: number;
  totalAllocatedBudget: number;
  totalSpentBudget: number;
  taskCompletionPct: number;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  openGrievances: number;
  totalGrievances: number;
  grievanceResolutionPct: number;
  pendingExpenses: { count: number; amount: number };
  campaigns: CampaignWithProgress[];
  communication: CommunicationStats;
  // SUPER_ADMIN only
  regionLeaderboard?: { top: RegionLeaderboardEntry[]; bottom: RegionLeaderboardEntry[] };
  // ADMIN only
  myRegionRank?: { rank: number; of: number; regionName: string } | null;
  cadreLeaderboard?: CadreLeaderboardEntry[];
}

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: () => api.get<AnalyticsOverview>("/analytics/overview"),
  });
}
