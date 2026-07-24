"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiTile } from "@/components/kpi-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useManagedUsers } from "@/hooks/use-users";
import { useDashboardSummary } from "@/hooks/use-campaigns";
import { useEvents } from "@/hooks/use-events";
import { useRecentActivity } from "@/hooks/use-audit";
import { useCurrentUser } from "@/hooks/use-auth";
import { ActivityFeed } from "@/components/activity-feed";
import { UpcomingEvents } from "@/components/upcoming-events";

export function SuperAdminDashboard() {
  const { data: currentUser } = useCurrentUser();
  const { data: admins } = useManagedUsers("ADMIN");
  const { data: cadres } = useManagedUsers("CADRE");
  const { data: campaignSummary } = useDashboardSummary();
  const { data: events } = useEvents();
  const { data: activity, isLoading: activityLoading } = useRecentActivity();

  const totalCampaigns = (campaignSummary?.active ?? 0) + (campaignSummary?.upcoming ?? 0) + (campaignSummary?.completed ?? 0);
  const chartData = [
    { name: "Active", count: campaignSummary?.active ?? 0 },
    { name: "Upcoming", count: campaignSummary?.upcoming ?? 0 },
    { name: "Completed", count: campaignSummary?.completed ?? 0 },
  ];

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
            <Button className="bg-white text-brand-700 hover:bg-brand-50">+ New Campaign</Button>
          </Link>
        </CardContent>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiTile label="Admins" value={admins?.length ?? "-"} href="/users" />
        <KpiTile label="Cadres" value={cadres?.length ?? "-"} href="/users?role=CADRE" />
        <KpiTile label="Active Campaigns" value={campaignSummary?.active ?? "-"} href="/campaigns?status=ACTIVE" />
        <KpiTile label="Total Campaigns" value={totalCampaigns} href="/campaigns" />
      </div>

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
            <CardTitle>Upcoming Events</CardTitle>
          </CardHeader>
          <CardContent>
            <UpcomingEvents events={events} />
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
