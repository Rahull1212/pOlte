import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateExpenseDto } from "@/lib/shared-types";
import { api } from "@/lib/api-client";

export interface Expense {
  id: string;
  expenseType: string;
  amount: string;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  description?: string;
  billUrl?: string;
  submittedBy: { id: string; name: string };
}

export function useExpenses(campaignId: string) {
  return useQuery({
    queryKey: ["expenses", campaignId],
    queryFn: () => api.get<Expense[]>(`/expenses?campaignId=${campaignId}`),
    enabled: Boolean(campaignId),
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateExpenseDto) => api.post<Expense>("/expenses", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });
}

export function useDecideExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: "approve" | "reject"; reason?: string }) =>
      api.patch(`/expenses/${id}/${action}`, action === "reject" ? { rejectionReason: reason } : undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });
}
