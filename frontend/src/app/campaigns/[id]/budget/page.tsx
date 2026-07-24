"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { KpiTile } from "@/components/kpi-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useExpenses, useDecideExpense } from "@/hooks/use-expenses";
import { useCampaignProgress } from "@/hooks/use-analytics";

const statusTone = { PENDING: "amber", APPROVED: "green", REJECTED: "red" } as const;

export default function CampaignBudgetPage() {
  const { id } = useParams<{ id: string }>();
  const { data: progress } = useCampaignProgress(id);
  const { data: expenses } = useExpenses(id);
  const decide = useDecideExpense();

  return (
    <AppShell>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">Budget</h1>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiTile label="Budget Utilization" value={`${progress?.budgetUtilizationPct ?? 0}%`} />
        <KpiTile label="Pending Approval" value={`₹${(progress?.pendingApprovalBudget ?? 0).toLocaleString()}`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Expense requests</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-2">Type</th>
                <th className="px-5 py-2">Submitted by</th>
                <th className="px-5 py-2">Amount</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses?.map((expense) => (
                <tr key={expense.id} className="border-b border-slate-50">
                  <td className="px-5 py-2">{expense.expenseType.replace("_", " ")}</td>
                  <td className="px-5 py-2">{expense.submittedBy?.name}</td>
                  <td className="px-5 py-2">₹{Number(expense.amount).toLocaleString()}</td>
                  <td className="px-5 py-2">
                    <Badge tone={statusTone[expense.approvalStatus]}>{expense.approvalStatus}</Badge>
                  </td>
                  <td className="px-5 py-2 text-right">
                    {expense.approvalStatus === "PENDING" && (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => decide.mutate({ id: expense.id, action: "approve" })}
                        >
                          Approve
                        </Button>
                        <Button variant="danger" onClick={() => decide.mutate({ id: expense.id, action: "reject" })}>
                          Reject
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {expenses?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                    No expense requests yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
