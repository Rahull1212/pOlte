import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BulkCampaignStatus, BulkRecipientStatus, BulkRecipientSelectionDto, ComposeBulkMessageDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";
import { getToken } from "@/lib/auth";

export interface BulkCampaign {
  id: string;
  name: string;
  messageText: string | null;
  mediaUrl: string | null;
  templateId: string | null;
  status: BulkCampaignStatus;
  totalContacts: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  createdAt: string;
  sentAt: string | null;
  createdBy?: { name: string };
  fyxoConfigured?: boolean;
}

export interface BulkRecipient {
  id: string;
  campaignId: string;
  name: string | null;
  phone: string;
  rawPhone: string;
  districtName: string | null;
  constituencyName: string | null;
  boothName: string | null;
  regionId: string | null;
  isValidPhone: boolean;
  isDuplicate: boolean;
  selected: boolean;
  status: BulkRecipientStatus;
  providerMessageId: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedReason: string | null;
  createdAt: string;
}

export interface UploadResult {
  campaignId: string;
  totalContacts: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
}

export interface FilterOption {
  districtName: string | null;
  constituencyName: string | null;
  boothName: string | null;
}

export interface BulkDashboard {
  campaign: BulkCampaign;
  kpis: {
    totalRecipients: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    pending: number;
    invalidNumbers: number;
    optedOut: number;
  };
  recipients: BulkRecipient[];
}

export function useBulkCampaigns() {
  return useQuery({
    queryKey: ["bulk-messages"],
    queryFn: () => api.get<BulkCampaign[]>("/bulk-messages"),
  });
}

export function useBulkCampaign(id: string) {
  return useQuery({
    queryKey: ["bulk-messages", id],
    queryFn: () => api.get<BulkCampaign>(`/bulk-messages/${id}`),
    enabled: Boolean(id),
  });
}

export function useUploadBulkExcel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, name }: { file: File; name?: string }) => {
      const token = getToken();
      const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const formData = new FormData();
      formData.append("file", file);
      if (name) formData.append("name", name);

      const response = await fetch(`${baseUrl}/api/bulk-messages/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(body.message ?? "Upload failed");
      }
      return response.json() as Promise<UploadResult>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bulk-messages"] }),
  });
}

export function useBulkRecipients(id: string) {
  return useQuery({
    queryKey: ["bulk-messages", id, "recipients"],
    queryFn: () => api.get<BulkRecipient[]>(`/bulk-messages/${id}/recipients`),
    enabled: Boolean(id),
  });
}

export function useBulkFilterOptions(id: string) {
  return useQuery({
    queryKey: ["bulk-messages", id, "filter-options"],
    queryFn: () => api.get<FilterOption[]>(`/bulk-messages/${id}/recipients/filter-options`),
    enabled: Boolean(id),
  });
}

export function useUpdateBulkSelection(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: BulkRecipientSelectionDto) =>
      api.patch<{ updated: number }>(`/bulk-messages/${id}/recipients/selection`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bulk-messages", id, "recipients"] }),
  });
}

export function useComposeBulkMessage(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: ComposeBulkMessageDto) => api.patch<BulkCampaign>(`/bulk-messages/${id}/message`, dto),
    onSuccess: (data) => queryClient.setQueryData(["bulk-messages", id], data),
  });
}

export function useSendBulkCampaign(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ sentCount: number; failedCount: number; fyxoConfigured: boolean }>(`/bulk-messages/${id}/send`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bulk-messages"] });
      queryClient.invalidateQueries({ queryKey: ["bulk-messages", id] });
    },
  });
}

export function useBulkDashboard(id: string) {
  return useQuery({
    queryKey: ["bulk-messages", id, "dashboard"],
    queryFn: () => api.get<BulkDashboard>(`/bulk-messages/${id}/dashboard`),
    enabled: Boolean(id),
  });
}
