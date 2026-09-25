import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

/** One person's press of one button. */
export interface ButtonPresser {
  cadreId: string | null;
  cadreName: string;
  cadrePhone: string;
  taskId: string | null;
  taskName: string | null;
  at: string;
}

export interface ButtonBreakdown {
  /** What the Cadre saw on the button, e.g. "Yes". */
  label: string;
  /** Internal action; QUICK_REPLY for any button outside the known two. */
  action: string;
  count: number;
  cadres: ButtonPresser[];
}

export interface EngagementSummary {
  totalSent: number;
  delivered: number;
  failed: number;
  responded: number;
  notResponded: number;
  responseRatePct: number;
  /** One entry per button, counted per person rather than per tap. */
  byButton: ButtonBreakdown[];
  /** Answers that were typed or sent as media rather than a button press. */
  otherResponses: number;
}

export interface EngagementFilters {
  taskId?: string;
  /** A whole batch — one fan-out to many Cadres, which is what a Task
   *  Dashboard usually is. Passing a batch id as taskId matches nothing. */
  batchId?: string;
  /** One poll — its answers are button presses on that poll's template. */
  pollId?: string;
  campaignId?: string;
  from?: string;
  to?: string;
}

function query(filters: EngagementFilters) {
  const entries = Object.entries(filters).filter(([, v]) => Boolean(v)) as [string, string][];
  const qs = new URLSearchParams(entries).toString();
  return qs ? `?${qs}` : "";
}

/**
 * Who pressed which button on the messages we sent.
 *
 * Scoped server-side — an Admin sees only their own sends — so the same call
 * is safe from either role's dashboard.
 */
export function useEngagementSummary(filters: EngagementFilters = {}, enabled = true) {
  return useQuery({
    queryKey: ["engagement", "summary", filters],
    queryFn: () => api.get<EngagementSummary>(`/message-log/engagement/summary${query(filters)}`),
    enabled,
  });
}
