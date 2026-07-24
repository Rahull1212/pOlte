import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateAllocationDto, SubAllocateDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface AllocationNode {
  id: string;
  regionId: string;
  region: { id: string; name: string; type: string };
  ownerUser: { id: string; name: string; role: string };
  target: number;
  achievedCount: number;
  allocatedBudget: string;
  spentBudget: string;
  remainingBudget: number;
  deadline: string;
  children: AllocationNode[];
}

export function useAllocationTree(campaignId: string) {
  return useQuery({
    queryKey: ["allocations", "tree", campaignId],
    queryFn: () => api.get<AllocationNode[]>(`/campaigns/${campaignId}/allocations/tree`),
    enabled: Boolean(campaignId),
  });
}

export function useCreateRootAllocation(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateAllocationDto) => api.post(`/campaigns/${campaignId}/allocations`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["allocations", "tree", campaignId] }),
  });
}

export function useSubAllocate(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: SubAllocateDto) => api.post("/allocations/sub-allocate", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["allocations", "tree", campaignId] }),
  });
}
