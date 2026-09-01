"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RegionSelect } from "@/components/region-select";
import { useCurrentUser } from "@/hooks/use-auth";
import { useEvents, useCreateEvent } from "@/hooks/use-events";

const statusTone: Record<string, "slate" | "blue" | "green"> = {
  UPCOMING: "blue",
  ONGOING: "green",
  COMPLETED: "slate",
};

const statusLabel: Record<string, string> = {
  UPCOMING: "Upcoming",
  ONGOING: "Ongoing",
  COMPLETED: "Completed",
};

export default function EventsPage() {
  const { data: user } = useCurrentUser();
  const { data: events, isLoading } = useEvents();
  const createEvent = useCreateEvent();
  const [form, setForm] = useState({ name: "", description: "", regionId: "", startAt: "" });
  const canCreate = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createEvent.mutate(
      { ...form, startAt: new Date(form.startAt), attachmentUrls: [] },
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
                <p className="text-xs text-slate-400">
                  More fields (objective, location, organizer, attachments, etc.) can be added from the Event
                  Details page after creation.
                </p>
              </form>
            </CardContent>
          </Card>
        )}

        <Card className={canCreate ? "md:col-span-2" : "md:col-span-3"}>
          <CardHeader>
            <CardTitle>
              Upcoming & Past Events <span className="font-normal text-slate-400">({events?.length ?? 0})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-2">Event</th>
                  <th className="px-5 py-2">Date &amp; Time</th>
                  <th className="px-5 py-2">Area</th>
                  <th className="px-5 py-2">Status</th>
                  <th className="px-5 py-2">Invited / Attended</th>
                  <th className="px-5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events?.map((event) => (
                  <tr key={event.id} className="border-b border-slate-50">
                    <td className="px-5 py-2 font-medium text-slate-800">{event.name}</td>
                    <td className="px-5 py-2 text-slate-500">{new Date(event.startAt).toLocaleString()}</td>
                    <td className="px-5 py-2 text-slate-600">{event.district || event.location || "—"}</td>
                    <td className="px-5 py-2">
                      <Badge tone={statusTone[event.status]}>{statusLabel[event.status]}</Badge>
                    </td>
                    <td className="px-5 py-2 text-slate-600">
                      {event.invitedCount} / {event.attendedCount}
                    </td>
                    <td className="px-5 py-2 text-right">
                      <Link href={`/events/${event.id}`}>
                        <Button variant="secondary">View Details</Button>
                      </Link>
                    </td>
                  </tr>
                ))}
                {!isLoading && events?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                      No events yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
