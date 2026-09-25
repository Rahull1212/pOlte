import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateUserDto, Role } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface ManagedUser {
  id: string;
  name: string;
  email?: string | null;
  phone: string;
  role: Role;
  gender?: string | null;
  profilePicture?: string | null;
  regionId: string;
  region?: { id?: string; name: string; type: string } | null;
  parentUserId?: string | null;
  /** Who created this account — their hierarchy parent. */
  parent?: { id: string; name: string; role: Role } | null;
  isActive: boolean;
  createdAt: string;
  /** Null means the account has never been signed into. */
  lastLoginAt?: string | null;
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

// Only allowed once an account is already deactivated — see UsersService.remove.
export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

/** One user's full record — powers the Admin Profile view. */
export function useManagedUser(id: string | null) {
  return useQuery({
    queryKey: ["users", "detail", id],
    queryFn: () => api.get<ManagedUser>(`/users/${id}`),
    enabled: Boolean(id),
  });
}

/** Rename, move area, or reactivate. Used by the Edit Admin dialog. */
export function useUpdateManagedUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: { id: string; name?: string; regionId?: string; isActive?: boolean }) =>
      api.patch<ManagedUser>(`/users/${id}`, dto),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["users", "detail", variables.id] });
    },
  });
}
