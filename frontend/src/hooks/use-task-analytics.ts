import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export interface TaskAnalyticsFilters {
  dateFrom?: string;
  dateTo?: string;
  districtId?: string;
  constituencyId?: string;
  status?: string;
  priority?: string;
  taskType?: "BULK" | "INDIVIDUAL";
}

function queryString(filters: TaskAnalyticsFilters = {}): string {
  const entries = Object.entries(filters).filter(([, v]) => Boolean(v)) as [string, string][];
  const qs = new URLSearchParams(entries).toString();
  return qs ? `?${qs}` : "";
}

export interface TaskAnalyticsScope {
  isOrgWide: boolean;
  areaName: string | null;
  areaType: string | null;
}

export interface TaskAnalyticsOverview {
  totalTasks: number;
  totalCadresAllocated: number;
  messagesSent: number;
  delivered: number;
  read: number;
  responded: number;
  completed: number;
  pending: number;
  overdue: number;
  failedWhatsapp: number;
  completionPct: number;
  avgCompletionHours: number | null;
}

export interface CadreOverview {
  totalCadres: number;
  activeCadres: number;
  cadresWithTasks: number;
  cadresWithPendingTasks: number;
  cadresWithCompletedTasks: number;
  avgCadreCompletionPct: number;
}

export interface TaskWiseRow {
  taskId: string;
  name: string;
  allocatedCadres: number;
  total: number;
  messagesSent: number;
  delivered: number;
  read: number;
  failed: number;
  responded: number;
  completed: number;
  overdue: number;
  pending: number;
  completionPct: number;
}

export interface CadreAnalyticsRow {
  cadreId: string;
  name: string;
  district: string | null;
  constituency: string | null;
  tasksAssigned: number;
  tasksCompleted: number;
  pending: number;
  overdue: number;
  completionPct: number;
  avgCompletionHours: number | null;
}

export interface ConstituencyAnalyticsRow {
  constituency: string;
  cadres: number;
  total: number;
  messagesSent: number;
  delivered: number;
  read: number;
  failed: number;
  responded: number;
  completed: number;
  overdue: number;
  pending: number;
  completionPct: number;
}

export interface DistrictAnalyticsRow {
  district: string;
  cadres: number;
  total: number;
  messagesSent: number;
  delivered: number;
  read: number;
  failed: number;
  responded: number;
  completed: number;
  overdue: number;
  pending: number;
  completionPct: number;
}

export interface TaskAnalyticsCharts {
  taskCompletion: { name: string; value: number }[];
  communicationFunnel: { stage: string; count: number }[];
  deliveryPct: number;
  responsePct: number;
  completionByConstituency: { name: string; completionPct: number }[];
  cadrePerformance: { name: string; completionPct: number; completed: number; total: number }[];
  overdueByConstituency: { name: string; overdue: number }[];
  tasksByPriority: { name: string; value: number }[];
  tasksCreatedOverTime: { date: string; count: number }[];
  completionTrend: { date: string; count: number }[];
}

export interface ActionItem {
  taskId: string;
  cadreId: string;
  cadreName: string;
  taskName: string;
  deadline?: string;
}

export interface AnomalyItem {
  cadreId: string;
  name: string;
  completionPct: number;
  teamAvgCompletionPct: number;
}

export interface ActionCenter {
  followUp: ActionItem[];
  atRisk: ActionItem[];
  whatsappFailures: ActionItem[];
  anomalies: AnomalyItem[];
}

export interface TaskAiInsightItem {
  category: string;
  icon: string;
  text: string;
}

export interface TaskAiInsights {
  items: TaskAiInsightItem[];
}

export function useTaskAnalyticsScope() {
  return useQuery({
    queryKey: ["task-analytics", "scope"],
    queryFn: () => api.get<TaskAnalyticsScope>("/task-analytics/scope"),
  });
}

export function useTaskAnalyticsOverview(filters: TaskAnalyticsFilters) {
  return useQuery({
    queryKey: ["task-analytics", "overview", filters],
    queryFn: () => api.get<TaskAnalyticsOverview>(`/task-analytics/overview${queryString(filters)}`),
  });
}

export function useCadreOverview(filters: TaskAnalyticsFilters) {
  return useQuery({
    queryKey: ["task-analytics", "cadre-overview", filters],
    queryFn: () => api.get<CadreOverview>(`/task-analytics/cadre-overview${queryString(filters)}`),
  });
}

export function useTaskWiseAnalytics(filters: TaskAnalyticsFilters) {
  return useQuery({
    queryKey: ["task-analytics", "tasks", filters],
    queryFn: () => api.get<TaskWiseRow[]>(`/task-analytics/tasks${queryString(filters)}`),
  });
}

export function useCadreAnalytics(filters: TaskAnalyticsFilters) {
  return useQuery({
    queryKey: ["task-analytics", "cadres", filters],
    queryFn: () => api.get<CadreAnalyticsRow[]>(`/task-analytics/cadres${queryString(filters)}`),
  });
}

export function useConstituencyAnalytics(filters: TaskAnalyticsFilters) {
  return useQuery({
    queryKey: ["task-analytics", "constituencies", filters],
    queryFn: () => api.get<ConstituencyAnalyticsRow[]>(`/task-analytics/constituencies${queryString(filters)}`),
  });
}

export function useDistrictAnalytics(filters: TaskAnalyticsFilters) {
  return useQuery({
    queryKey: ["task-analytics", "districts", filters],
    queryFn: () => api.get<DistrictAnalyticsRow[]>(`/task-analytics/districts${queryString(filters)}`),
  });
}

export function useTaskAnalyticsCharts(filters: TaskAnalyticsFilters) {
  return useQuery({
    queryKey: ["task-analytics", "charts", filters],
    queryFn: () => api.get<TaskAnalyticsCharts>(`/task-analytics/charts${queryString(filters)}`),
  });
}

export function useActionCenter(filters: TaskAnalyticsFilters) {
  return useQuery({
    queryKey: ["task-analytics", "action-center", filters],
    queryFn: () => api.get<ActionCenter>(`/task-analytics/action-center${queryString(filters)}`),
  });
}

export function useGenerateTaskAiInsights(filters: TaskAnalyticsFilters) {
  return useMutation({
    mutationFn: () => api.post<TaskAiInsights>(`/task-analytics/ai-insights${queryString(filters)}`),
  });
}

export function useAskTaskAi() {
  return useMutation({
    mutationFn: ({ question, filters }: { question: string; filters?: TaskAnalyticsFilters }) =>
      api.post<{ answer: string }>("/task-analytics/ask", { question, filters }),
  });
}
