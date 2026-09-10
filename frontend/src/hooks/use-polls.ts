import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreatePollDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface PollListItem {
  id: string;
  question: string;
  options: string[];
  awaitingAllocation: boolean;
  recipientCount: number;
  answeredCount: number;
  createdByName: string;
  deadline: string | null;
  createdAt: string;
}

export interface PollRecipient {
  id: string;
  cadreName: string;
  area: string;
  status: "PENDING" | "SENT" | "FAILED" | "ANSWERED";
  selectedOption: number | null;
  answeredAt: string | null;
}

// Overview only — question, options, area, allocate action, and who it
// went to. The vote tally/KPI breakdown lives on the Dashboard instead,
// same split as Task's detail vs. dashboard pages.
export interface PollDetail {
  id: string;
  question: string;
  options: string[];
  districts: string[];
  awaitingAllocation: boolean;
  deadline: string | null;
  createdByName: string;
  createdAt: string;
  recipients: PollRecipient[];
}

export interface PollDashboardRespondent {
  id: string;
  cadreName: string;
  area: string;
  status: "PENDING" | "SENT" | "FAILED" | "ANSWERED";
  selectedOption: number | null;
  sentAt: string | null;
  answeredAt: string | null;
}

export interface PollTimelineEvent {
  type: "SENT" | "ANSWERED";
  cadreName: string;
  at: string;
  detail?: string;
}

export interface PollDashboard {
  id: string;
  question: string;
  options: string[];
  kpis: {
    totalRecipients: number;
    sent: number;
    failed: number;
    answered: number;
    noResponse: number;
    responseRatePct: number;
  };
  tally: { option: string; votes: number }[];
  respondents: PollDashboardRespondent[];
  timeline: PollTimelineEvent[];
}

export function usePollList() {
  return useQuery({
    queryKey: ["polls", "list"],
    queryFn: () => api.get<PollListItem[]>("/polls"),
  });
}

export function usePollDetail(id: string) {
  return useQuery({
    queryKey: ["polls", id],
    queryFn: () => api.get<PollDetail>(`/polls/${id}`),
    enabled: Boolean(id),
  });
}

export function usePollDashboard(id: string) {
  return useQuery({
    queryKey: ["polls", id, "dashboard"],
    queryFn: () => api.get<PollDashboard>(`/polls/${id}/dashboard`),
    enabled: Boolean(id),
  });
}

export function useCreatePoll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePollDto) => api.post<{ id: string; question: string }>("/polls", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["polls"] }),
  });
}

export function useAllocatePoll(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { regionIds: string[]; cadreIds: string[] }) =>
      api.post<{ sentCount: number; failedCount: number }>(`/polls/${id}/allocate`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["polls"] }),
  });
}

// recipientId is one poll recipient row, not a poll id.
export function useRetryPollWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recipientId: string) => api.post(`/polls/recipients/${recipientId}/retry-whatsapp`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["polls"] }),
  });
}
