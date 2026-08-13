import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gender, LoginDto, Role } from "@/lib/shared-types";
import { api } from "@/lib/api-client";
import { getToken, setRefreshToken, setToken } from "@/lib/auth";

export interface CurrentUser {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  gender?: Gender | null;
  profilePicture?: string | null;
  role: Role;
  regionId: string;
  region?: { name: string; type: string } | null;
  createdAt: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  // Login only returns this minimal shape — the full profile (email,
  // gender, profilePicture, region, ...) is fetched separately via
  // useCurrentUser() right after, since /auth/login doesn't select it.
  user: { id: string; name: string; role: Role; regionId: string };
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: LoginDto) => api.post<LoginResponse>("/auth/login", dto),
    onSuccess: (data) => {
      setToken(data.accessToken);
      setRefreshToken(data.refreshToken);
      // Every cached list (citizens, grievances, users, tasks, "auth.me"...)
      // was scoped to whichever account was previously logged in. Without
      // this, switching accounts in the same tab reuses the old user's
      // cached data until each query happens to refetch on its own.
      queryClient.clear();
    },
  });
}

export function useCurrentUser() {
  const token = getToken();
  return useQuery({
    // Keying on the token itself means a new login always gets a fresh
    // cache entry — belt-and-suspenders alongside queryClient.clear() above.
    queryKey: ["auth", "me", token],
    queryFn: () => api.get<CurrentUser>("/auth/me"),
    enabled: Boolean(token),
    staleTime: Infinity,
  });
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  CADRE: "Cadre",
};
