"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTaskDetail } from "@/hooks/use-tasks";
import { useTaskAllocations } from "@/hooks/use-campaign-detail";
import {
  formatDate,
  formatDateTime,
  humanise,
  priorityTone,
  ProgressBar,
  statusTone,
} from "./campaign-ui";

/**
 * Everything about one task, opened from the campaign's Tasks tab.
 *
 * A drawer rather than a route: you are drilling into a row of the table
 * you're looking at, and closing it should put you back on that exact
 * filtered table rather than re-running the page. It reuses the existing
 * /tasks/:id/detail endpoint for the task itself and /tasks/:id/allocations
 * for the per-Cadre rows — no new task-reading API was invented for this.
 */
export function TaskDetailsDrawer({
  taskId,
  campaignName,
  onClose,
}: {
  taskId: string;
  campaignName: string;
  onClose: () => void;
}) {
  const { data: task, isLoading, isError, error } = useTaskDetail(taskId);
  const { data: allocations, isLoading: allocLoading } = useTaskAllocations(taskId);

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs text-slate-400">{campaignName}</p>
            <h2 className="truncate text-sm font-semibold text-slate-800">{task?.name ?? "Task"}</h2>
            <p className="font-mono text-[10px] text-slate-400">{taskId}</p>
          </div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {isError && <p className="text-sm text-red-600">{(error as Error)?.message ?? "Could not load this task"}</p>}
          {isLoading && <p className="py-8 text-center text-sm text-slate-500">Loading task…</p>}

          {task && (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge tone={statusTone(task.currentStatus)}>{humanise(task.currentStatus)}</Badge>
                <Badge tone={priorityTone(task.priority)}>{humanise(task.priority)}</Badge>
              </div>

              <Section title="Task">
                <Field label="Objective" value={task.objective} />
                <Field label="Description / Instructions" value={task.description} />
                <Field label="Remarks" value={task.remarks} />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Created by" value={task.createdByName} />
                  <Field label="Created" value={formatDate(task.createdAt)} />
                  <Field label="Due" value={formatDateTime(task.deadline)} />
                  <Field label="Cadres assigned" value={String(task.assignedMembers.length)} />
                </div>
              </Section>

              {/* Only the levels this task actually has — a task with no
                  polling station recorded shows the target areas instead of
                  four blank official fields. */}
              <Section title="Official location">
                {task.officialLocation ? (
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="State" value={task.officialLocation.state} />
                    <Field label="District" value={task.officialLocation.district} />
                    <Field
                      label="Assembly Constituency"
                      value={
                        task.officialLocation.assemblyConstituencyNo
                          ? `${task.officialLocation.assemblyConstituencyNo} — ${task.officialLocation.assemblyConstituency ?? ""}`
                          : task.officialLocation.assemblyConstituency
                      }
                    />
                    <Field label="Polling Station No." value={task.officialLocation.pollingStationNo} />
                    <div className="col-span-2">
                      <Field label="Polling Station" value={task.officialLocation.pollingStationName} />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No official Polling Station was recorded for this task.</p>
                )}
                {(task.districts.length > 0 || task.constituencies.length > 0 || task.booths.length > 0) && (
                  <div className="mt-3 grid grid-cols-3 gap-4 border-t border-slate-100 pt-3">
                    <Field label="Target districts" value={task.districts.join(", ")} />
                    <Field label="Target constituencies" value={task.constituencies.join(", ")} />
                    <Field label="Target stations" value={task.booths.join(", ")} />
                  </div>
                )}
              </Section>

              <Section title={`Assigned Cadres (${allocations?.length ?? 0})`}>
                {allocLoading && <p className="py-4 text-center text-sm text-slate-500">Loading allocations…</p>}
                {!allocLoading && (allocations?.length ?? 0) === 0 && (
                  <p className="py-4 text-sm text-slate-500">
                    This task hasn&apos;t been allocated to any Cadre yet.
                  </p>
                )}
                {(allocations?.length ?? 0) > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[540px] text-sm">
                      <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                        <tr>
                          <th className="py-2 pr-3">Cadre</th>
                          <th className="py-2 pr-3">Area</th>
                          <th className="py-2 pr-3">Assigned</th>
                          <th className="py-2 pr-3">Progress</th>
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2">WhatsApp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(allocations ?? []).map((a) => (
                          <tr key={a.taskId} className="border-b border-slate-50">
                            <td className="py-2 pr-3">
                              <p className="text-slate-800">{a.cadre.name}</p>
                              <p className="text-xs text-slate-400">{a.cadre.phone}</p>
                            </td>
                            <td className="py-2 pr-3 text-slate-600">{a.area}</td>
                            <td className="py-2 pr-3 text-slate-500">{formatDate(a.assignedAt)}</td>
                            <td className="py-2 pr-3">
                              <div className="flex items-center gap-2">
                                <ProgressBar pct={a.progressPct} compact />
                                <span className="text-xs text-slate-500">{a.progressPct}%</span>
                              </div>
                            </td>
                            <td className="py-2 pr-3">
                              <Badge tone={statusTone(a.status)}>{humanise(a.status)}</Badge>
                            </td>
                            <td className="py-2">
                              <Badge tone={statusTone(a.whatsapp.status)}>{a.whatsapp.status}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {/* PoliOS records no per-Cadre quota — a Task row is the
                    allocation, carrying status and reported progress, not a
                    numeric split. Saying so beats inventing a target column. */}
                {(allocations?.length ?? 0) > 0 && (
                  <p className="mt-2 text-xs text-slate-400">
                    Progress is the latest percentage each Cadre reported. Per-Cadre numeric targets aren&apos;t
                    tracked — campaign targets are allocated by area under Targets.
                  </p>
                )}
              </Section>

              {task.outgoingTemplate && (
                <Section title="Communication">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Template" value={task.outgoingTemplate.name} />
                    <Field label="Language" value={task.outgoingTemplate.language} />
                  </div>
                  {task.outgoingTemplate.preview && (
                    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-medium uppercase text-slate-400">Message preview</p>
                      <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                        {task.outgoingTemplate.preview}
                      </p>
                    </div>
                  )}
                </Section>
              )}

              {task.attachmentUrls.length > 0 && (
                <Section title={`Attachments (${task.attachmentUrls.length})`}>
                  <ul className="space-y-1">
                    {task.attachmentUrls.map((url, i) => (
                      <li key={url}>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-brand-600 hover:underline"
                        >
                          📎 {url.split("/").pop() ?? `Attachment ${i + 1}`}
                        </a>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="mb-3 text-sm font-semibold text-slate-800">{title}</p>
        <div className="space-y-3">{children}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className="whitespace-pre-line text-sm text-slate-800">{value || "—"}</p>
    </div>
  );
}
