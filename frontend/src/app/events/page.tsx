"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RegionSelect } from "@/components/region-select";
import { useCurrentUser } from "@/hooks/use-auth";
import { useEvents, useCreateEvent } from "@/hooks/use-events";
import { useSearchQuery, matchesQuery } from "@/hooks/use-search-query";

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

// useSearchQuery() reads useSearchParams(), which needs a Suspense boundary
// or `next build` refuses to prerender the page.
export default function EventsPage() {
  return (
    <Suspense fallback={null}>
      <EventsPageContent />
    </Suspense>
  );
}

function EventsPageContent() {
  const { data: user } = useCurrentUser();
  const { data: events, isLoading } = useEvents();
  const createEvent = useCreateEvent();
  const [form, setForm] = useState({ name: "", description: "", regionId: "", startAt: "" });
  // The create form lives in a modal rather than a permanent side card, so
  // the page opens on the events list — which is what people come here to
  // read — and the table gets the full width.
  const [createOpen, setCreateOpen] = useState(false);
  const canCreate = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";

  const query = useSearchQuery();
  const visibleEvents = useMemo(
    () => (events ?? []).filter((e) => matchesQuery(query, e.name, e.location, e.district)),
    [events, query],
  );

  const closeCreate = () => {
    setCreateOpen(false);
    setForm({ name: "", description: "", regionId: "", startAt: "" });
    // Clear a failed attempt's message so reopening starts clean.
    createEvent.reset();
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createEvent.mutate(
      { ...form, startAt: new Date(form.startAt), attachmentUrls: [] },
      // The list refreshes itself (useCreateEvent invalidates ["events"]), so
      // success only has to dismiss the modal.
      { onSuccess: closeCreate },
    );
  };

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-900">
          Events
          {query && <span className="font-normal text-slate-400"> — search: &quot;{query}&quot;</span>}
        </h1>
        {canCreate && <Button onClick={() => setCreateOpen(true)}>+ Create Event</Button>}
      </div>

      <div>
        <Card>
          <CardHeader>
            <CardTitle>
              Upcoming &amp; Past Events{" "}
              <span className="font-normal text-slate-400">({visibleEvents.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* Now that the table spans the full width, it scrolls inside its
                own container on narrow screens rather than widening the page. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
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
                {visibleEvents.map((event) => (
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
                {!isLoading && visibleEvents.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                      {query ? `No events match "${query}".` : "No events yet."}
                    </td>
                  </tr>
                )}
              </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {createOpen && (
        <CreateEventModal
          form={form}
          setForm={setForm}
          onSubmit={onSubmit}
          onCancel={closeCreate}
          isPending={createEvent.isPending}
          error={createEvent.isError ? (createEvent.error as Error).message : null}
        />
      )}
    </AppShell>
  );
}

interface EventForm {
  name: string;
  description: string;
  regionId: string;
  startAt: string;
}

/**
 * The create form, in a modal rather than a permanent side card so the list
 * owns the page. Same backdrop/card treatment as the confirm dialogs — this
 * needs a form rather than a message, so it doesn't reuse that component, but
 * it deliberately matches it.
 */
function CreateEventModal({
  form,
  setForm,
  onSubmit,
  onCancel,
  isPending,
  error,
}: {
  form: EventForm;
  setForm: (form: EventForm) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  isPending: boolean;
  error: string | null;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-lg">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Create Event</h2>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
            <Label htmlFor="startAt">Date &amp; time</Label>
            <Input
              id="startAt"
              type="datetime-local"
              required
              value={form.startAt}
              onChange={(e) => setForm({ ...form, startAt: e.target.value })}
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <p className="text-xs text-slate-400">
            More fields (objective, location, organizer, attachments, etc.) can be added from the Event Details page
            after creation.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create Event"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
