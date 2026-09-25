"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { KpiTile } from "@/components/kpi-tile";
import { ProgressBar } from "@/components/ui/progress";
import { useCurrentUser } from "@/hooks/use-auth";
import { useRegions } from "@/hooks/use-regions";
import { isRegionWithinScope } from "@/components/region-multi-select";
import { useRetryWhatsapp } from "@/hooks/use-tasks";
import {
  useTaskAnalyticsScope,
  useTaskAnalyticsOverview,
  useCadreOverview,
  useTaskWiseAnalytics,
  useCadreAnalytics,
  useConstituencyAnalytics,
  useDistrictAnalytics,
  useTaskAnalyticsCharts,
  useActionCenter,
  useGenerateTaskAiInsights,
  useAskTaskAi,
  TaskAnalyticsFilters,
  TaskAiInsights,
  AnomalyItem,
  CadreAnalyticsRow,
  ConstituencyAnalyticsRow,
  DistrictAnalyticsRow,
} from "@/hooks/use-task-analytics";
import { TaskStatus, TaskPriority } from "@/lib/shared-types";

const BAR_COLORS = ["#4f46e5", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9"];

function ChartCard({ title, span, children }: { title: string; span?: boolean; children: React.ReactNode }) {
  return (
    <Card className={span ? "lg:col-span-2" : undefined}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            {children as any}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function SimpleBar({ data, dataKey = "value", colorByIndex = false }: { data: { name: string }[]; dataKey?: string; colorByIndex?: boolean }) {
  return (
    <BarChart data={data}>
      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
      <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" interval={0} angle={-20} textAnchor="end" height={50} />
      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
      <Tooltip />
      <Bar dataKey={dataKey} radius={[6, 6, 0, 0]}>
        {colorByIndex && data.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
        {!colorByIndex && <Cell fill="#4f46e5" />}
      </Bar>
    </BarChart>
  );
}

function formatHours(hours: number | null) {
  if (hours === null) return "—";
  if (hours < 24) return `${hours}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

type CadreSortLimit = 5 | 10 | "all";
type ConstituencySortKey = "completionPct" | "total" | "completed" | "overdue";

const SORT_LABEL: Record<ConstituencySortKey, string> = {
  completionPct: "Completion %",
  total: "Total Tasks",
  completed: "Completed",
  overdue: "Overdue",
};

export default function TaskAnalyticsPage() {
  const { data: user } = useCurrentUser();
  const { data: regions } = useRegions();

  const [filters, setFilters] = useState<TaskAnalyticsFilters>({});
  const [cadreLimit, setCadreLimit] = useState<CadreSortLimit>(10);
  const [constituencySort, setConstituencySort] = useState<ConstituencySortKey>("completionPct");

  const { data: scope } = useTaskAnalyticsScope();
  const { data: overview } = useTaskAnalyticsOverview(filters);
  const { data: cadreOverview } = useCadreOverview(filters);
  const { data: taskWise } = useTaskWiseAnalytics(filters);
  const { data: cadreWise } = useCadreAnalytics(filters);
  const { data: constituencyWise } = useConstituencyAnalytics(filters);
  const { data: districtWise } = useDistrictAnalytics(filters);
  const { data: charts } = useTaskAnalyticsCharts(filters);
  const { data: actionCenter } = useActionCenter(filters);
  const generateInsights = useGenerateTaskAiInsights(filters);
  const askAi = useAskTaskAi();
  const retryWhatsapp = useRetryWhatsapp();

  const [insights, setInsights] = useState<TaskAiInsights | null>(null);
  const [question, setQuestion] = useState("");
  const [qaHistory, setQaHistory] = useState<{ question: string; answer: string }[]>([]);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const byId = useMemo(() => new Map((regions ?? []).map((r) => [r.id, r])), [regions]);
  const districts = useMemo(() => (regions ?? []).filter((r) => r.type === "DISTRICT"), [regions]);
  const constituenciesAll = useMemo(() => (regions ?? []).filter((r) => r.type === "CONSTITUENCY"), [regions]);
  const constituencies = useMemo(
    () => (filters.districtId ? constituenciesAll.filter((m) => isRegionWithinScope(m.id, new Set([filters.districtId!]), byId)) : constituenciesAll),
    [constituenciesAll, filters.districtId, byId],
  );

  if (user && user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Only Super Admins and Admins can view this dashboard.</p>
      </AppShell>
    );
  }

  const updateFilter = (patch: Partial<TaskAnalyticsFilters>) => setFilters((prev) => ({ ...prev, ...patch }));
  const clearFilters = () => setFilters({});
  const hasFilters = Object.values(filters).some(Boolean);

  const sortedConstituencies: ConstituencyAnalyticsRow[] = constituencyWise ? [...constituencyWise].sort((a, b) => b[constituencySort] - a[constituencySort]) : [];
  const visibleCadres: CadreAnalyticsRow[] = cadreWise ? (cadreLimit === "all" ? cadreWise : cadreWise.slice(0, cadreLimit)) : [];

  const handleGenerateInsights = () => {
    generateInsights.mutate(undefined, { onSuccess: (res) => setInsights(res) });
  };

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    askAi.mutate(
      { question: q, filters },
      {
        onSuccess: (res) => {
          setQaHistory((prev) => [...prev, { question: q, answer: res.answer }]);
          setQuestion("");
        },
      },
    );
  };

  const handleRetry = (taskId: string) => {
    setActingOn(taskId);
    retryWhatsapp.mutate(taskId, { onSettled: () => setActingOn(null) });
  };

  const suggestedQuestions = [
    "Which Cadre is performing best?",
    "Which Constituency has the lowest completion rate?",
    "How many tasks are overdue?",
    "Which Cadres need follow-up?",
    "Compare Constituency performance.",
    "What should I focus on today?",
  ];

  return (
    <AppShell>
      <div className="mb-6">
        <Link href="/tasks" className="text-xs text-brand-600 hover:underline">
          ← Back to Tasks
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-slate-900">📊 Communication & AI Insights</h1>
        <p className="mt-1 text-sm text-slate-500">
          Overall Task &amp; Cadre Performance —{" "}
          {scope?.isOrgWide ? "organization-wide" : scope?.areaName ? `${scope.areaName} (${scope.areaType})` : "your area"}
        </p>
      </div>

      {/* 10. Filters */}
      <Card className="mb-6">
        <CardContent className="grid grid-cols-2 gap-3 py-4 sm:grid-cols-3 lg:grid-cols-7">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={filters.dateFrom ?? ""} onChange={(e) => updateFilter({ dateFrom: e.target.value || undefined })} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={filters.dateTo ?? ""} onChange={(e) => updateFilter({ dateTo: e.target.value || undefined })} />
          </div>
          <div>
            <Label className="text-xs">District</Label>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={filters.districtId ?? ""}
              onChange={(e) => updateFilter({ districtId: e.target.value || undefined, constituencyId: undefined })}
            >
              <option value="">All Districts</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Constituency</Label>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={filters.constituencyId ?? ""}
              onChange={(e) => updateFilter({ constituencyId: e.target.value || undefined })}
            >
              <option value="">All Constituencies</option>
              {constituencies.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={filters.status ?? ""}
              onChange={(e) => updateFilter({ status: e.target.value || undefined })}
            >
              <option value="">All Statuses</option>
              {TaskStatus.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Priority</Label>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={filters.priority ?? ""}
              onChange={(e) => updateFilter({ priority: e.target.value || undefined })}
            >
              <option value="">All Priorities</option>
              {TaskPriority.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Task Type</Label>
            <div className="flex items-center gap-2">
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={filters.taskType ?? ""}
                onChange={(e) => updateFilter({ taskType: (e.target.value || undefined) as TaskAnalyticsFilters["taskType"] })}
              >
                <option value="">All Types</option>
                <option value="BULK">Bulk Task</option>
                <option value="INDIVIDUAL">Individual Task</option>
              </select>
              {hasFilters && (
                <button type="button" onClick={clearFilters} className="shrink-0 text-xs text-brand-600 hover:underline">
                  Clear
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 1. Total Task Overview */}
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Total Task Overview</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <KpiTile label="Total Tasks" value={overview?.totalTasks ?? "-"} />
        <KpiTile label="Pending" value={overview?.pending ?? "-"} />
        <KpiTile label="Completed" value={overview?.completed ?? "-"} tone="good" />
        <KpiTile label="Overdue" value={overview?.overdue ?? "-"} tone={overview && overview.overdue > 0 ? "warning" : "default"} />
        <KpiTile label="Completion %" value={overview ? `${overview.completionPct}%` : "-"} />
        <KpiTile label="Avg Completion Time" value={overview ? formatHours(overview.avgCompletionHours) : "-"} />
        <KpiTile label="Failed WhatsApp" value={overview?.failedWhatsapp ?? "-"} tone={overview && overview.failedWhatsapp > 0 ? "warning" : "default"} />
      </div>

      {/* 2. Cadre Overview */}
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Cadre Overview</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile label="Total Cadres" value={cadreOverview?.totalCadres ?? "-"} />
        <KpiTile label="Active Cadres" value={cadreOverview?.activeCadres ?? "-"} tone="good" />
        <KpiTile label="Cadres with Tasks" value={cadreOverview?.cadresWithTasks ?? "-"} />
        <KpiTile label="With Pending" value={cadreOverview?.cadresWithPendingTasks ?? "-"} />
        <KpiTile label="With Completed" value={cadreOverview?.cadresWithCompletedTasks ?? "-"} tone="good" />
        <KpiTile label="Avg Completion %" value={cadreOverview ? `${cadreOverview.avgCadreCompletionPct}%` : "-"} />
      </div>

      {/* 3. WhatsApp Communication Analytics */}
      <h2 className="mb-2 text-sm font-semibold text-slate-700">WhatsApp Communication Analytics</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <KpiTile label="Sent" value={overview?.messagesSent ?? "-"} />
        <KpiTile label="Delivered" value={overview?.delivered ?? "-"} tone="good" />
        <KpiTile label="Read" value={overview?.read ?? "-"} tone="good" />
        <KpiTile label="Responses" value={overview?.responded ?? "-"} />
        <KpiTile label="No Response" value={overview ? overview.messagesSent - overview.responded : "-"} tone="warning" />
        <KpiTile label="Failed" value={overview?.failedWhatsapp ?? "-"} tone={overview && overview.failedWhatsapp > 0 ? "warning" : "default"} />
        <KpiTile label="Delivery %" value={charts ? `${charts.deliveryPct}%` : "-"} />
        <KpiTile label="Response %" value={charts ? `${charts.responsePct}%` : "-"} />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Communication Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {charts?.communicationFunnel.map((stage, i) => (
              <div key={stage.stage} className="flex items-center gap-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center">
                  <p className="text-xs uppercase text-slate-400">{stage.stage}</p>
                  <p className="text-lg font-semibold text-slate-800">{stage.count}</p>
                </div>
                {charts && i < charts.communicationFunnel.length - 1 && <span className="text-slate-300">→</span>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 4. Task Performance charts */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard title="Task Completion">
          <SimpleBar data={charts?.taskCompletion ?? []} colorByIndex />
        </ChartCard>
        <ChartCard title="Tasks by Priority">
          <SimpleBar data={(charts?.tasksByPriority ?? []).map((p) => ({ name: p.name, value: p.value }))} colorByIndex />
        </ChartCard>
        <ChartCard title="Overdue Tasks by Constituency">
          <SimpleBar data={(charts?.overdueByConstituency ?? []).map((m) => ({ name: m.name, value: m.overdue }))} />
        </ChartCard>
        <ChartCard title="Tasks Created Over Time" span>
          <SimpleBar data={(charts?.tasksCreatedOverTime ?? []).map((d) => ({ name: d.date, value: d.count }))} />
        </ChartCard>
        <ChartCard title="Task Completion Trend" span>
          <SimpleBar data={(charts?.completionTrend ?? []).map((d) => ({ name: d.date, value: d.count }))} />
        </ChartCard>
      </div>

      {/* 5. Top Cadres */}
      <Card className="mb-6">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Top Performing Cadres</CardTitle>
          <div className="flex gap-1">
            {([5, 10, "all"] as CadreSortLimit[]).map((v) => (
              <button
                key={v}
                onClick={() => setCadreLimit(v)}
                className={`rounded-full px-3 py-1 text-xs ${cadreLimit === v ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {v === "all" ? "View All" : `Top ${v}`}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-2">Rank</th>
                <th className="px-5 py-2">Cadre Name</th>
                <th className="px-5 py-2">District</th>
                <th className="px-5 py-2">Constituency</th>
                <th className="px-5 py-2">Assigned</th>
                <th className="px-5 py-2">Completed</th>
                <th className="px-5 py-2">Pending</th>
                <th className="px-5 py-2">Overdue</th>
                <th className="px-5 py-2">Completion %</th>
                <th className="px-5 py-2">Avg Completion Time</th>
              </tr>
            </thead>
            <tbody>
              {visibleCadres.map((c, i) => (
                <tr key={c.cadreId} className="border-b border-slate-50">
                  <td className="px-5 py-2 text-slate-500">#{i + 1}</td>
                  <td className="px-5 py-2 font-medium text-slate-800">{c.name}</td>
                  <td className="px-5 py-2 text-slate-600">{c.district ?? "—"}</td>
                  <td className="px-5 py-2 text-slate-600">{c.constituency ?? "—"}</td>
                  <td className="px-5 py-2 text-slate-600">{c.tasksAssigned}</td>
                  <td className="px-5 py-2 text-slate-600">{c.tasksCompleted}</td>
                  <td className="px-5 py-2 text-slate-600">{c.pending}</td>
                  <td className="px-5 py-2 text-slate-600">{c.overdue}</td>
                  <td className="px-5 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-16">
                        <ProgressBar value={c.completionPct} />
                      </div>
                      <span className="text-xs text-slate-500">{c.completionPct}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-2 text-slate-500">{formatHours(c.avgCompletionHours)}</td>
                </tr>
              ))}
              {visibleCadres.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-5 py-8 text-center text-slate-400">
                    No Cadres have been allocated tasks yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* 6. Constituency Performance */}
      <Card className="mb-6">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Constituency Performance</CardTitle>
          <div className="flex items-center gap-1 text-xs text-slate-500">
            Sort by:
            {(Object.keys(SORT_LABEL) as ConstituencySortKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setConstituencySort(k)}
                className={`rounded-full px-2.5 py-1 ${constituencySort === k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {SORT_LABEL[k]}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-2">Constituency</th>
                <th className="px-5 py-2">Total Tasks</th>
                <th className="px-5 py-2">Assigned Cadres</th>
                <th className="px-5 py-2">Completed</th>
                <th className="px-5 py-2">Pending</th>
                <th className="px-5 py-2">Overdue</th>
                <th className="px-5 py-2">Completion %</th>
              </tr>
            </thead>
            <tbody>
              {sortedConstituencies.map((m: ConstituencyAnalyticsRow) => (
                <tr key={m.constituency} className="border-b border-slate-50">
                  <td className="px-5 py-2 font-medium text-slate-800">{m.constituency}</td>
                  <td className="px-5 py-2 text-slate-600">{m.total}</td>
                  <td className="px-5 py-2 text-slate-600">{m.cadres}</td>
                  <td className="px-5 py-2 text-slate-600">{m.completed}</td>
                  <td className="px-5 py-2 text-slate-600">{m.pending}</td>
                  <td className="px-5 py-2 text-slate-600">{m.overdue}</td>
                  <td className="px-5 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-16">
                        <ProgressBar value={m.completionPct} />
                      </div>
                      <span className="text-xs text-slate-500">{m.completionPct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {sortedConstituencies.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                    No data yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* 7. District Performance */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>District Performance</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-2">District</th>
                <th className="px-5 py-2">Total Tasks</th>
                <th className="px-5 py-2">Cadres</th>
                <th className="px-5 py-2">Completed</th>
                <th className="px-5 py-2">Pending</th>
                <th className="px-5 py-2">Overdue</th>
                <th className="px-5 py-2">Completion %</th>
              </tr>
            </thead>
            <tbody>
              {districtWise?.map((d: DistrictAnalyticsRow) => (
                <tr key={d.district} className="border-b border-slate-50">
                  <td className="px-5 py-2 font-medium text-slate-800">{d.district}</td>
                  <td className="px-5 py-2 text-slate-600">{d.total}</td>
                  <td className="px-5 py-2 text-slate-600">{d.cadres}</td>
                  <td className="px-5 py-2 text-slate-600">{d.completed}</td>
                  <td className="px-5 py-2 text-slate-600">{d.pending}</td>
                  <td className="px-5 py-2 text-slate-600">{d.overdue}</td>
                  <td className="px-5 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-16">
                        <ProgressBar value={d.completionPct} />
                      </div>
                      <span className="text-xs text-slate-500">{d.completionPct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {!districtWise?.length && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                    No data yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* 8. AI Insights */}
      <Card className="mb-6">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>🤖 AI Insights</CardTitle>
          <Button onClick={handleGenerateInsights} disabled={generateInsights.isPending}>
            {generateInsights.isPending ? "Analyzing…" : insights ? "Regenerate Insights" : "Generate Insights"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {insights ? (
            insights.items.map((item, i) => (
              <div key={i} className="flex items-start gap-3 rounded-md border border-slate-100 px-4 py-3">
                <span className="text-lg">{item.icon}</span>
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-400">{item.category}</p>
                  <p className="mt-0.5 text-sm text-slate-700">{item.text}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-400">
              Click "Generate Insights" to have AI analyze performance, WhatsApp delivery, and Constituency comparisons
              from your real data (respecting the filters above).
            </p>
          )}
          {generateInsights.isError && <p className="text-xs text-red-600">Failed to generate insights. Please try again.</p>}
        </CardContent>
      </Card>

      {/* AI Action Center */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>AI Action Center</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-800">⚠️ Cadres Needing Follow-Up</p>
            <div className="space-y-2">
              {actionCenter?.followUp.map((item) => (
                <div key={item.taskId} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{item.cadreName}</p>
                    <p className="truncate text-xs text-slate-500">{item.taskName}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Link href={`/tasks/${item.taskId}`}>
                      <Button variant="secondary">View</Button>
                    </Link>
                    <Button onClick={() => handleRetry(item.taskId)} disabled={actingOn === item.taskId && retryWhatsapp.isPending}>
                      {actingOn === item.taskId && retryWhatsapp.isPending ? "Sending…" : "Follow Up"}
                    </Button>
                  </div>
                </div>
              ))}
              {!actionCenter?.followUp.length && <p className="text-sm text-slate-400">No one needs follow-up right now.</p>}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-800">🔴 Tasks at Risk (due within 48h)</p>
            <div className="space-y-2">
              {actionCenter?.atRisk.map((item) => (
                <div key={item.taskId} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{item.cadreName}</p>
                    <p className="truncate text-xs text-slate-500">
                      {item.taskName}
                      {item.deadline && ` · due ${new Date(item.deadline).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Link href={`/tasks/${item.taskId}`}>
                      <Button variant="secondary">View</Button>
                    </Link>
                    <Button onClick={() => handleRetry(item.taskId)} disabled={actingOn === item.taskId && retryWhatsapp.isPending}>
                      {actingOn === item.taskId && retryWhatsapp.isPending ? "Sending…" : "Send Reminder"}
                    </Button>
                  </div>
                </div>
              ))}
              {!actionCenter?.atRisk.length && <p className="text-sm text-slate-400">Nothing at risk right now.</p>}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-800">📱 WhatsApp Failures</p>
            <div className="space-y-2">
              {actionCenter?.whatsappFailures.map((item) => (
                <div key={item.taskId} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{item.cadreName}</p>
                    <p className="truncate text-xs text-slate-500">{item.taskName}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Link href={`/tasks/${item.taskId}`}>
                      <Button variant="secondary">View</Button>
                    </Link>
                    <Button onClick={() => handleRetry(item.taskId)} disabled={actingOn === item.taskId && retryWhatsapp.isPending}>
                      {actingOn === item.taskId && retryWhatsapp.isPending ? "Retrying…" : "Retry WhatsApp"}
                    </Button>
                  </div>
                </div>
              ))}
              {!actionCenter?.whatsappFailures.length && <p className="text-sm text-slate-400">No WhatsApp failures.</p>}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-800">📊 Performance Anomalies</p>
            <div className="space-y-2">
              {actionCenter?.anomalies.map((item: AnomalyItem) => (
                <div key={item.cadreId} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{item.name}</p>
                    <p className="text-xs text-slate-500">
                      {item.completionPct}% completion vs {item.teamAvgCompletionPct}% team average
                    </p>
                  </div>
                  <Badge tone="amber">Below Average</Badge>
                </div>
              ))}
              {!actionCenter?.anomalies.length && <p className="text-sm text-slate-400">No unusual performance drops detected.</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 9. Global Ask AI */}
      <Card>
        <CardHeader>
          <CardTitle>💬 Ask AI</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAsk} className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about your tasks, Cadres, or Constituencies…"
              className="flex-1"
            />
            <Button type="submit" disabled={askAi.isPending || !question.trim()}>
              {askAi.isPending ? "Thinking…" : "Ask"}
            </Button>
          </form>

          <div className="mt-3 flex flex-wrap gap-2">
            {suggestedQuestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setQuestion(q)}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-slate-200"
              >
                {q}
              </button>
            ))}
          </div>

          {askAi.isError && <p className="mt-3 text-xs text-red-600">Something went wrong answering that. Please try again.</p>}

          {qaHistory.length > 0 && (
            <div className="mt-5 space-y-4 border-t border-slate-100 pt-4">
              {qaHistory
                .slice()
                .reverse()
                .map((qa, i) => (
                  <div key={i}>
                    <p className="text-sm font-medium text-slate-800">{qa.question}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{qa.answer}</p>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
