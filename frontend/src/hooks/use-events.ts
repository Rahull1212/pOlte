import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateEventDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface EventItem {
  id: string;
  name: string;
  description?: string;
  regionId: string;
  startAt: string;
  endAt?: string;
}

export interface EventReport {
  eventId: string;
  eventName: string;
  totalInvited: number;
  totalAttended: number;
  attendanceRate: number;
}

export function useEvents() {
  return useQuery({
    queryKey: ["events"],
    queryFn: () => api.get<EventItem[]>("/events"),
  });
}

export function useEventReport(eventId: string) {
  return useQuery({
    queryKey: ["events", eventId, "report"],
    queryFn: () => api.get<EventReport>(`/events/${eventId}/report`),
    enabled: Boolean(eventId),
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateEventDto) => api.post<EventItem>("/events", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["events"] }),
  });
}

export function useMarkAttendance(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, attended }: { userId: string; attended: boolean }) =>
      api.post(`/events/${eventId}/attendance`, { userId, attended }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["events", eventId] }),
  });
}
