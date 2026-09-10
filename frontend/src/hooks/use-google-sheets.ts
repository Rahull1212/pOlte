import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConnectSheetDto, SaveGoogleCredentialsDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface SheetConnection {
  spreadsheetId: string;
  spreadsheetUrl: string;
  spreadsheetTitle: string;
  tabName: string;
  connectedByName: string | null;
  connectedAt: string;
  lastAppendAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface SheetStatus {
  // Whether Google access exists at all — a signed-in account or a service
  // account.
  credentialsConfigured: boolean;
  // "google" = someone signed in with their own account (the one-click
  // path); "app"/"env" = a service account, which needs the sheet shared
  // with it by hand.
  credentialsSource: "google" | "app" | "env" | null;
  // The signed-in account, or the service account's address.
  serviceAccountEmail: string | null;
  // Whether the one-time OAuth app registration exists, i.e. whether the
  // "Connect Google Sheets" button can work at all.
  oauthReady: boolean;
  // The exact URI to whitelist in Google Cloud during that setup.
  oauthRedirectUri: string;
  connection: SheetConnection | null;
}

export interface SpreadsheetChoice {
  id: string;
  name: string;
  modifiedTime: string | null;
}

const KEY = ["google-sheets", "status"];

export function useSheetStatus() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<SheetStatus>("/google-sheets/status"),
  });
}

// Every mutation returns the fresh status, so it's written straight into the
// cache rather than triggering a refetch round-trip.
export function useConnectSheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: ConnectSheetDto) => api.post<SheetStatus>("/google-sheets/connect", dto),
    onSuccess: (status) => queryClient.setQueryData(KEY, status),
  });
}

export function useDisconnectSheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<SheetStatus>("/google-sheets/connection"),
    onSuccess: (status) => queryClient.setQueryData(KEY, status),
  });
}

/**
 * Starts Google sign-in. The URL is fetched first (the request needs the
 * bearer token) and then navigated to, rather than pointing the browser
 * straight at an API route it couldn't authenticate.
 */
export function useStartGoogleSignIn() {
  return useMutation({
    mutationFn: async () => {
      const { url } = await api.get<{ url: string }>("/google-sheets/oauth/url");
      window.location.href = url;
    },
  });
}

// Only fetched once an account is connected — it's the picker's contents.
export function useSpreadsheetChoices(enabled: boolean) {
  return useQuery({
    queryKey: ["google-sheets", "spreadsheets"],
    queryFn: () => api.get<SpreadsheetChoice[]>("/google-sheets/spreadsheets"),
    enabled,
  });
}

export function useSelectSpreadsheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { spreadsheetId: string; tabName?: string }) =>
      api.post<SheetStatus>("/google-sheets/select", input),
    onSuccess: (status) => queryClient.setQueryData(KEY, status),
  });
}

export function useDisconnectGoogleAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<SheetStatus>("/google-sheets/oauth/account"),
    onSuccess: (status) => queryClient.setQueryData(KEY, status),
  });
}

export function useSaveGoogleOAuthApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: { clientId: string; clientSecret: string }) =>
      api.post<SheetStatus>("/google-sheets/oauth/app", dto),
    onSuccess: (status) => queryClient.setQueryData(KEY, status),
  });
}

export function useSaveGoogleCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: SaveGoogleCredentialsDto) => api.post<SheetStatus>("/google-sheets/credentials", dto),
    onSuccess: (status) => queryClient.setQueryData(KEY, status),
  });
}

export function useClearGoogleCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<SheetStatus>("/google-sheets/credentials"),
    onSuccess: (status) => queryClient.setQueryData(KEY, status),
  });
}

export function useSendSheetTestRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ success: boolean; error?: string }>("/google-sheets/test-row"),
    // A test row updates lastAppendAt/lastError server-side, so pull the
    // refreshed health back in.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
