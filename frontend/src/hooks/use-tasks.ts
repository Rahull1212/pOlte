import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateTaskBatchDto, CreateTaskDto, ProgressUpdateDto, WhatsappDeliveryStatus } from "@/lib/shared-types";
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

export type TaskSummaryStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "OVERDUE"
  | "NEEDS_ATTENTION"
  | "AWAITING_ALLOCATION"
  // Every assigned Cadre was removed from this task-creation unit (see
  // useRemoveTaskAssignee) — distinct from an individual member's own
  // per-row "CANCELLED" status below, which the batch rollup already
  // collapses into this when everyone's been removed.
  | "CANCELLED";

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
  assignedMembers: {
    id: string;
    // The Cadre's own Task row id — target this with useRemoveTaskAssignee(),
    // not the batch/task-detail id above.
    taskId: string;
    name: string;
    area: string;
    whatsappStatus: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
    fyxoTemplateName: string | null;
    status: Task["status"];
  }[];
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
  mandal: string | null;
  status: Task["status"];
  acknowledgment: Task["acknowledgment"];
  acknowledgedAt: string | null;
  needsReassignment: boolean;
  progressPct: number;
  whatsappStatus: WhatsappDeliveryStatus;
  whatsappSentAt: string | null;
  // null = never asked "have you completed your task?" (most tasks — this
  // is an explicit Admin action, see useSendCompletionCheck), distinct from
  // AWAITING (asked, no reply yet).
  completionConfirmation: "AWAITING" | "YES" | "NO" | null;
  completionCheckSentAt: string | null;
  completionConfirmedAt: string | null;
  lastActivityAt: string | null;
}

export interface TaskProgressFunnelStage {
  stage: string;
  count: number;
}

export interface TaskTimelineEvent {
  type: "ALLOCATED" | "WHATSAPP_SENT" | "WHATSAPP_DELIVERED" | "WHATSAPP_READ" | "RESPONDED" | "PROGRESS_UPDATE" | "COMPLETED";
  cadreName: string;
  at: string;
  detail?: string;
}

export interface TaskDashboard {
  id: string;
  isBatch: boolean;
  name: string;
  remarks?: string | null;
  kpis: {
    totalAssigned: number;
    // Cadres removed from this task (see useRemoveTaskAssignee) — already
    // excluded from every other kpis field below and from totalAssigned
    // itself, kept here only so a removal isn't invisible on the dashboard.
    cancelled: number;
    accepted: number;
    declined: number;
    noResponse: number;
    needsReassignment: number;
    pending: number;
    inProgress: number;
    completed: number;
    overdue: number;
    avgProgressPct: number;
    whatsappSent: number;
    whatsappDelivered: number;
    whatsappRead: number;
    whatsappFailed: number;
    responded: number;
    // Only among Cadres actually asked (completionAsked) — most tasks are
    // never asked at all, and shouldn't dilute the Yes/No split.
    completionAsked: number;
    completionYes: number;
    completionNo: number;
    completionAwaiting: number;
  };
  cadres: TaskDashboardCadre[];
  dailyProgress: { date: string; updatesSubmitted: number; avgCompletionPct: number }[];
  progressFunnel: TaskProgressFunnelStage[];
  timeline: TaskTimelineEvent[];
}

export interface TaskInsights {
  insight: string;
  risks: string;
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

// taskId is the Cadre's own Task row id (TaskDetail.assignedMembers[].taskId),
// not the batch/task-detail id in the URL — same convention as retry-whatsapp.
// taskId is the Cadre's own Task row id, same convention as retry-whatsapp
// and remove-assignee. Requires FYXO_TEMPLATES.TASK_COMPLETION_CHECK to be
// an approved Fyxo template — see TasksService.sendCompletionCheck.
export function useSendCompletionCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.post(`/tasks/${taskId}/completion-check`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useRemoveTaskAssignee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.delete(`/tasks/${taskId}/assignee`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
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

// "Ask AI" scoped to exactly this one task — answers using only this task's own data.
export function useAskAboutTask(id: string) {
  return useMutation({
    mutationFn: (question: string) => api.post<{ answer: string }>(`/tasks/${id}/ask`, { question }),
  });
}

export function usePendingAllocationTasks(enabled = true) {
  return useQuery({
    queryKey: ["tasks", "pending-allocation"],
    queryFn: () => api.get<PendingAllocationTask[]>("/tasks/pending-allocation"),
    enabled,
  });
}

export interface AllocationResult {
  cadreCount: number;
  whatsappFailedCount: number;
  allocated: { taskId: string; cadreId: string; name: string; whatsappStatus: "SENT" | "FAILED" }[];
}

export function useAllocateTask(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { regionIds: string[]; cadreIds: string[] }) =>
      api.post<AllocationResult>(`/tasks/${id}/allocate`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

// taskId here is one Cadre's own Task row (from a dashboard's cadres[]),
// not the batch id — retrying is a per-Cadre delivery concern.
export function useRetryWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.post<{ whatsappStatus: WhatsappDeliveryStatus }>(`/tasks/${taskId}/retry-whatsapp`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
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
