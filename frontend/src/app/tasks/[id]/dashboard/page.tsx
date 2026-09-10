"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useTaskDashboard,
  useTaskInsights,
  useGenerateTaskInsights,
  useRetryWhatsapp,
  useSendCompletionCheck,
  useAskAboutTask,
  TaskDashboardCadre,
  TaskTimelineEvent,
} from "@/hooks/use-tasks";

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

const whatsappTone: Record<string, "slate" | "green" | "red" | "blue"> = {
  PENDING: "slate",
  SENT: "blue",
  DELIVERED: "green",
  READ: "green",
  FAILED: "red",
};

const completionTone: Record<string, "slate" | "green" | "red" | "amber"> = {
  AWAITING: "amber",
  YES: "green",
  NO: "red",
};

const timelineLabel: Record<TaskTimelineEvent["type"], string> = {
  ALLOCATED: "Allocated to",
  WHATSAPP_SENT: "WhatsApp sent to",
  WHATSAPP_DELIVERED: "WhatsApp delivered to",
  WHATSAPP_READ: "WhatsApp read by",
  RESPONDED: "Responded",
  PROGRESS_UPDATE: "Progress update from",
  COMPLETED: "Completed by",
};

const timelineIcon: Record<TaskTimelineEvent["type"], string> = {
  ALLOCATED: "📌",
  WHATSAPP_SENT: "📤",
  WHATSAPP_DELIVERED: "📬",
  WHATSAPP_READ: "👁️",
  RESPONDED: "💬",
  PROGRESS_UPDATE: "📈",
  COMPLETED: "✅",
};

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone ?? "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const suggestedQuestions = [
  "Who has not responded?",
  "Who needs follow-up?",
  "How many Cadres completed this task?",
  "Is this task at risk?",
  "Give me a summary of this task.",
  "What should I do next?",
];

