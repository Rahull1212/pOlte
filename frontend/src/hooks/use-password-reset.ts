import { useMutation } from "@tanstack/react-query";
import { ForgotPasswordDto, ResetPasswordDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export function useForgotPassword() {
  return useMutation({
    mutationFn: (dto: ForgotPasswordDto) => api.post<{ message: string }>("/auth/forgot-password", dto),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (dto: ResetPasswordDto) => api.post<{ message: string }>("/auth/reset-password", dto),
  });
}
