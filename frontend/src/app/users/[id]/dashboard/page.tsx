"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { useCurrentUser, ROLE_LABELS } from "@/hooks/use-auth";
import { Role } from "@/lib/shared-types";

interface UserDashboard {
  user: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    role: Role;
    isActive: boolean;
    createdAt: string;
    lastLoginAt: string | null;
    region: { id?: string; name: string; type: string } | null;
    createdBy: { id: string; name: string } | null;
  };
  team: { directReports: number; activeDirectReports: number; cadresInArea: number };
  tasks: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    overdue: number;
    cancelled: number;
    completionPct: number;
  };
  campaigns: {
    id: string;
    name: string;
    campaignStatus: string;
    assignmentStatus: string;
    assignedAt: string;
    respondedAt: string | null;
  }[];
  messages: { total: number; sent: number; delivered: number; read: number; failed: number };
  recentTasks: {
    id: string;
    name: string;
    status: string;
    priority: string;
    deadline: string;
    createdAt: string;
    assignedTo: { id: string; name: string };
    campaign: { id: string; name: string } | null;
  }[];
}

const statusTone: Record<string, "slate" | "green" | "amber" | "red" | "blue"> = {
  COMPLETED: "green",
  ACCEPTED: "green",
  ACTIVE: "green",
  IN_PROGRESS: "blue",
  PENDING: "amber",
  AWAITING: "amber",
  OVERDUE: "red",
  DECLINED: "red",
  CANCELLED: "slate",
};

const tone = (s: string) => statusTone[s] ?? "slate";
const humanise = (s: string) => {
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/**
 * A Super Admin's view of one Admin's work: who reports to them, what
 * they've handed out, which campaigns they hold, and whether their messages
 * are landing. Reached from the three-dot menu on the Admins table.
 */
export default function UserDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useCurrentUser();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["users", "dashboard", id],
    queryFn: () => api.get<UserDashboard>(`/users/${id}/dashboard`),
    enabled: Boolean(id),
  });

  // The API refuses this for anyone else; saying so beats a bare error.
  if (me && me.role !== "SUPER_ADMIN") {
    return (
      <AppShell>
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            Only a Super Admin can view another user&apos;s dashboard.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell>
        <Breadcrumb name={null} />
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-slate-800">Could not load this dashboard</p>
            <p className="mt-1 text-sm text-slate-500">{(error as Error)?.message}</p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isLoading || !data) {
    return (
      <AppShell>
        <Breadcrumb name={null} />
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">Loading dashboard…</CardContent>
        </Card>
      </AppShell>
    );
  }

  const { user, team, tasks, campaigns, messages, recentTasks } = data;

  return (
    <AppShell>
      <Breadcrumb name={user.name} />

      <Card className="mb-4">
        <CardContent className="py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold text-slate-900">{user.name}</h1>
                <Badge tone={user.isActive ? "green" : "slate"}>{user.isActive ? "Active" : "Inactive"}</Badge>
                <Badge tone="blue">{ROLE_LABELS[user.role]}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {user.phone}
                {user.email ? ` · ${user.email}` : ""}
              </p>
            </div>
            <Link href={`/message-log?q=${encodeURIComponent(user.phone)}`}>
              <Button variant="secondary">Their messages</Button>
            </Link>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4">
            <Fact label="Area" value={user.region ? `${user.region.name} (${user.region.type})` : null} />
            <Fact label="Joined" value={formatDate(user.createdAt)} />
            <Fact label="Created by" value={user.createdBy?.name} />
            <Fact
              label="Last login"
              value={user.lastLoginAt ? formatDate(user.lastLoginAt) : "Never signed in"}
            />
          </div>
        </CardContent>
      </Card>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Cadres in their area" value={team.cadresInArea} />
        <Kpi label="Direct reports" value={team.directReports} sub={`${team.activeDirectReports} active`} />
        <Kpi label="Tasks assigned" value={tasks.total} />
        <Kpi label="Completion" value={`${tasks.completionPct}%`} tone="text-emerald-700" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tasks they assigned</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Kpi label="Pending" value={tasks.pending} />
            <Kpi label="In progress" value={tasks.inProgress} tone="text-blue-700" />
            <Kpi label="Completed" value={tasks.completed} tone="text-emerald-700" />
            <Kpi label="Overdue" value={tasks.overdue} tone="text-red-600" />
            <Kpi label="Cancelled" value={tasks.cancelled} tone="text-slate-500" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>WhatsApp messages they sent</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Kpi label="Total" value={messages.total} />
            <Kpi label="Sent" value={messages.sent} tone="text-blue-700" />
            <Kpi label="Delivered" value={messages.delivered} tone="text-emerald-700" />
            <Kpi label="Read" value={messages.read} tone="text-emerald-700" />
            <Kpi label="Failed" value={messages.failed} tone="text-red-600" />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>
            Campaigns <span className="font-normal text-slate-400">({campaigns.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {campaigns.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              They haven&apos;t been assigned any campaigns.
            </p>
          )}
          {campaigns.map((c) => (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="block">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 p-3 hover:bg-slate-50">
                <div>
                  <p className="text-sm font-medium text-slate-800">{c.name}</p>
                  <p className="text-xs text-slate-400">Assigned {formatDate(c.assignedAt)}</p>
                </div>
                <div className="flex gap-2">
                  <Badge tone={tone(c.campaignStatus)}>{c.campaignStatus}</Badge>
                  <Badge tone={tone(c.assignmentStatus)}>{humanise(c.assignmentStatus)}</Badge>
                </div>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Recent tasks</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-2">Task</th>
                  <th className="px-5 py-2">Cadre</th>
                  <th className="px-5 py-2">Campaign</th>
                  <th className="px-5 py-2">Status</th>
                  <th className="px-5 py-2">Due</th>
                </tr>
              </thead>
              <tbody>
                {recentTasks.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50">
                    <td className="px-5 py-2 font-medium text-slate-800">{t.name}</td>
                    <td className="px-5 py-2 text-slate-600">{t.assignedTo.name}</td>
                    <td className="px-5 py-2 text-slate-600">{t.campaign?.name ?? "—"}</td>
                    <td className="px-5 py-2">
                      <Badge tone={tone(t.status)}>{humanise(t.status)}</Badge>
                    </td>
                    <td className="px-5 py-2 text-slate-500">{formatDate(t.deadline)}</td>
                  </tr>
                ))}
                {recentTasks.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">
                      They haven&apos;t assigned any tasks yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function Breadcrumb({ name }: { name: string | null }) {
  return (
    <div className="mb-4">
      <nav className="flex items-center gap-1 text-xs text-slate-400">
        <Link href="/users" className="hover:text-slate-700 hover:underline">
          Admins
        </Link>
        <span>›</span>
        <span className="text-slate-600">{name ?? "…"}</span>
      </nav>
      <Link href="/users" className="mt-1 inline-block text-xs text-brand-600 hover:underline">
        ← Back to Admins
      </Link>
    </div>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{value || "—"}</p>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone = "text-slate-900",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
