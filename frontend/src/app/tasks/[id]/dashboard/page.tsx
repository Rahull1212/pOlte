"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTaskDashboard, useTaskInsights, useGenerateTaskInsights, TaskDashboardCadre } from "@/hooks/use-tasks";

const ackTone: Record<string, "slate" | "green" | "red" | "amber"> = {
  AWAITING: "amber",
  ACCEPTED: "green",
  DECLINED: "red",
};

const ackLabel: Record<string, string> = {
  AWAITING: "No Response",
  ACCEPTED: "Yes",
  DECLINED: "No",
};

const statusTone: Record<string, "slate" | "blue" | "green" | "red"> = {
  PENDING: "slate",
  IN_PROGRESS: "blue",
  COMPLETED: "green",
  OVERDUE: "red",
  CANCELLED: "slate",
};

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone ?? "text-slate-900"}`}>{value}</p>
    </div>
  );
}

export default function TaskDashboardPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: dashboard, isLoading } = useTaskDashboard(id);
  const { data: insights } = useTaskInsights(id);
  const generateInsights = useGenerateTaskInsights(id);

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Loading dashboard…</p>
      </AppShell>
    );
  }

  if (!dashboard) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Task not found.</p>
      </AppShell>
    );
  }

  const { kpis, cadres, dailyProgress } = dashboard;

  return (
    <AppShell>
      <div className="mb-6">
        <Link href={`/tasks/${id}`} className="text-xs text-brand-600 hover:underline">
          ← Back to Task Details
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-slate-900">{dashboard.name} — Task Dashboard</h1>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Total Assigned" value={kpis.totalAssigned} />
        <Kpi label="YES" value={kpis.accepted} tone="text-emerald-600" />
        <Kpi label="NO" value={kpis.declined} tone="text-red-600" />
        <Kpi label="No Response" value={kpis.noResponse} tone="text-amber-600" />
        <Kpi label="Needs Reassignment" value={kpis.needsReassignment} tone="text-red-600" />
        <Kpi label="Pending" value={kpis.pending} />
        <Kpi label="In Progress" value={kpis.inProgress} tone="text-blue-600" />
        <Kpi label="Completed" value={kpis.completed} tone="text-emerald-600" />
        <Kpi label="Overdue" value={kpis.overdue} tone="text-red-600" />
        <Kpi label="Average Progress" value={`${kpis.avgProgressPct}%`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Daily Progress</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-2">Date</th>
                    <th className="px-5 py-2">Updates Submitted</th>
                    <th className="px-5 py-2">Avg Completion</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyProgress.map((d) => (
                    <tr key={d.date} className="border-b border-slate-50">
                      <td className="px-5 py-2 text-slate-800">{d.date}</td>
                      <td className="px-5 py-2 text-slate-600">{d.updatesSubmitted}</td>
                      <td className="px-5 py-2 text-slate-600">{d.avgCompletionPct}%</td>
                    </tr>
                  ))}
                  {dailyProgress.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-5 py-6 text-center text-slate-400">
                        No progress updates submitted yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cadre-wise Performance & WhatsApp Responses</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-2">Cadre</th>
                    <th className="px-5 py-2">Area</th>
                    <th className="px-5 py-2">WhatsApp Response</th>
                    <th className="px-5 py-2">Status</th>
                    <th className="px-5 py-2">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {cadres.map((c: TaskDashboardCadre) => (
                    <tr key={c.taskId} className="border-b border-slate-50">
                      <td className="px-5 py-2 text-slate-800">
                        {c.name}
                        {c.needsReassignment && (
                          <Badge tone="red" className="ml-2">
                            Needs Reassignment
                          </Badge>
                        )}
                      </td>
                      <td className="px-5 py-2 text-slate-600">{c.area}</td>
                      <td className="px-5 py-2">
                        <Badge tone={ackTone[c.acknowledgment ?? "AWAITING"]}>
                          {ackLabel[c.acknowledgment ?? "AWAITING"]}
                        </Badge>
                      </td>
                      <td className="px-5 py-2">
                        <Badge tone={statusTone[c.status] ?? "slate"}>{c.status}</Badge>
                      </td>
                      <td className="px-5 py-2 text-slate-600">{c.progressPct}%</td>
                    </tr>
                  ))}
                  {cadres.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-slate-400">
                        No cadres assigned.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Issues / Remarks</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-700">
                {dashboard.remarks || <span className="text-slate-400">No issues or remarks recorded.</span>}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>AI Task Insights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {insights ? (
                <>
                  <div>
                    <p className="text-xs font-medium uppercase text-slate-400">Insight</p>
                    <p className="mt-1 text-sm text-slate-700">{insights.insight}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-slate-400">Follow-up Requirements</p>
                    <p className="mt-1 text-sm text-slate-700">{insights.followUp}</p>
                  </div>
                  {insights.generatedAt && (
                    <p className="text-xs text-slate-400">
                      Generated {new Date(insights.generatedAt).toLocaleString()}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-400">No AI insights generated yet.</p>
              )}
              <Button
                variant="secondary"
                onClick={() => generateInsights.mutate()}
                disabled={generateInsights.isPending}
              >
                {generateInsights.isPending ? "Generating…" : insights ? "Regenerate Insights" : "Generate Insights"}
              </Button>
              {generateInsights.isError && (
                <p className="text-xs text-red-600">Failed to generate insights. Please try again.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
