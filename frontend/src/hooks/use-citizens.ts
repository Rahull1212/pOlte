import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RegisterCitizenDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface Citizen {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  regionId: string;
  createdAt: string;
}

export function useCitizens() {
  return useQuery({
    queryKey: ["citizens"],
    queryFn: () => api.get<Citizen[]>("/citizens"),
  });
}

export function useRegisterCitizen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: RegisterCitizenDto) => api.post<Citizen>("/citizens", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["citizens"] }),
  });
}
