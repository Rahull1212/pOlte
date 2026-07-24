"use client";

import { KpiTile } from "@/components/kpi-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskBoard } from "@/components/task-board";
import { useTasks } from "@/hooks/use-tasks";
import { useEvents } from "@/hooks/use-events";
import { useCurrentUser } from "@/hooks/use-auth";
import { UpcomingEvents } from "@/components/upcoming-events";

export function CadreDashboard() {
  const { data: user } = useCurrentUser();
  const { data: tasks } = useTasks({ assignedToId: user?.id });
  const { data: events } = useEvents();

  const pending = tasks?.filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS").length ?? 0;
  const completed = tasks?.filter((t) => t.status === "COMPLETED").length ?? 0;

  return (
    <div>
      <Card className="mb-6 bg-gradient-to-r from-brand-600 to-brand-700 text-white">
        <CardContent className="py-6">
          <p className="text-lg font-semibold">Welcome back, {user?.name ?? "Cadre"} 👋</p>
          <p className="mt-1 text-sm text-brand-100">Field-level execution</p>
        </CardContent>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiTile label="Pending Tasks" value={pending} />
        <KpiTile label="Completed Tasks" value={completed} />
        <KpiTile label="My Events" value={events?.length ?? "-"} href="/events" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>My Assigned Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <TaskBoard tasks={tasks ?? []} />
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
    </div>
  );
}
