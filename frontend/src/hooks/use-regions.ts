import { useQuery } from "@tanstack/react-query";
import { RegionType } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface RegionItem {
  id: string;
  name: string;
  type: RegionType;
  parentId?: string;
}

export function useRegions() {
  return useQuery({
    queryKey: ["regions"],
    queryFn: () => api.get<RegionItem[]>("/regions"),
  });
}
