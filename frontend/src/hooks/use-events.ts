import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateEventDto, EventRsvpStatus } from "@/lib/shared-types";
import { api } from "@/lib/api-client";
import { getToken } from "@/lib/auth";

// Kept as the name `EventItem` — components/upcoming-events.tsx (used by all
// three role dashboards) imports this type and only reads id/name/startAt,
// so extending it here (rather than renaming) keeps those working untouched.
export interface EventItem {
  id: string;
  name: string;
  description?: string | null;
  regionId: string;
  location?: string | null;
  district?: string | null;
  startAt: string;
  endAt?: string | null;
  status: "UPCOMING" | "ONGOING" | "COMPLETED";
  invitedCount: number;
  attendedCount: number;
  createdAt: string;
}

export interface EventAssignedMember {
  id: string;
  name: string;
  area: string;
  rsvpStatus: EventRsvpStatus;
  attended: boolean;
  checkedInAt: string | null;
}

export interface EventDetail {
  id: string;
  name: string;
  startAt: string;
  endAt: string | null;
  location: string | null;
  objective: string | null;
  description: string | null;
  organizer: string | null;
  district: string | null;
  constituency: string | null;
  pollingStation: string | null;
  expectedAttendees: number | null;
  assignedMembers: EventAssignedMember[];
  instructions: string | null;
  remarks: string | null;
  attachmentUrls: string[];
  createdByName: string;
  createdAt: string;
  status: "UPCOMING" | "ONGOING" | "COMPLETED";
}

export interface EventDashboardMember {
  userId: string;
  name: string;
  area: string;
  rsvpStatus: EventRsvpStatus;
  attended: boolean;
  checkedInAt: string | null;
}

export interface EventDashboard {
  id: string;
  name: string;
  remarks: string | null;
  kpis: {
    totalInvited: number;
    confirmed: number;
    declined: number;
    noResponse: number;
    attended: number;
    notAttended: number;
    attendancePct: number;
    checkedIn: number;
    pendingCheckIn: number;
    lateArrivals: number;
  };
  districtWise: { district: string; invited: number; attended: number; attendancePct: number }[];
  constituencyWise: { constituency: string; invited: number; attended: number; attendancePct: number }[];
  memberWise: EventDashboardMember[];
  attendanceTrend: { date: string; checkedIn: number }[];
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

export function useEventDetail(eventId: string) {
  return useQuery({
    queryKey: ["events", eventId, "detail"],
    queryFn: () => api.get<EventDetail>(`/events/${eventId}/detail`),
    enabled: Boolean(eventId),
  });
}

export function useEventDashboard(eventId: string) {
  return useQuery({
    queryKey: ["events", eventId, "dashboard"],
    queryFn: () => api.get<EventDashboard>(`/events/${eventId}/dashboard`),
    enabled: Boolean(eventId),
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

export function useUploadEventAttachments() {
  return useMutation({
    mutationFn: async (files: File[]) => {
      const token = getToken();
      const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      const response = await fetch(`${baseUrl}/api/events/attachments`, {
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

export function useMarkAttendance(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, attended }: { userId: string; attended: boolean }) =>
      api.post(`/events/${eventId}/attendance`, { userId, attended }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events", eventId, "detail"] });
      queryClient.invalidateQueries({ queryKey: ["events", eventId, "dashboard"] });
    },
  });
}

export function useUpdateEventRsvp(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, rsvpStatus }: { userId: string; rsvpStatus: "CONFIRMED" | "DECLINED" }) =>
      api.post(`/events/${eventId}/rsvp`, { userId, rsvpStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events", eventId, "detail"] });
      queryClient.invalidateQueries({ queryKey: ["events", eventId, "dashboard"] });
    },
  });
}
