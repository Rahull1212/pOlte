import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { getToken } from "@/lib/auth";

export interface MessageLogRow {
  id: string;
  cadreName: string;
  cadrePhone: string;
  message: string;
  taskName: string | null;
  assignedByName: string | null;
  kind: "ASSIGNMENT" | "RETRY" | "COMPLETION_CHECK" | "NOTIFICATION";
  templateName: string | null;
  channel: string;
  status: string;
  // Meta's own wording when a send was refused, arriving later on a
  // message.failed webhook — the line that explains why nothing arrived.
  failureReason: string | null;
  // Resend bookkeeping — how many retries this message has had, and when the
  // last one was. The row itself always shows the CURRENT state.
  retryCount: number;
  lastRetryAt: string | null;
  sentAt: string;
}

export interface MessageLogFilters {
  search?: string;
  status?: string;
  kind?: string;
  from?: string;
  to?: string;
}

function toQuery(filters: MessageLogFilters, cursor?: string) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// Cursor-paged so a message arriving mid-scroll doesn't shuffle rows between
// pages, which offset paging on a newest-first list would do constantly.
export function useMessageLog(filters: MessageLogFilters) {
  return useInfiniteQuery({
    queryKey: ["message-log", filters],
    queryFn: ({ pageParam }) =>
      api.get<{ rows: MessageLogRow[]; nextCursor: string | null }>(
        `/message-log${toQuery(filters, pageParam as string | undefined)}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export interface MessageLogSummary {
  total: number;
  sent: number;
  failed: number;
}

/**
 * KPI counts over the same rows the table draws from — the status filter is
 * deliberately excluded server-side, so selecting a card narrows the table
 * without zeroing the other two cards.
 */
export function useMessageLogSummary(filters: MessageLogFilters) {
  // Status is stripped from the key as well as the request: including it
  // would refetch identical numbers every time a card is clicked.
  const { status: _status, ...rest } = filters;
  return useQuery({
    queryKey: ["message-log", "summary", rest],
    queryFn: () => api.get<MessageLogSummary>(`/message-log/summary${toQuery(rest)}`),
  });
}

/**
 * Re-sends one logged message using its stored template, recipient and
 * variables. The server updates that row in place, so both the table and the
 * KPI counts are invalidated to pick up the new status.
 */
export function useResendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ row: MessageLogRow; success: boolean; error: string | null }>(`/message-log/${id}/resend`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["message-log"] }),
  });
}

/**
 * Downloads the filtered log as CSV. Done with fetch + a blob rather than a
 * plain link because the endpoint needs the bearer token, which a normal
 * <a href> navigation can't carry.
 */
export async function downloadMessageLogCsv(filters: MessageLogFilters) {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const res = await fetch(`${base}/api/message-log/export${toQuery(filters)}`, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "task-messages.csv";
  link.click();
  URL.revokeObjectURL(url);
}
