import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmPhoneChangeDto, RequestPhoneChangeDto, UpdateProfileDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";
import { getToken } from "@/lib/auth";
import { CurrentUser } from "./use-auth";

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateProfileDto) => api.patch<CurrentUser>("/auth/profile", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (dto: { currentPassword: string; newPassword: string }) =>
      api.post<{ message: string }>("/auth/change-password", dto),
  });
}

export function useRequestPhoneChange() {
  return useMutation({
    mutationFn: (dto: RequestPhoneChangeDto) => api.post<{ message: string }>("/auth/phone-change/request", dto),
  });
}

export function useConfirmPhoneChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: ConfirmPhoneChangeDto) => api.post<CurrentUser>("/auth/phone-change/confirm", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}

export function useUploadProfilePicture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const token = getToken();
      const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${baseUrl}/api/auth/profile-picture`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(body.message ?? "Upload failed");
      }
      return response.json() as Promise<CurrentUser>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}
