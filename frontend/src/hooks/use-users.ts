import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateUserDto, Role } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface ManagedUser {
  id: string;
  name: string;
  phone: string;
  role: Role;
  regionId: string;
  region?: { name: string; type: string } | null;
  isActive: boolean;
  createdAt: string;
}

export function useManagedUsers(role?: Role) {
  return useQuery({
    queryKey: ["users", role],
    queryFn: () => api.get<ManagedUser[]>(`/users${role ? `?role=${role}` : ""}`),
  });
}

export function useCreateManagedUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateUserDto) => api.post<ManagedUser>("/users", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useDeactivateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch(`/users/${id}`, { isActive: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}
