"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePollDashboard, useRetryPollWhatsapp, PollTimelineEvent } from "@/hooks/use-polls";

const statusTone: Record<string, "slate" | "blue" | "green" | "red"> = {
  PENDING: "slate",
  SENT: "blue",
  FAILED: "red",
  ANSWERED: "green",
};

const timelineLabel: Record<PollTimelineEvent["type"], string> = {
  SENT: "Poll sent to",
  ANSWERED: "Responded",
};

const timelineIcon: Record<PollTimelineEvent["type"], string> = {
  SENT: "📤",
  ANSWERED: "💬",
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

export default function PollDashboardPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: dashboard, isLoading } = usePollDashboard(id);
  const retryWhatsapp = useRetryPollWhatsapp();

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
        <p className="text-sm text-slate-500">Poll not found.</p>
      </AppShell>
    );
  }

  const { kpis, tally, respondents, timeline } = dashboard;
  const totalVotes = tally.reduce((s, t) => s + t.votes, 0);

  return (
    <AppShell>
      <div className="mb-6">
        <Link href={`/polls/${id}`} className="text-xs text-brand-600 hover:underline">
          ← Back to Poll Details
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-slate-900">{dashboard.question} — Poll Dashboard</h1>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Total Recipients" value={kpis.totalRecipients} />
        <Kpi label="Sent" value={kpis.sent} tone="text-blue-600" />
        <Kpi label="Failed" value={kpis.failed} tone={kpis.failed > 0 ? "text-red-600" : undefined} />
        <Kpi label="Answered" value={kpis.answered} tone="text-emerald-600" />
        <Kpi label="No Response" value={kpis.noResponse} tone={kpis.noResponse > 0 ? "text-amber-600" : undefined} />
        <Kpi label="Response Rate" value={`${kpis.responseRatePct}%`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {tally.map((t) => {
                const pct = totalVotes > 0 ? Math.round((t.votes / totalVotes) * 100) : 0;
                return (
                  <div key={t.option}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-slate-800">{t.option}</span>
                      <span className="text-slate-500">
                        {t.votes} vote{t.votes === 1 ? "" : "s"} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <p className="pt-1 text-xs text-slate-400">{totalVotes} of {kpis.sent} responded</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cadre Responses</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-2">Cadre</th>
                    <th className="px-5 py-2">Area</th>
                    <th className="px-5 py-2">WhatsApp Status</th>
                    <th className="px-5 py-2">Answer</th>
                    <th className="px-5 py-2">Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {respondents.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50">
                      <td className="px-5 py-2 text-slate-800">{r.cadreName}</td>
                      <td className="px-5 py-2 text-slate-600">{r.area}</td>
                      <td className="px-5 py-2">
                        <div className="flex items-center gap-2">
                          <Badge tone={statusTone[r.status]}>{r.status}</Badge>
                          {r.status === "FAILED" && (
                            <button
                              onClick={() => retryWhatsapp.mutate(r.id)}
                              disabled={retryWhatsapp.isPending}
                              className="text-xs text-brand-600 hover:underline disabled:opacity-50"
                            >
                              {retryWhatsapp.isPending ? "Retrying…" : "Retry"}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-2 text-slate-600">
                        {r.selectedOption !== null ? dashboard.options[r.selectedOption] ?? "—" : "—"}
                      </td>
                      <td className="px-5 py-2 text-slate-500">
                        {(r.answeredAt ?? r.sentAt) ? timeAgo((r.answeredAt ?? r.sentAt) as string) : "—"}
                      </td>
                    </tr>
                  ))}
                  {respondents.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-slate-400">
                        No recipients.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

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
        </div>
      </div>
    </AppShell>
  );
}
