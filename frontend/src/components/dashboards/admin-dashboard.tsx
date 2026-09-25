"use client";

import Link from "next/link";
import { KpiTile } from "@/components/kpi-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CampaignProgressList } from "@/components/campaign-progress-list";
import { useManagedUsers } from "@/hooks/use-users";
import { useEvents } from "@/hooks/use-events";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAnalyticsOverview } from "@/hooks/use-analytics";
import { useDashboardSummary } from "@/hooks/use-campaigns";
import { UpcomingEvents } from "@/components/upcoming-events";
import { CommunicationCard } from "@/components/communication-card";

export function AdminDashboard() {
  const { data: currentUser } = useCurrentUser();
  const { data: cadres } = useManagedUsers("CADRE");
  const { data: events } = useEvents();
  const { data: overview } = useAnalyticsOverview();
  // Scoped to this Admin server-side, so the count explains their own empty
  // list rather than the organisation's.
  const { data: campaignSummary } = useDashboardSummary();

  const rank = overview?.myRegionRank;
  const cadreLeaderboard = overview?.cadreLeaderboard;

  return (
    <div>
      <Card className="mb-6 bg-gradient-to-r from-brand-600 to-brand-700 text-white">
        <CardContent className="py-6">
          <p className="text-lg font-semibold">Welcome back, {currentUser?.name ?? "Admin"} 👋</p>
          <p className="mt-1 text-sm text-brand-100">Manage your assigned area and cadre team</p>
        </CardContent>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiTile label="My Cadres" value={cadres?.length ?? "-"} href="/users" />
        <KpiTile label="Upcoming Events" value={events?.length ?? "-"} href="/events" />
        <KpiTile
          label="My Region Rank"
          value={rank ? `#${rank.rank} of ${rank.of}` : "-"}
          sub={rank?.regionName}
        />
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
            <CardTitle>My Active Campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            <CampaignProgressList campaigns={overview?.campaigns} totalInScope={campaignSummary?.total} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cadre Leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {cadreLeaderboard?.map((c, i) => (
                <li key={c.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">
                    {i + 1}. {c.name}
                  </span>
                  <Badge tone={c.total > 0 && c.completed === c.total ? "green" : "slate"}>
                    {c.completed}/{c.total}
                  </Badge>
                </li>
              ))}
              {!cadreLeaderboard?.length && <p className="text-xs text-slate-400">No task activity yet.</p>}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Team & Tasks</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link href="/users"><Button variant="secondary">Manage Cadres</Button></Link>
            <Link href="/campaigns"><Button variant="secondary">Assign Tasks</Button></Link>
            <Link href="/events"><Button variant="secondary">Events</Button></Link>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Upcoming Events</CardTitle>
          </CardHeader>
          <CardContent>
            <UpcomingEvents events={events} />
          </CardContent>
        </Card>
      </div>

      {/* Scoped server-side to messages this Admin sent, the same rule the
          Message Log page uses — so the two always show the same number. */}
      {overview?.communication && (
        <div className="mt-6">
          <CommunicationCard stats={overview.communication} href="/message-log" />
        </div>
      )}
    </div>
  );
}
