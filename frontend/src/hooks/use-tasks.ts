import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateTaskBatchDto, CreateTaskDto, ProgressUpdateDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";
import { getToken } from "@/lib/auth";

export interface Task {
  id: string;
  name: string;
  objective?: string;
  description?: string;
  additionalDetails?: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  acknowledgment?: "AWAITING" | "ACCEPTED" | "DECLINED";
  needsReassignment?: boolean;
  batchId?: string | null;
  campaignId?: string | null;
  deadline: string;
  assignedTo: { id: string; name: string };
}

export type TaskSummaryStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE" | "NEEDS_ATTENTION" | "AWAITING_ALLOCATION";

export interface TaskListItem {
  id: string;
  isBatch: boolean;
  name: string;
  districts: string[];
  assignedCount: number;
  assignedNames: string[];
  deadline: string;
  priority: Task["priority"];
  status: TaskSummaryStatus;
  progressPct: number;
  createdAt: string;
}

export interface TaskDetail {
  id: string;
  isBatch: boolean;
  awaitingAllocation: boolean;
  name: string;
  objective?: string | null;
  description?: string | null;
  additionalDetails?: string | null;
  remarks?: string | null;
  districts: string[];
  mandals: string[];
  booths: string[];
  assignedMembers: { id: string; name: string; area: string }[];
  deadline: string;
  priority: Task["priority"];
  attachmentUrls: string[];
  createdByName: string;
  createdAt: string;
  currentStatus: TaskSummaryStatus;
}

export interface TaskDashboardCadre {
  taskId: string;
  name: string;
  area: string;
  status: Task["status"];
  acknowledgment: Task["acknowledgment"];
  acknowledgedAt: string | null;
  needsReassignment: boolean;
  progressPct: number;
}

export interface TaskDashboard {
  id: string;
  isBatch: boolean;
  name: string;
  remarks?: string | null;
  kpis: {
    totalAssigned: number;
    accepted: number;
    declined: number;
    noResponse: number;
    needsReassignment: number;
    pending: number;
    inProgress: number;
    completed: number;
    overdue: number;
    avgProgressPct: number;
  };
  cadres: TaskDashboardCadre[];
  dailyProgress: { date: string; updatesSubmitted: number; avgCompletionPct: number }[];
}

export interface TaskInsights {
  insight: string;
  followUp: string;
  generatedAt?: string;
}

export interface PendingAllocationTask {
  id: string;
  name: string;
  objective?: string | null;
  description?: string | null;
  districts: string[];
  deadline: string;
  priority: Task["priority"];
  createdByName: string;
  createdAt: string;
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

export function useCreateTaskBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateTaskBatchDto) =>
      api.post<{ batch: { id: string; name: string }; cadreCount: number; awaitingAllocation: boolean }>(
        "/tasks/batch",
        dto,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useUploadTaskAttachments() {
  return useMutation({
    mutationFn: async (files: File[]) => {
      const token = getToken();
      const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      const response = await fetch(`${baseUrl}/api/tasks/attachments`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(body.message ?? "Upload failed");
      }
      return response.json() as Promise<{ urls: string[] }>;
    },
  });
}

export function useTaskList() {
  return useQuery({
    queryKey: ["tasks", "list"],
    queryFn: () => api.get<TaskListItem[]>("/tasks/list"),
  });
}

export function useTaskDetail(id: string) {
  return useQuery({
    queryKey: ["tasks", id, "detail"],
    queryFn: () => api.get<TaskDetail>(`/tasks/${id}/detail`),
    enabled: Boolean(id),
  });
}

export function useTaskDashboard(id: string) {
  return useQuery({
    queryKey: ["tasks", id, "dashboard"],
    queryFn: () => api.get<TaskDashboard>(`/tasks/${id}/dashboard`),
    enabled: Boolean(id),
  });
}

export function useTaskInsights(id: string) {
  return useQuery({
    queryKey: ["tasks", id, "insights"],
    queryFn: () => api.get<TaskInsights | null>(`/tasks/${id}/insights`),
    enabled: Boolean(id),
  });
}

export function useGenerateTaskInsights(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<TaskInsights>(`/tasks/${id}/insights`),
    onSuccess: (data) => queryClient.setQueryData(["tasks", id, "insights"], data),
  });
}

export function usePendingAllocationTasks(enabled = true) {
  return useQuery({
    queryKey: ["tasks", "pending-allocation"],
    queryFn: () => api.get<PendingAllocationTask[]>("/tasks/pending-allocation"),
    enabled,
  });
}

export function useAllocateTask(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (regionIds: string[]) => api.post<{ cadreCount: number }>(`/tasks/${id}/allocate`, { regionIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useAcknowledgeTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, acknowledgment }: { id: string; acknowledgment: "ACCEPTED" | "DECLINED" }) =>
      api.patch<Task>(`/tasks/${id}/acknowledge`, { acknowledgment }),
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
