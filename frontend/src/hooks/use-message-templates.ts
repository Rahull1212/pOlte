import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AssignMessageTemplateDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";
import { TemplateButtonReplyDto } from "@/lib/shared-types";

export interface TemplateOwner {
  userId: string;
  name: string;
  role: string;
  area: string;
  templateName: string | null;
  templateLanguage: string | null;
  templateBody: string | null;
  // What each {{n}} is filled with, in order. Empty = default order.
  templateVariables: string[];
  /** What each Quick Reply sends when tapped; empty = built-in behaviour. */
  templateButtons: TemplateButtonReplyDto[];
  isSelf: boolean;
}

export interface AvailableTemplate {
  name: string;
  language: string;
  body: string | null;
  status: string | null;
  // Number of {{n}} placeholders. PoliOS fills exactly one (the Cadre's
  // name), so anything else can't be used as-is.
  variables: number | null;
  // Fixed quick-reply button labels baked in at approval time.
  buttons: string[];
  category: string | null;
  source: string;
  syncedAt: string;
}

export interface SyncResult {
  ok: boolean;
  source: string | null;
  imported: number;
  message: string;
}

const KEY = ["message-templates"];
const AVAILABLE_KEY = ["message-templates", "available"];

// The synced catalogue an Admin's template is picked from. Empty until the
// first successful sync, in which case the UI falls back to typing a name.
export function useAvailableTemplates() {
  return useQuery({
    queryKey: AVAILABLE_KEY,
    queryFn: () => api.get<AvailableTemplate[]>("/message-templates/available"),
  });
}

export function useSyncTemplates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<SyncResult>("/message-templates/sync"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AVAILABLE_KEY }),
  });
}

export function useMessageTemplates() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<TemplateOwner[]>("/message-templates"),
  });
}

// Both mutations return the whole refreshed list, so it goes straight into
// the cache instead of costing a second round-trip.
export function useAssignMessageTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...dto }: AssignMessageTemplateDto & { userId: string }) =>
      api.patch<TemplateOwner[]>(`/message-templates/${userId}`, dto),
    // Invalidated rather than written straight into the cache: an Admin's
    // response carries only their own row, and writing that over the full
    // owner list would blank everyone else's template on screen.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: ["message-templates", "mine"] });
    },
  });
}

export function useClearMessageTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete<TemplateOwner[]>(`/message-templates/${userId}`),
    onSuccess: (owners) => queryClient.setQueryData(KEY, owners),
  });
}

/**
 * The caller's own template. Used by the task-create form, where an Admin
 * picks or changes the template a task goes out with — they have no
 * WhatsApp Templates page of their own.
 */
export function useMyTemplate(enabled = true) {
  return useQuery({
    queryKey: ["message-templates", "mine"],
    queryFn: () => api.get<TemplateOwner[]>("/message-templates/mine"),
    enabled,
  });
}
