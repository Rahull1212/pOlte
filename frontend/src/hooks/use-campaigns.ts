import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CampaignAssignmentStatus, CreateCampaignDto, RespondToCampaignDto, UpdateCampaignDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface CampaignAdmin {
  adminId: string;
  admin: { id: string; name: string };
  /** Assignment alone isn't agreement — see respondToCampaignSchema. */
  status: CampaignAssignmentStatus;
  respondedAt?: string | null;
  responseNote?: string | null;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  priority: string;
  status: string;
  // Null when the campaign declares no headline figure — the create form
  // doesn't ask for these, they're allocated per area instead.
  totalTarget: number | null;
  totalBudget: string | null;
  startDate: string;
  endDate: string;
  /** The Admins responsible for running this campaign. */
  assignedAdmins?: CampaignAdmin[];
}

export interface DashboardSummary {
  active: number;
  upcoming: number;
  completed: number;
  draft: number;
  /** Every campaign in scope, whatever its status — not a sum of the buckets
   *  above, which would omit drafts. */
  total: number;
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

/** Edit an existing campaign — Super Admin, or one of its own Admins. */
export function useUpdateCampaign(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateCampaignDto) => api.patch<Campaign>(`/campaigns/${id}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      // The detail page reads from its own cache key, which would otherwise
      // still show the pre-edit values after redirecting back to it.
      queryClient.invalidateQueries({ queryKey: ["campaign-detail", id] });
    },
  });
}

/** Campaigns handed to this Admin that they haven't answered yet. */
export function usePendingCampaignAssignments(enabled: boolean) {
  return useQuery({
    queryKey: ["campaigns", "pending-assignments"],
    queryFn: () => api.get<(Campaign & { assignedAt: string; createdBy?: { name: string } })[]>(
      "/campaigns/pending-assignments",
    ),
    enabled,
  });
}

/**
 * The Admin's accept/decline. Invalidates the campaign detail too — the
 * banner and the allocate buttons both key off the new status.
 */
export function useRespondToCampaign(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: RespondToCampaignDto) => api.patch<CampaignAdmin>(`/campaigns/${id}/response`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["campaign-detail", id] });
    },
  });
}
