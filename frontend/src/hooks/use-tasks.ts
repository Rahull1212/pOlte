import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateTaskDto, ProgressUpdateDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface Task {
  id: string;
  name: string;
  description?: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  deadline: string;
  assignedTo: { id: string; name: string };
}

export function useTasks(filters: { campaignId?: string; assignedToId?: string; status?: string }) {
  const definedEntries = Object.entries(filters).filter(([, v]) => Boolean(v)) as [string, string][];
  const params = new URLSearchParams(definedEntries).toString();
  return useQuery({
    queryKey: ["tasks", filters],
    queryFn: () => api.get<Task[]>(`/tasks${params ? `?${params}` : ""}`),
    enabled: definedEntries.length > 0,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateTaskDto) => api.post<Task>("/tasks", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useSubmitProgress(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: ProgressUpdateDto) => api.post(`/tasks/${taskId}/progress`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });
}
