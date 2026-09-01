"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/use-auth";
import { useEventDetail, useMarkAttendance, useUpdateEventRsvp } from "@/hooks/use-events";

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

const rsvpTone: Record<string, "slate" | "green" | "red"> = {
  PENDING: "slate",
  CONFIRMED: "green",
  DECLINED: "red",
};

const rsvpLabel: Record<string, string> = {
  PENDING: "No Response",
  CONFIRMED: "Confirmed",
  DECLINED: "Declined",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{value || <span className="text-slate-400">—</span>}</p>
    </div>
  );
}

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: user } = useCurrentUser();
  const { data: event, isLoading } = useEventDetail(id);
  const markAttendance = useMarkAttendance(id);
  const updateRsvp = useUpdateEventRsvp(id);

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Loading event…</p>
      </AppShell>
    );
  }
  if (!event) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Event not found.</p>
      </AppShell>
    );
  }

  const me = user ? event.assignedMembers.find((m) => m.id === user.id) : undefined;
  const startDate = new Date(event.startAt);

  return (
    <AppShell>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link href="/events" className="text-xs text-brand-600 hover:underline">
            ← Back to Events
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">{event.name}</h1>
          <div className="mt-2">
            <Badge tone={statusTone[event.status]}>{statusLabel[event.status]}</Badge>
          </div>
        </div>
        <Link href={`/events/${id}/dashboard`}>
          <Button>View Event Dashboard</Button>
        </Link>
      </div>

      {me && (
        <Card className="mb-5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="text-sm font-medium text-slate-800">Your response</p>
              <div className="mt-1 flex items-center gap-2">
                <Badge tone={rsvpTone[me.rsvpStatus]}>{rsvpLabel[me.rsvpStatus]}</Badge>
                {me.attended && <Badge tone="green">Checked In ✓</Badge>}
              </div>
            </div>
            <div className="flex gap-2">
              {me.rsvpStatus !== "CONFIRMED" && (
                <Button
                  variant="secondary"
                  disabled={updateRsvp.isPending}
                  onClick={() => user && updateRsvp.mutate({ userId: user.id, rsvpStatus: "CONFIRMED" })}
                >
                  Confirm Attendance
                </Button>
              )}
              {me.rsvpStatus !== "DECLINED" && (
                <Button
                  variant="secondary"
                  disabled={updateRsvp.isPending}
                  onClick={() => user && updateRsvp.mutate({ userId: user.id, rsvpStatus: "DECLINED" })}
                >
                  Decline
                </Button>
              )}
              {!me.attended && (
                <Button
                  disabled={markAttendance.isPending}
                  onClick={() => user && markAttendance.mutate({ userId: user.id, attended: true })}
                >
                  {markAttendance.isPending ? "Checking in..." : "Check In"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Event Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Objective" value={event.objective} />
              <Field label="Description" value={event.description} />
              <Field label="Instructions" value={event.instructions} />
              <Field label="Comments" value={event.remarks} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Location</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Location" value={event.location} />
              <Field label="District" value={event.district} />
              <Field label="Constituency" value={event.constituency} />
              <Field label="Mandal" value={event.mandal} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assigned Members ({event.assignedMembers.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-2">Name</th>
                    <th className="px-5 py-2">Area</th>
                    <th className="px-5 py-2">RSVP</th>
                    <th className="px-5 py-2">Attended</th>
                    <th className="px-5 py-2">Checked In</th>
                  </tr>
                </thead>
                <tbody>
                  {event.assignedMembers.map((m) => (
                    <tr key={m.id} className="border-b border-slate-50">
                      <td className="px-5 py-2 text-slate-800">{m.name}</td>
                      <td className="px-5 py-2 text-slate-600">{m.area}</td>
                      <td className="px-5 py-2">
                        <Badge tone={rsvpTone[m.rsvpStatus]}>{rsvpLabel[m.rsvpStatus]}</Badge>
                      </td>
                      <td className="px-5 py-2">{m.attended ? <Badge tone="green">Yes</Badge> : <Badge tone="slate">No</Badge>}</td>
                      <td className="px-5 py-2 text-slate-500">
                        {m.checkedInAt ? new Date(m.checkedInAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                  {event.assignedMembers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-slate-400">
                        No members assigned.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
            </CardHeader>
            <CardContent>
              {event.attachmentUrls.length === 0 ? (
                <p className="text-sm text-slate-400">No attachments.</p>
              ) : (
                <ul className="space-y-1">
                  {event.attachmentUrls.map((url) => (
                    <li key={url}>
                      <a href={url} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline">
                        {url.split("/").pop()}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Date" value={startDate.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })} />
              <Field
                label="Time"
                value={`${startDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}${
                  event.endAt ? ` – ${new Date(event.endAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""
                }`}
              />
              <Field label="Organizer" value={event.organizer} />
              <Field label="Expected Attendees" value={event.expectedAttendees} />
              <Field label="Created By" value={event.createdByName} />
              <Field label="Created Date" value={new Date(event.createdAt).toLocaleString()} />
              <Field label="Event Status" value={statusLabel[event.status]} />
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
