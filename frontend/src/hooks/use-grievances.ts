import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GrievanceStatus, SubmitGrievanceDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface Grievance {
  id: string;
  category: string;
  description: string;
  status: GrievanceStatus;
  resolutionNotes?: string;
  citizen: { id: string; name: string; address?: string };
  submittedBy: { id: string; name: string };
  createdAt: string;
}

export function useGrievances(status?: GrievanceStatus) {
  return useQuery({
    queryKey: ["grievances", status],
    queryFn: () => api.get<Grievance[]>(`/grievances${status ? `?status=${status}` : ""}`),
  });
}

export function useSubmitGrievance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: SubmitGrievanceDto) => api.post<Grievance>("/grievances", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grievances"] }),
  });
}

export function useDecideGrievance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, notes }: { id: string; action: "resolve" | "reject"; notes: string }) =>
      api.patch(`/grievances/${id}/${action}`, { resolutionNotes: notes }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grievances"] }),
  });
}
