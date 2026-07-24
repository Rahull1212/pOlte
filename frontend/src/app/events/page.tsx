"use client";

import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RegionSelect } from "@/components/region-select";
import { useCurrentUser } from "@/hooks/use-auth";
import { useEvents, useCreateEvent, useMarkAttendance, useEventReport } from "@/hooks/use-events";

function EventRow({ eventId, name, startAt }: { eventId: string; name: string; startAt: string }) {
  const { data: user } = useCurrentUser();
  const [showReport, setShowReport] = useState(false);
  const { data: report } = useEventReport(showReport ? eventId : "");
  const markAttendance = useMarkAttendance(eventId);

  return (
    <div className="rounded-md border border-slate-100 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-800">{name}</p>
          <p className="text-xs text-slate-500">{new Date(startAt).toLocaleString()}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => user && markAttendance.mutate({ userId: user.id, attended: true })}
          >
            Check In
          </Button>
          <Button variant="secondary" onClick={() => setShowReport((s) => !s)}>
            {showReport ? "Hide Report" : "View Report"}
          </Button>
        </div>
      </div>
      {showReport && report && (
        <p className="mt-2 text-xs text-slate-600">
          Invited: {report.totalInvited} · Attended: {report.totalAttended} · Rate: {report.attendanceRate}%
        </p>
      )}
    </div>
  );
}

export default function EventsPage() {
  const { data: user } = useCurrentUser();
  const { data: events, isLoading } = useEvents();
  const createEvent = useCreateEvent();
  const [form, setForm] = useState({ name: "", description: "", regionId: "", startAt: "" });
  const canCreate = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createEvent.mutate(
      { ...form, startAt: new Date(form.startAt) },
      { onSuccess: () => setForm({ name: "", description: "", regionId: "", startAt: "" }) },
    );
  };

  return (
    <AppShell>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">Events</h1>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {canCreate && (
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle>Create Event</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-3">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="regionId">Area</Label>
                  <RegionSelect value={form.regionId} onChange={(regionId) => setForm({ ...form, regionId })} />
                </div>
                <div>
                  <Label htmlFor="startAt">Date & time</Label>
                  <Input
                    id="startAt"
                    type="datetime-local"
                    required
                    value={form.startAt}
                    onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                  />
                </div>
                {createEvent.isError && <p className="text-xs text-red-600">{(createEvent.error as Error).message}</p>}
                <Button type="submit" className="w-full" disabled={createEvent.isPending}>
                  {createEvent.isPending ? "Creating..." : "Create Event"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Card className={canCreate ? "md:col-span-2" : "md:col-span-3"}>
          <CardHeader>
            <CardTitle>Upcoming & Past Events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {events?.map((event) => (
              <EventRow key={event.id} eventId={event.id} name={event.name} startAt={event.startAt} />
            ))}
            {!isLoading && events?.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500">No events yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
