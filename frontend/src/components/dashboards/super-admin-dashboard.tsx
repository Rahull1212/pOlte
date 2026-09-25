"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiTile } from "@/components/kpi-tile";
import { CommunicationCard } from "@/components/communication-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CampaignProgressList } from "@/components/campaign-progress-list";
import { useManagedUsers } from "@/hooks/use-users";
import { useDashboardSummary } from "@/hooks/use-campaigns";
import { useEvents } from "@/hooks/use-events";
import { useRecentActivity } from "@/hooks/use-audit";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAnalyticsOverview } from "@/hooks/use-analytics";
import { ActivityFeed } from "@/components/activity-feed";
import { UpcomingEvents } from "@/components/upcoming-events";

export function SuperAdminDashboard() {
  const { data: currentUser } = useCurrentUser();
  const { data: admins } = useManagedUsers("ADMIN");
  const { data: cadres } = useManagedUsers("CADRE");
  const { data: campaignSummary } = useDashboardSummary();
  const { data: events } = useEvents();
  const { data: activity, isLoading: activityLoading } = useRecentActivity();
  const { data: overview } = useAnalyticsOverview();

  // Straight from the API. Adding the three status buckets together left
  // drafts out entirely, so an org whose campaigns were all drafts saw zero.
  const totalCampaigns = campaignSummary?.total ?? 0;
  const chartData = [
    { name: "Draft", count: campaignSummary?.draft ?? 0 },
    { name: "Active", count: campaignSummary?.active ?? 0 },
    { name: "Upcoming", count: campaignSummary?.upcoming ?? 0 },
    { name: "Completed", count: campaignSummary?.completed ?? 0 },
  ];

  const leaderboard = overview?.regionLeaderboard;

  return (
    <div>
      <Card className="mb-6 bg-gradient-to-r from-brand-600 to-brand-700 text-white">
        <CardContent className="flex items-center justify-between py-6">
          <div>
            <p className="text-lg font-semibold">Welcome back, {currentUser?.name ?? "Super Admin"} 👋</p>
            <p className="mt-1 text-sm text-brand-100">
              {new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              {" — "}complete organization control
            </p>
          </div>
          <Link href="/campaigns/new">
            <Button variant="inverse">+ New Campaign</Button>
          </Link>
        </CardContent>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiTile label="Admins" value={admins?.length ?? "-"} href="/users" />
        <KpiTile label="Cadres" value={cadres?.length ?? "-"} href="/users?role=CADRE" />
        <KpiTile label="Active Campaigns" value={campaignSummary?.active ?? "-"} href="/campaigns?status=ACTIVE" />
        <KpiTile label="Total Campaigns" value={totalCampaigns} href="/campaigns" />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        <KpiTile
          label="Target Achievement"
          value={overview ? `${overview.targetAchievementPct}%` : "-"}
          sub={overview ? `${overview.totalAchieved.toLocaleString()} / ${overview.totalTarget.toLocaleString()}` : undefined}
        />
        <KpiTile
          label="Task Completion"
          value={overview ? `${overview.taskCompletionPct}%` : "-"}
          sub={overview ? `${overview.overdueTasks} overdue` : undefined}
          tone={overview && overview.overdueTasks > 0 ? "warning" : "good"}
        />
        <KpiTile
          label="Open Grievances"
          value={overview?.openGrievances ?? "-"}
          sub={overview ? `${overview.grievanceResolutionPct}% resolved` : undefined}
          href="/grievances"
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Active Campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            <CampaignProgressList campaigns={overview?.campaigns} totalInScope={campaignSummary?.total} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming Events</CardTitle>
          </CardHeader>
          <CardContent>
            <UpcomingEvents events={events} />
          </CardContent>
        </Card>
      </div>

      {/* Straight from the Message Log — org-wide for a Super Admin. */}
      {overview?.communication && (
        <div className="mb-6">
          <CommunicationCard stats={overview.communication} href="/message-log" />
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Campaigns by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="count" fill="#4f46e5" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>District Performance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Top performers</p>
              <ul className="space-y-1.5">
                {leaderboard?.top.map((r, i) => (
                  <li key={r.regionId} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">
                      {i + 1}. {r.regionName}
                    </span>
                    <Badge tone="green">{r.achievementPct}%</Badge>
                  </li>
                ))}
                {!leaderboard?.top.length && <p className="text-xs text-slate-400">No data yet.</p>}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Needs attention</p>
              <ul className="space-y-1.5">
                {leaderboard?.bottom.map((r) => (
                  <li key={r.regionId} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{r.regionName}</span>
                    <Badge tone="amber">{r.achievementPct}%</Badge>
                  </li>
                ))}
                {!leaderboard?.bottom.length && <p className="text-xs text-slate-400">Not enough districts yet.</p>}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Activity Feed</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityFeed entries={activity} isLoading={activityLoading} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link href="/users"><Button variant="secondary">Manage Admins</Button></Link>
            <Link href="/users?role=CADRE"><Button variant="secondary">Manage Cadres</Button></Link>
            <Link href="/campaigns/new"><Button variant="secondary">Create Campaign</Button></Link>
            <Link href="/events"><Button variant="secondary">Events</Button></Link>
            <Link href="/campaigns"><Button variant="secondary">All Campaigns</Button></Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
