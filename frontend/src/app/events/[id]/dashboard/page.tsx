"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEventDashboard, EventDashboardMember } from "@/hooks/use-events";

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

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone ?? "text-slate-900"}`}>{value}</p>
    </div>
  );
}

export default function EventDashboardPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: dashboard, isLoading } = useEventDashboard(id);

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Loading dashboard…</p>
      </AppShell>
    );
  }
  if (!dashboard) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Event not found.</p>
      </AppShell>
    );
  }

  const { kpis, districtWise, mandalWise, memberWise, attendanceTrend } = dashboard;

  return (
    <AppShell>
      <div className="mb-6">
        <Link href={`/events/${id}`} className="text-xs text-brand-600 hover:underline">
          ← Back to Event Details
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-slate-900">{dashboard.name} — Event Dashboard</h1>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Total Invited" value={kpis.totalInvited} />
        <Kpi label="Confirmed" value={kpis.confirmed} tone="text-emerald-600" />
        <Kpi label="No Response" value={kpis.noResponse} tone="text-amber-600" />
        <Kpi label="Attended" value={kpis.attended} tone="text-emerald-600" />
        <Kpi label="Not Attended" value={kpis.notAttended} tone="text-red-600" />
        <Kpi label="Attendance %" value={`${kpis.attendancePct}%`} />
        <Kpi label="Checked In" value={kpis.checkedIn} tone="text-blue-600" />
        <Kpi label="Pending Check In" value={kpis.pendingCheckIn} />
        <Kpi label="Late Arrivals" value={kpis.lateArrivals} tone={kpis.lateArrivals > 0 ? "text-amber-600" : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Attendance Trend</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-2">Date</th>
                    <th className="px-5 py-2">Checked In</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceTrend.map((d) => (
                    <tr key={d.date} className="border-b border-slate-50">
                      <td className="px-5 py-2 text-slate-800">{d.date}</td>
                      <td className="px-5 py-2 text-slate-600">{d.checkedIn}</td>
                    </tr>
                  ))}
                  {attendanceTrend.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-5 py-6 text-center text-slate-400">
                        No check-ins recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Member / Cadre-wise Attendance</CardTitle>
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
                  {memberWise.map((m: EventDashboardMember) => (
                    <tr key={m.userId} className="border-b border-slate-50">
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
                  {memberWise.length === 0 && (
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
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>District-wise Attendance</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">District</th>
                    <th className="px-4 py-2">Attended</th>
                    <th className="px-4 py-2">%</th>
                  </tr>
                </thead>
                <tbody>
                  {districtWise.map((d) => (
                    <tr key={d.district} className="border-b border-slate-50">
                      <td className="px-4 py-2 text-slate-800">{d.district}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {d.attended}/{d.invited}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{d.attendancePct}%</td>
                    </tr>
                  ))}
                  {districtWise.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                        No data.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mandal-wise Attendance</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Mandal</th>
                    <th className="px-4 py-2">Attended</th>
                    <th className="px-4 py-2">%</th>
                  </tr>
                </thead>
                <tbody>
                  {mandalWise.map((m) => (
                    <tr key={m.mandal} className="border-b border-slate-50">
                      <td className="px-4 py-2 text-slate-800">{m.mandal}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {m.attended}/{m.invited}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{m.attendancePct}%</td>
                    </tr>
                  ))}
                  {mandalWise.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                        No data.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Event Issues / Remarks</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-700">
                {dashboard.remarks || <span className="text-slate-400">No issues or remarks recorded.</span>}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
