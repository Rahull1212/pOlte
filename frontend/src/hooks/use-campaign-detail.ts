import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { CampaignAssignmentStatus, CampaignPriority, CampaignStatus, TaskPriority } from "@/lib/shared-types";

/**
 * The Campaign Details page. Each tab loads its own slice so opening the
 * page doesn't pay for the activity timeline or attachment list until those
 * tabs are actually opened — hence `enabled` on everything but the
 * overview.
 */

export interface CampaignOverview {
  campaign: {
    id: string;
    name: string;
    description: string;
    objective: string | null;
    category: string | null;
    status: CampaignStatus;
    priority: CampaignPriority;
    startDate: string;
    endDate: string;
    // Null when none was declared at creation; see campaignBaseSchema.
    totalTarget: number | null;
    totalBudget: number | null;
    expectedVolunteers: number | null;
    requiredDocuments: string[];
    bannerUrl: string | null;
    createdAt: string;
    createdBy: { id: string; name: string } | null;
    assignedAdmins: { id: string; name: string; status: CampaignAssignmentStatus }[];
    /**
     * The viewing Admin's own assignment, or null for anyone who wasn't
     * assigned this campaign (a Super Admin, or a Cadre working its tasks).
     * Drives the accept/decline banner.
     */
    myAssignment: {
      status: CampaignAssignmentStatus;
      respondedAt: string | null;
      responseNote: string | null;
    } | null;
  };
  summary: {
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    pendingTasks: number;
    overdueTasks: number;
    cancelledTasks: number;
    cadreCount: number;
    target: number;
    achieved: number;
    /** False when no TargetAllocation exists — distinct from a target of 0. */
    hasTargets: boolean;
    allocatedBudget: number;
    spentBudget: number;
    pendingApprovalBudget: number;
  };
  progress: {
    targetAchievementPct: number;
    taskCompletionPct: number;
    budgetUsedPct: number;
  };
}

export interface CampaignTaskRow {
  id: string;
  isBatch: boolean;
  taskIds: string[];
  name: string;
  description: string | null;
  status: string;
  priority: TaskPriority;
  assignedBy: { id: string; name: string } | null;
  cadreCount: number;
  areas: string[];
  pollingStation: { name: string; constituency: string | null } | null;
  /** Null when the task isn't linked to a TargetAllocation — no target set. */
  target: number | null;
  achieved: number | null;
  progressPct: number;
  completedCount: number;
  deadline: string;
  createdAt: string;
  awaitingAllocation: boolean;
}

export interface CampaignCadreRow {
  id: string;
  name: string;
  phone: string;
  area: string;
  areaType: string;
  taskCount: number;
  completedCount: number;
  avgProgressPct: number;
  firstAssignedAt: string;
}

export interface CampaignCommunication {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  lastSentAt: string | null;
  templates: { name: string; count: number }[];
  recent: {
    id: string;
    cadreName: string;
    cadrePhone: string;
    taskName: string | null;
    templateName: string | null;
    status: string;
    kind: string;
    failureReason: string | null;
    providerMessageId: string | null;
    sentAt: string;
  }[];
}

export interface CampaignActivityEvent {
  at: string;
  type: string;
  title: string;
  detail: string | null;
  actor: string | null;
}

export interface CampaignAttachment {
  id: string;
  url: string;
  name: string;
  fileType: string;
  source: string;
  uploadedBy: string | null;
  uploadedAt: string | null;
}

export interface TaskAllocation {
  taskId: string;
  cadre: { id: string; name: string; phone: string };
  area: string;
  areaType: string;
  assignedAt: string;
  status: string;
  acknowledgment: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
  progressPct: number;
  lastProgressAt: string | null;
  whatsapp: {
    status: string;
    sentAt: string | null;
    deliveredAt: string | null;
    readAt: string | null;
    templateName: string | null;
    messageId: string | null;
  };
}

export function useCampaignOverview(id: string) {
  return useQuery({
    queryKey: ["campaign-detail", id, "overview"],
    queryFn: () => api.get<CampaignOverview>(`/campaigns/${id}/overview`),
    enabled: Boolean(id),
  });
}

export function useCampaignTasks(id: string, enabled = true) {
  return useQuery({
    queryKey: ["campaign-detail", id, "tasks"],
    queryFn: () => api.get<CampaignTaskRow[]>(`/campaigns/${id}/tasks`),
    enabled: Boolean(id) && enabled,
  });
}

export function useCampaignCadres(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["campaign-detail", id, "cadres"],
    queryFn: () => api.get<CampaignCadreRow[]>(`/campaigns/${id}/cadres`),
    enabled: Boolean(id) && enabled,
  });
}

export function useCampaignCommunication(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["campaign-detail", id, "communication"],
    queryFn: () => api.get<CampaignCommunication>(`/campaigns/${id}/communication`),
    enabled: Boolean(id) && enabled,
  });
}

export function useCampaignActivity(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["campaign-detail", id, "activity"],
    queryFn: () => api.get<CampaignActivityEvent[]>(`/campaigns/${id}/activity`),
    enabled: Boolean(id) && enabled,
  });
}

export function useCampaignAttachments(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["campaign-detail", id, "attachments"],
    queryFn: () => api.get<CampaignAttachment[]>(`/campaigns/${id}/attachments`),
    enabled: Boolean(id) && enabled,
  });
}

/** Per-Cadre allocation rows for one task — powers the task drawer. */
export function useTaskAllocations(taskId: string | null) {
  return useQuery({
    queryKey: ["task-allocations", taskId],
    queryFn: () => api.get<TaskAllocation[]>(`/tasks/${taskId}/allocations`),
    enabled: Boolean(taskId),
  });
}
