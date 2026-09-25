import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GrievanceStatus, Role, SubmitGrievanceDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";
import { getToken } from "@/lib/auth";

export interface Grievance {
  id: string;
  category: string;
  description: string;
  status: GrievanceStatus;
  resolutionNotes?: string | null;
  /** Evidence URLs served from the API's /uploads path. */
  attachmentUrls: string[];
  citizen?: { id: string; name: string; address?: string } | null;
  region: { id: string; name: string; type: string };
  submittedBy: { id: string; name: string; role: Role };
  submittedByRole: Role;
  resolvedBy?: { id: string; name: string } | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useGrievances(status?: GrievanceStatus) {
  return useQuery({
    queryKey: ["grievances", status],
    queryFn: () => api.get<Grievance[]>(`/grievances${status ? `?status=${status}` : ""}`),
  });
}

export function useSubmitGrievance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: SubmitGrievanceDto) => api.post<Grievance>("/grievances", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grievances"] }),
  });
}

/**
 * Uploads evidence and returns the stored URLs, which then go into the
 * submit payload. Mirrors useUploadTaskAttachments — multipart has to
 * bypass the JSON api client, which sets its own Content-Type.
 */
export function useUploadGrievanceAttachments() {
  return useMutation({
    mutationFn: async (files: File[]) => {
      const token = getToken();
      const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      const response = await fetch(`${baseUrl}/api/grievances/attachments`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(body.message ?? "Upload failed");
      }
      return (await response.json()) as { urls: string[] };
    },
  });
}

/** Super Admin only — the backend rejects everyone else with 403. */
export function useDecideGrievance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, notes }: { id: string; action: "resolve" | "reject"; notes: string }) =>
      api.patch<Grievance>(`/grievances/${id}/${action}`, { resolutionNotes: notes }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grievances"] }),
  });
}

/** Super Admin only: the OPEN -> IN_PROGRESS review step. */
export function useUpdateGrievanceStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: GrievanceStatus; notes?: string }) =>
      api.patch<Grievance>(`/grievances/${id}/status`, { status, resolutionNotes: notes }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grievances"] }),
  });
}

export function useDeleteGrievance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/grievances/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grievances"] }),
  });
}