export default function TaskDashboardPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: dashboard, isLoading } = useTaskDashboard(id);
  const { data: insights } = useTaskInsights(id);
  const generateInsights = useGenerateTaskInsights(id);
  const retryWhatsapp = useRetryWhatsapp();
  const sendCompletionCheck = useSendCompletionCheck();
  const askAi = useAskAboutTask(id);

  const [question, setQuestion] = useState("");
  const [qaHistory, setQaHistory] = useState<{ question: string; answer: string }[]>([]);

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

  const { kpis, cadres, dailyProgress, progressFunnel, timeline } = dashboard;

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    askAi.mutate(q, {
      onSuccess: (res) => {
        setQaHistory((prev) => [...prev, { question: q, answer: res.answer }]);
        setQuestion("");
      },
    });
  };

  return (
    <AppShell>
      <div className="mb-6">
        <Link href={`/tasks/${id}`} className="text-xs text-brand-600 hover:underline">
          ← Back to Task Details
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-slate-900">{dashboard.name} — Task Dashboard</h1>
      </div>

      {/* 1. Task KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Total Cadres" value={kpis.totalAssigned} />
        <Kpi label="WhatsApp Sent" value={kpis.whatsappSent} tone="text-blue-600" />
        <Kpi label="Delivered" value={kpis.whatsappDelivered} tone="text-emerald-600" />
        <Kpi label="Read" value={kpis.whatsappRead} tone="text-emerald-600" />
        <Kpi label="Responses" value={kpis.responded} />
        <Kpi label="Completed" value={kpis.completed} tone="text-emerald-600" />
        <Kpi label="Pending" value={kpis.pending} />
        <Kpi label="In Progress" value={kpis.inProgress} tone="text-blue-600" />
        <Kpi label="Overdue" value={kpis.overdue} tone={kpis.overdue > 0 ? "text-red-600" : undefined} />
        <Kpi label="Completion %" value={`${kpis.avgProgressPct}%`} />
        {kpis.cancelled > 0 && <Kpi label="Removed" value={kpis.cancelled} tone="text-slate-400" />}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* 2. WhatsApp Communication Analytics */}
          <Card>
            <CardHeader>
              <CardTitle>WhatsApp Communication Analytics</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Kpi label="Sent" value={kpis.whatsappSent} tone="text-blue-600" />
              <Kpi label="Delivered" value={kpis.whatsappDelivered} tone="text-emerald-600" />
              <Kpi label="Read" value={kpis.whatsappRead} tone="text-emerald-600" />
              <Kpi label="Failed" value={kpis.whatsappFailed} tone={kpis.whatsappFailed > 0 ? "text-red-600" : undefined} />
              <Kpi label="Response Received" value={kpis.responded} tone="text-emerald-600" />
              <Kpi label="No Response" value={kpis.noResponse} tone={kpis.noResponse > 0 ? "text-amber-600" : undefined} />
            </CardContent>
          </Card>

          {/* "Have you completed your task?" check-in results */}
          {kpis.completionAsked > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Task Completion Check-in</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi label="Asked" value={kpis.completionAsked} />
                <Kpi label="Yes" value={kpis.completionYes} tone="text-emerald-600" />
                <Kpi label="No" value={kpis.completionNo} tone={kpis.completionNo > 0 ? "text-red-600" : undefined} />
                <Kpi label="Awaiting Reply" value={kpis.completionAwaiting} tone={kpis.completionAwaiting > 0 ? "text-amber-600" : undefined} />
              </CardContent>
            </Card>
          )}

          {/* 4. Task Progress funnel */}
          <Card>
            <CardHeader>
              <CardTitle>Task Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2">
                {progressFunnel.map((stage, i) => (
                  <div key={stage.stage} className="flex items-center gap-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center">
                      <p className="text-xs uppercase text-slate-400">{stage.stage}</p>
                      <p className="text-lg font-semibold text-slate-800">{stage.count}</p>
                    </div>
                    {i < progressFunnel.length - 1 && <span className="text-slate-300">→</span>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

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

          {/* 3. Cadre-wise Performance */}
          <Card>
            <CardHeader>
              <CardTitle>Cadre-wise Performance</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-2">Cadre</th>
                    <th className="px-5 py-2">Mandal</th>
                    <th className="px-5 py-2">WhatsApp Status</th>
                    <th className="px-5 py-2">Response Status</th>
                    <th className="px-5 py-2">Task Status</th>
                    <th className="px-5 py-2">Completed?</th>
                    <th className="px-5 py-2">Progress</th>
                    <th className="px-5 py-2">Last Activity</th>
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
                      <td className="px-5 py-2 text-slate-600">{c.mandal ?? "—"}</td>
                      <td className="px-5 py-2">
                        <div className="flex items-center gap-2">
                          <Badge tone={whatsappTone[c.whatsappStatus]}>{c.whatsappStatus}</Badge>
                          {c.whatsappStatus === "FAILED" && (
                            <button
                              onClick={() => retryWhatsapp.mutate(c.taskId)}
                              disabled={retryWhatsapp.isPending}
                              className="text-xs text-brand-600 hover:underline disabled:opacity-50"
                            >
                              {retryWhatsapp.isPending ? "Retrying…" : "Retry"}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-2">
                        <Badge tone={ackTone[c.acknowledgment ?? "AWAITING"]}>{ackLabel[c.acknowledgment ?? "AWAITING"]}</Badge>
                      </td>
                      <td className="px-5 py-2">
                        <Badge tone={statusTone[c.status] ?? "slate"}>{c.status}</Badge>
                      </td>
                      <td className="px-5 py-2">
                        {c.completionConfirmation ? (
                          <Badge tone={completionTone[c.completionConfirmation]}>
                            {c.completionConfirmation === "AWAITING" ? "Awaiting Reply" : c.completionConfirmation}
                          </Badge>
                        ) : c.status === "CANCELLED" ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          <button
                            onClick={() => sendCompletionCheck.mutate(c.taskId)}
                            disabled={sendCompletionCheck.isPending}
                            className="text-xs text-brand-600 hover:underline disabled:opacity-50"
                          >
                            {sendCompletionCheck.isPending ? "Sending…" : "Ask"}
                          </button>
                        )}
                      </td>
                      <td className="px-5 py-2 text-slate-600">{c.progressPct}%</td>
                      <td className="px-5 py-2 text-slate-500">{c.lastActivityAt ? timeAgo(c.lastActivityAt) : "—"}</td>
                    </tr>
                  ))}
                  {cadres.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-6 text-center text-slate-400">
                        No cadres assigned.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* 5. Activity Timeline */}
          <Card>
            <CardHeader>
              <CardTitle>Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="max-h-96 space-y-3 overflow-y-auto">
                {timeline.map((event, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span>{timelineIcon[event.type]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-slate-700">
                        {timelineLabel[event.type]} <span className="font-medium text-slate-900">{event.cadreName}</span>
                        {event.detail && <span className="text-slate-500"> — {event.detail}</span>}
                      </p>
                      <p className="text-xs text-slate-400">{new Date(event.at).toLocaleString()}</p>
                    </div>
                  </li>
                ))}
                {timeline.length === 0 && <p className="text-sm text-slate-400">No activity recorded yet.</p>}
              </ul>
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
          {/* 6. AI Insights */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>🤖 AI Insights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {insights ? (
                <>
                  <div>
                    <p className="text-xs font-medium uppercase text-slate-400">Performance</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{insights.insight}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-slate-400">Risks</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                      {insights.risks || <span className="text-slate-400">—</span>}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-slate-400">Recommended Actions</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{insights.followUp}</p>
                  </div>
                  {insights.generatedAt && (
                    <p className="text-xs text-slate-400">Generated {new Date(insights.generatedAt).toLocaleString()}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-400">No AI insights generated yet.</p>
              )}
              <Button variant="secondary" onClick={() => generateInsights.mutate()} disabled={generateInsights.isPending}>
                {generateInsights.isPending ? "Generating…" : insights ? "Regenerate Insights" : "Generate Insights"}
              </Button>
              {generateInsights.isError && <p className="text-xs text-red-600">Failed to generate insights. Please try again.</p>}
            </CardContent>
          </Card>

          {/* 7. Ask AI */}
          <Card>
            <CardHeader>
              <CardTitle>💬 Ask AI</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAsk} className="space-y-2">
                <Input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask about this task…"
                />
                <Button type="submit" className="w-full" disabled={askAi.isPending || !question.trim()}>
                  {askAi.isPending ? "Thinking…" : "Ask"}
                </Button>
              </form>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {suggestedQuestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuestion(q)}
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200"
                  >
                    {q}
                  </button>
                ))}
              </div>

              {askAi.isError && <p className="mt-3 text-xs text-red-600">Something went wrong. Please try again.</p>}

              {qaHistory.length > 0 && (
                <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                  {qaHistory
                    .slice()
                    .reverse()
                    .map((qa, i) => (
                      <div key={i}>
                        <p className="text-sm font-medium text-slate-800">{qa.question}</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">{qa.answer}</p>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
