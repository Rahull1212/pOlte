"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTaskDetail, TaskSummaryStatus } from "@/hooks/use-tasks";

const statusTone: Record<TaskSummaryStatus, "slate" | "blue" | "green" | "red" | "amber"> = {
  PENDING: "slate",
  IN_PROGRESS: "blue",
  COMPLETED: "green",
  OVERDUE: "red",
  NEEDS_ATTENTION: "amber",
  AWAITING_ALLOCATION: "amber",
};

const statusLabel: Record<TaskSummaryStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  OVERDUE: "Overdue",
  NEEDS_ATTENTION: "Needs Attention",
  AWAITING_ALLOCATION: "Awaiting Allocation",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{value || <span className="text-slate-400">—</span>}</p>
    </div>
  );
}

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: task, isLoading } = useTaskDetail(id);

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Loading task…</p>
      </AppShell>
    );
  }

  if (!task) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Task not found.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link href="/tasks" className="text-xs text-brand-600 hover:underline">
            ← Back to Tasks
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">{task.name}</h1>
          <div className="mt-2 flex items-center gap-2">
            <Badge tone={statusTone[task.currentStatus]}>{statusLabel[task.currentStatus]}</Badge>
            <Badge tone="slate">{task.priority}</Badge>
          </div>
        </div>
        {task.awaitingAllocation ? (
          <Link href={`/tasks/${id}/allocate`}>
            <Button>Allocate to Cadres</Button>
          </Link>
        ) : (
          <Link href={`/tasks/${id}/dashboard`}>
            <Button>View Task Dashboard</Button>
          </Link>
        )}
      </div>

      {task.awaitingAllocation && (
        <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This task was routed to your area by a Super Admin and hasn't been sent to any Cadres yet. Click
          "Allocate to Cadres" to choose who it goes to — it's sent via WhatsApp only once you allocate it.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Task Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Objective" value={task.objective} />
              <Field label="Description / Instructions" value={task.description} />
              <Field label="Additional Details" value={task.additionalDetails} />
              <Field label="Comments / Remarks" value={task.remarks} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Location</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="District" value={task.districts.join(", ")} />
              <Field label="Mandal" value={task.mandals.join(", ")} />
              <Field label="Village / Booth" value={task.booths.join(", ")} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assigned Members ({task.assignedMembers.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-2">Name</th>
                    <th className="px-5 py-2">Area</th>
                  </tr>
                </thead>
                <tbody>
                  {task.assignedMembers.map((m) => (
                    <tr key={m.id} className="border-b border-slate-50">
                      <td className="px-5 py-2 text-slate-800">{m.name}</td>
                      <td className="px-5 py-2 text-slate-600">{m.area}</td>
                    </tr>
                  ))}
                  {task.assignedMembers.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-5 py-6 text-center text-slate-400">
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
              {task.attachmentUrls.length === 0 ? (
                <p className="text-sm text-slate-400">No attachments.</p>
              ) : (
                <ul className="space-y-1">
                  {task.attachmentUrls.map((url) => (
                    <li key={url}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-brand-600 hover:underline"
                      >
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
              <Field label="Deadline" value={new Date(task.deadline).toLocaleString()} />
              <Field label="Priority" value={task.priority} />
              <Field label="Current Status" value={statusLabel[task.currentStatus]} />
              <Field label="Created By" value={task.createdByName} />
              <Field label="Created Date" value={new Date(task.createdAt).toLocaleString()} />
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
