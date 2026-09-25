import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RegionType } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface RegionItem {
  id: string;
  name: string;
  type: RegionType;
  parentId?: string;
  // The official ECI number: the AC number on a CONSTITUENCY, the polling
  // station number on a BOOTH ("142", "12A"). Unique among siblings, not
  // globally — every Constituency numbers its stations from 1.
  number?: string | null;
}

export function useRegions() {
  return useQuery({
    queryKey: ["regions"],
    queryFn: () => api.get<RegionItem[]>("/regions"),
  });
}

export function useCreateRegion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: { name: string; type: RegionType; parentId?: string; number?: string }) =>
      api.post<RegionItem>("/regions", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["regions"] }),
  });
}

export function useUpdateRegion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: { id: string; name?: string; parentId?: string; type?: RegionType; number?: string }) =>
      api.patch<RegionItem>(`/regions/${id}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["regions"] }),
  });
}

export function useDeleteRegion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/regions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["regions"] }),
  });
}
