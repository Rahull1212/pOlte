"use client";

import Link from "next/link";
import { KpiTile } from "@/components/kpi-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useManagedUsers } from "@/hooks/use-users";
import { useEvents } from "@/hooks/use-events";
import { useCurrentUser } from "@/hooks/use-auth";
import { UpcomingEvents } from "@/components/upcoming-events";

export function AdminDashboard() {
  const { data: currentUser } = useCurrentUser();
  const { data: cadres } = useManagedUsers("CADRE");
  const { data: events } = useEvents();

  return (
    <div>
      <Card className="mb-6 bg-gradient-to-r from-brand-600 to-brand-700 text-white">
        <CardContent className="py-6">
          <p className="text-lg font-semibold">Welcome back, {currentUser?.name ?? "Admin"} 👋</p>
          <p className="mt-1 text-sm text-brand-100">Manage your assigned area and cadre team</p>
        </CardContent>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiTile label="My Cadres" value={cadres?.length ?? "-"} href="/users" />
        <KpiTile label="Upcoming Events" value={events?.length ?? "-"} href="/events" />
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
    </div>
  );
}
