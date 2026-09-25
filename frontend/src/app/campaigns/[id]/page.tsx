"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useCurrentUser } from "@/hooks/use-auth";
import {
  CampaignTaskRow,
  useCampaignOverview,
  useCampaignTasks,
  useCampaignCadres,
  useCampaignCommunication,
  useCampaignActivity,
  useCampaignAttachments,
} from "@/hooks/use-campaign-detail";
import { TaskDetailsDrawer } from "@/components/campaign/task-details-drawer";
import { CampaignResponseBanner } from "@/components/campaign/campaign-response-banner";
import {
  formatDate,
  formatDateTime,
  ProgressBar,
  statusTone,
  priorityTone,
  humanise,
} from "@/components/campaign/campaign-ui";
import { ButtonResponsesCard } from "@/components/button-responses-card";

const TABS = ["Overview", "Tasks", "Cadres", "Progress", "Communication", "Activity", "Attachments"] as const;
type Tab = (typeof TABS)[number];

export default function CampaignDetailPage() {
  return (
    <Suspense fallback={null}>
      <CampaignDetailContent />
    </Suspense>
  );
}

function CampaignDetailContent() {
  const { id } = useParams<{ id: string }>();
  const { data: user } = useCurrentUser();
  const [tab, setTab] = useState<Tab>("Overview");
  // The task drawer holds a task/batch id — the Tasks tab hands it over and
  // the drawer fetches its own detail, so a refresh can't leave it stale.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useCampaignOverview(id);

  // A Cadre has no Cadres/Communication tab — those roll up other people's
  // work, which is outside what they're allowed to see.
  const visibleTabs = useMemo(
    () => (user?.role === "CADRE" ? TABS.filter((t) => t !== "Cadres" && t !== "Communication") : [...TABS]),
    [user?.role],
  );

  if (isError) {
    const message = (error as Error)?.message ?? "";
    const notFound = message.toLowerCase().includes("not found");
    return (
      <AppShell>
        <Breadcrumb name={null} />
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-slate-800">
              {notFound ? "Campaign not found" : "Could not load this campaign"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {notFound
                ? "It may have been deleted, or it isn't one of the campaigns you have access to."
                : message}
            </p>
            <Link href="/campaigns" className="mt-4 inline-block">
              <Button variant="secondary">← Back to Campaigns</Button>
            </Link>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isLoading || !data) {
    return (
      <AppShell>
        <Breadcrumb name={null} />
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">Loading campaign…</CardContent>
        </Card>
      </AppShell>
    );
  }

  const { campaign, summary, progress } = data;
  // Filing work under a campaign requires having taken it on. A Super
  // Admin owns it outright; an Admin has to have accepted their assignment
  // first (TasksService enforces exactly this server-side).
  const canAssignWork =
    user?.role === "SUPER_ADMIN" || campaign.myAssignment?.status === "ACCEPTED";

  // Editing is a Super Admin action only. An Admin running this campaign
  // accepts it and allocates the work — the brief itself stays with whoever
  // wrote it. The API refuses an Admin's PATCH either way.
  const canEdit = user?.role === "SUPER_ADMIN";

  return (
    <AppShell>
      <Breadcrumb name={campaign.name} />

      {/* ---- Header ---- */}
      <Card className="mb-4">
        <CardContent className="py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold text-slate-900">{campaign.name}</h1>
                <Badge tone={statusTone(campaign.status)}>{campaign.status}</Badge>
                <Badge tone={priorityTone(campaign.priority)}>{campaign.priority}</Badge>
                {/* Campaign Type — a classification, so it reads as a badge
                    beside the others rather than another labelled fact. */}
                {campaign.category && <Badge tone="slate">{campaign.category}</Badge>}
              </div>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">{campaign.description}</p>
              {campaign.objective && (
                <p className="mt-1 max-w-3xl text-sm text-slate-500">
                  <span className="font-medium">Objective:</span> {campaign.objective}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {/* The action an Admin accepts a campaign in order to do:
                  file work under it, then allocate that work to their
                  Cadres. Hidden until they've accepted, because the API
                  refuses it until then and offering a button that always
                  fails is worse than not offering one. */}
              {canAssignWork && (
                <Link href={`/tasks/new?campaignId=${campaign.id}`}>
                  <Button>+ Create Task</Button>
                </Link>
              )}
              {canEdit && (
                <Link href={`/campaigns/${campaign.id}/edit`}>
                  <Button>Edit Campaign</Button>
                </Link>
              )}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4">
            <Fact label="Created by" value={campaign.createdBy?.name ?? "—"} />
            <Fact label="Created on" value={formatDate(campaign.createdAt)} />
            <Fact label="Start date" value={formatDate(campaign.startDate)} />
            <Fact label="End date" value={formatDate(campaign.endDate)} />
          </div>

          {campaign.assignedAdmins.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              <span className="text-xs font-medium uppercase text-slate-400">Admins</span>
              {campaign.assignedAdmins.map((a) => (
                <span key={a.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                  {a.name}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* An Admin who was handed this campaign answers here. Above the tabs
          because until they do, most of what the tabs offer is blocked. */}
      {campaign.myAssignment && (
        <CampaignResponseBanner
          campaignId={campaign.id}
          campaignName={campaign.name}
          assignment={campaign.myAssignment}
        />
      )}

      {/* ---- Tabs ---- */}
      <div className="mb-4 flex flex-wrap gap-4 overflow-x-auto border-b border-slate-200 text-sm">
        {visibleTabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`whitespace-nowrap pb-2 ${
              tab === t
                ? "border-b-2 border-brand-600 font-medium text-brand-600"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab summary={summary} progress={progress} />}
      {tab === "Tasks" && (
        <TasksTab campaignId={id} onOpenTask={setOpenTaskId} canAllocate={canAssignWork} />
      )}
      {tab === "Cadres" && <CadresTab campaignId={id} />}
      {tab === "Progress" && <ProgressTab summary={summary} progress={progress} />}
      {tab === "Communication" && <CommunicationTab campaignId={id} />}
      {tab === "Activity" && <ActivityTab campaignId={id} />}
      {tab === "Attachments" && <AttachmentsTab campaignId={id} />}

      {openTaskId && (
        <TaskDetailsDrawer
          taskId={openTaskId}
          campaignName={campaign.name}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </AppShell>
  );
}

function Breadcrumb({ name }: { name: string | null }) {
  return (
    <div className="mb-4">
      <nav className="flex items-center gap-1 text-xs text-slate-400">
        <Link href="/campaigns" className="hover:text-slate-700 hover:underline">
          Campaigns
        </Link>
        <span>›</span>
        <span className="text-slate-600">{name ?? "…"}</span>
      </nav>
      <Link href="/campaigns" className="mt-1 inline-block text-xs text-brand-600 hover:underline">
        ← Back to Campaigns
      </Link>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{value}</p>
    </div>
  );
}

function Kpi({ label, value, tone = "text-slate-900" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

// ============================================================
// OVERVIEW
// ============================================================

function OverviewTab({
  summary,
  progress,
}: {
  summary: CampaignOverviewSummary;
  progress: CampaignOverviewProgress;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total tasks" value={summary.totalTasks} />
        <Kpi label="Completed" value={summary.completedTasks} tone="text-emerald-700" />
        <Kpi label="In progress" value={summary.inProgressTasks} tone="text-blue-700" />
        <Kpi label="Pending" value={summary.pendingTasks} tone="text-slate-700" />
        <Kpi label="Overdue" value={summary.overdueTasks} tone="text-red-600" />
        <Kpi label="Cadres assigned" value={summary.cadreCount} />
      </div>
      <ProgressCard summary={summary} progress={progress} />
    </div>
  );
}

type CampaignOverviewSummary = NonNullable<ReturnType<typeof useCampaignOverview>["data"]>["summary"];
type CampaignOverviewProgress = NonNullable<ReturnType<typeof useCampaignOverview>["data"]>["progress"];

function ProgressCard({
  summary,
  progress,
}: {
  summary: CampaignOverviewSummary;
  progress: CampaignOverviewProgress;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaign Progress</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium text-slate-800">Task completion</p>
            <p className="text-sm text-slate-500">
              {summary.completedTasks} / {summary.totalTasks} completed
            </p>
          </div>
          <ProgressBar pct={progress.taskCompletionPct} disabled={summary.totalTasks === 0} />
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressTab({
  summary,
  progress,
}: {
  summary: CampaignOverviewSummary;
  progress: CampaignOverviewProgress;
}) {
  return (
    <div className="space-y-4">
      <ProgressCard summary={summary} progress={progress} />
      <Card>
        <CardHeader>
          <CardTitle>Task breakdown</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="Completed" value={summary.completedTasks} tone="text-emerald-700" />
          <Kpi label="In progress" value={summary.inProgressTasks} tone="text-blue-700" />
          <Kpi label="Pending" value={summary.pendingTasks} />
          <Kpi label="Overdue" value={summary.overdueTasks} tone="text-red-600" />
          <Kpi label="Cancelled" value={summary.cancelledTasks} tone="text-slate-500" />
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// TASKS
// ============================================================

type SortKey = "latest" | "oldest" | "priority" | "due" | "progress";
const PRIORITY_RANK: Record<string, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

function TasksTab({
  campaignId,
  onOpenTask,
  canAllocate,
}: {
  campaignId: string;
  onOpenTask: (id: string) => void;
  canAllocate: boolean;
}) {
  const { data: tasks, isLoading, isError, error } = useCampaignTasks(campaignId);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [area, setArea] = useState("");
  const [admin, setAdmin] = useState("");
  const [dueBefore, setDueBefore] = useState("");
  const [sort, setSort] = useState<SortKey>("latest");

  const areas = useMemo(
    () => [...new Set((tasks ?? []).flatMap((t) => t.areas))].sort(),
    [tasks],
  );
  const admins = useMemo(
    () => [...new Set((tasks ?? []).map((t) => t.assignedBy?.name).filter(Boolean) as string[])].sort(),
    [tasks],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (tasks ?? []).filter((t) => {
      if (q && !(t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q))) return false;
      if (status && t.status !== status) return false;
      if (priority && t.priority !== priority) return false;
      if (area && !t.areas.includes(area)) return false;
      if (admin && t.assignedBy?.name !== admin) return false;
      if (dueBefore && new Date(t.deadline) > new Date(`${dueBefore}T23:59:59`)) return false;
      return true;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "priority":
          return (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0);
        case "due":
          return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        case "progress":
          return b.progressPct - a.progressPct;
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
    return sorted;
  }, [tasks, search, status, priority, area, admin, dueBefore, sort]);

  const clearFilters = () => {
    setSearch("");
    setStatus("");
    setPriority("");
    setArea("");
    setAdmin("");
    setDueBefore("");
    setSort("latest");
  };
  const hasFilters = Boolean(search || status || priority || area || admin || dueBefore || sort !== "latest");

  const selectClass = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4">
          <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <Label htmlFor="task-search">Search task</Label>
              <Input
                id="task-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Task name or description"
              />
            </div>
            <div>
              <Label htmlFor="f-status">Status</Label>
              <select id="f-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                {["PENDING", "IN_PROGRESS", "COMPLETED", "OVERDUE", "CANCELLED", "AWAITING_ALLOCATION"].map((s) => (
                  <option key={s} value={s}>
                    {humanise(s)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="f-priority">Priority</Label>
              <select
                id="f-priority"
                className={selectClass}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="">All</option>
                {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                  <option key={p} value={p}>
                    {humanise(p)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="f-area">Area</Label>
              <select id="f-area" className={selectClass} value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">All</option>
                {areas.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="f-admin">Assigned by</Label>
              <select id="f-admin" className={selectClass} value={admin} onChange={(e) => setAdmin(e.target.value)}>
                <option value="">All</option>
                {admins.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="f-due">Due on or before</Label>
              <Input id="f-due" type="date" value={dueBefore} onChange={(e) => setDueBefore(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="f-sort">Sort by</Label>
              <select id="f-sort" className={selectClass} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="latest">Latest</option>
                <option value="oldest">Oldest</option>
                <option value="priority">Highest priority</option>
                <option value="due">Due date</option>
                <option value="progress">Progress</option>
              </select>
            </div>
          </div>
          {hasFilters && (
            <div className="mt-3 flex items-center gap-3">
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
              <span className="text-xs text-slate-500">
                Showing {visible.length} of {tasks?.length ?? 0}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Tasks <span className="font-normal text-slate-400">({visible.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isError && <p className="px-5 py-4 text-sm text-red-600">{(error as Error)?.message}</p>}
          {isLoading && <p className="px-5 py-8 text-center text-sm text-slate-500">Loading tasks…</p>}
          {!isLoading && !isError && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-2">Task</th>
                    <th className="px-5 py-2">Status</th>
                    <th className="px-5 py-2">Priority</th>
                    <th className="px-5 py-2">Cadres</th>
                    <th className="px-5 py-2">Area</th>
                    <th className="px-5 py-2">Progress</th>
                    <th className="px-5 py-2">Due</th>
                    <th className="px-5 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onOpen={() => onOpenTask(task.id)}
                      canAllocate={canAllocate}
                    />
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-500">
                        {(tasks?.length ?? 0) === 0
                          ? "No tasks have been created under this campaign yet."
                          : "No tasks match these filters."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TaskRow({
  task,
  onOpen,
  canAllocate,
}: {
  task: CampaignTaskRow;
  onOpen: () => void;
  canAllocate: boolean;
}) {
  return (
    <tr className="border-b border-slate-50 hover:bg-slate-50">
      <td className="px-5 py-2">
        <button onClick={onOpen} className="text-left font-medium text-slate-800 hover:text-brand-600 hover:underline">
          {task.name}
        </button>
        <p className="font-mono text-[10px] text-slate-400">{task.id}</p>
      </td>
      <td className="px-5 py-2">
        <Badge tone={statusTone(task.status)}>{humanise(task.status)}</Badge>
      </td>
      <td className="px-5 py-2">
        <Badge tone={priorityTone(task.priority)}>{humanise(task.priority)}</Badge>
      </td>
      <td className="px-5 py-2 text-slate-600">{task.cadreCount}</td>
      <td className="max-w-[220px] truncate px-5 py-2 text-slate-600" title={task.areas.join(", ")}>
        {task.areas.length === 0 ? "—" : task.areas.length === 1 ? task.areas[0] : `${task.areas.length} areas`}
      </td>
      <td className="px-5 py-2">
        <div className="flex items-center gap-2">
          <ProgressBar pct={task.progressPct} compact />
          <span className="w-9 text-xs text-slate-500">{task.progressPct}%</span>
        </div>
      </td>
      <td className="px-5 py-2 text-slate-500">{formatDate(task.deadline)}</td>
      <td className="px-5 py-2 text-right">
        <div className="flex justify-end gap-2">
          {/* A task created but not yet sent to anyone. Allocating is what
              actually puts it in front of Cadres over WhatsApp, so it's the
              primary action while it's still waiting. */}
          {task.awaitingAllocation && canAllocate && (
            <Link href={`/tasks/${task.id}/allocate`}>
              <Button>Allocate</Button>
            </Link>
          )}
          <Button variant="secondary" onClick={onOpen}>
            View
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ============================================================
// CADRES
// ============================================================

function CadresTab({ campaignId }: { campaignId: string }) {
  const { data: cadres, isLoading, isError, error } = useCampaignCadres(campaignId, true);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Cadres <span className="font-normal text-slate-400">({cadres?.length ?? 0})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isError && <p className="px-5 py-4 text-sm text-red-600">{(error as Error)?.message}</p>}
        {isLoading && <p className="px-5 py-8 text-center text-sm text-slate-500">Loading cadres…</p>}
        {!isLoading && !isError && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-2">Cadre</th>
                  <th className="px-5 py-2">Phone</th>
                  <th className="px-5 py-2">Area</th>
                  <th className="px-5 py-2">Tasks</th>
                  <th className="px-5 py-2">Completed</th>
                  <th className="px-5 py-2">Avg progress</th>
                </tr>
              </thead>
              <tbody>
                {(cadres ?? []).map((c) => (
                  <tr key={c.id} className="border-b border-slate-50">
                    <td className="px-5 py-2 font-medium text-slate-800">{c.name}</td>
                    <td className="px-5 py-2 text-slate-600">{c.phone}</td>
                    <td className="px-5 py-2 text-slate-600">{c.area}</td>
                    <td className="px-5 py-2 text-slate-600">{c.taskCount}</td>
                    <td className="px-5 py-2 text-slate-600">
                      {c.completedCount} / {c.taskCount}
                    </td>
                    <td className="px-5 py-2">
                      <div className="flex items-center gap-2">
                        <ProgressBar pct={c.avgProgressPct} compact />
                        <span className="w-9 text-xs text-slate-500">{c.avgProgressPct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {(cadres?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                      No Cadres have been allocated tasks under this campaign yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// COMMUNICATION
// ============================================================

function CommunicationTab({ campaignId }: { campaignId: string }) {
  const { data, isLoading, isError, error } = useCampaignCommunication(campaignId, true);

  if (isError) return <Card><CardContent className="py-6 text-sm text-red-600">{(error as Error)?.message}</CardContent></Card>;
  if (isLoading || !data)
    return <Card><CardContent className="py-8 text-center text-sm text-slate-500">Loading messages…</CardContent></Card>;

  if (data.total === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-slate-500">
          No WhatsApp messages have been sent for this campaign&apos;s tasks yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Which button each Cadre pressed across this whole campaign — the
          answer to "who said yes", not just "how many messages landed". */}
      <ButtonResponsesCard filters={{ campaignId }} title="Who pressed which button" />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Total messages" value={data.total} />
        <Kpi label="Sent" value={data.sent} tone="text-blue-700" />
        <Kpi label="Delivered" value={data.delivered} tone="text-emerald-700" />
        <Kpi label="Read" value={data.read} tone="text-emerald-700" />
        <Kpi label="Failed" value={data.failed} tone="text-red-600" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Templates used</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.templates.length === 0 && <p className="text-sm text-slate-500">No template recorded.</p>}
          {data.templates.map((t) => (
            <div key={t.name} className="flex items-center justify-between text-sm">
              <span className="font-mono text-slate-700">{t.name}</span>
              <span className="text-slate-500">{t.count} message(s)</span>
            </div>
          ))}
          {data.lastSentAt && (
            <p className="border-t border-slate-100 pt-2 text-xs text-slate-400">
              Last sent {formatDateTime(data.lastSentAt)}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent messages</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-2">Cadre</th>
                  <th className="px-5 py-2">Task</th>
                  <th className="px-5 py-2">Template</th>
                  <th className="px-5 py-2">Status</th>
                  <th className="px-5 py-2">Sent</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((m) => (
                  <tr key={m.id} className="border-b border-slate-50">
                    <td className="px-5 py-2">
                      <p className="text-slate-800">{m.cadreName}</p>
                      <p className="text-xs text-slate-400">{m.cadrePhone}</p>
                    </td>
                    <td className="px-5 py-2 text-slate-600">{m.taskName ?? "—"}</td>
                    <td className="px-5 py-2 font-mono text-xs text-slate-600">{m.templateName ?? "—"}</td>
                    <td className="px-5 py-2">
                      <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                      {m.failureReason && <p className="mt-1 text-xs text-red-600">{m.failureReason}</p>}
                    </td>
                    <td className="px-5 py-2 text-slate-500">{formatDateTime(m.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// ACTIVITY
// ============================================================

function ActivityTab({ campaignId }: { campaignId: string }) {
  const { data: events, isLoading, isError, error } = useCampaignActivity(campaignId, true);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {isError && <p className="text-sm text-red-600">{(error as Error)?.message}</p>}
        {isLoading && <p className="py-8 text-center text-sm text-slate-500">Loading activity…</p>}
        {!isLoading && !isError && (events?.length ?? 0) === 0 && (
          <p className="py-10 text-center text-sm text-slate-500">Nothing has happened on this campaign yet.</p>
        )}
        <ol className="space-y-0">
          {(events ?? []).map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex gap-3 border-l border-slate-200 pb-4 pl-4 last:pb-0">
              <div className="-ml-[21px] mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />
              <div className="min-w-0">
                <p className="text-xs text-slate-400">{formatDateTime(e.at)}</p>
                <p className="text-sm font-medium text-slate-800">{e.title}</p>
                {e.detail && <p className="text-xs text-slate-500">{e.detail}</p>}
                {e.actor && <p className="text-xs text-slate-400">by {e.actor}</p>}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

// ============================================================
// ATTACHMENTS
// ============================================================

function AttachmentsTab({ campaignId }: { campaignId: string }) {
  const { data: files, isLoading, isError, error } = useCampaignAttachments(campaignId, true);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Attachments <span className="font-normal text-slate-400">({files?.length ?? 0})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isError && <p className="px-5 py-4 text-sm text-red-600">{(error as Error)?.message}</p>}
        {isLoading && <p className="px-5 py-8 text-center text-sm text-slate-500">Loading attachments…</p>}
        {!isLoading && !isError && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-2">File</th>
                  <th className="px-5 py-2">Type</th>
                  <th className="px-5 py-2">From</th>
                  <th className="px-5 py-2">Uploaded by</th>
                  <th className="px-5 py-2">Uploaded</th>
                  <th className="px-5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(files ?? []).map((f) => (
                  <tr key={f.id} className="border-b border-slate-50">
                    <td className="max-w-[260px] truncate px-5 py-2 text-slate-800" title={f.name}>
                      📎 {f.name}
                    </td>
                    <td className="px-5 py-2 text-slate-600">{f.fileType}</td>
                    <td className="px-5 py-2 text-slate-600">{f.source}</td>
                    <td className="px-5 py-2 text-slate-600">{f.uploadedBy ?? "—"}</td>
                    <td className="px-5 py-2 text-slate-500">{f.uploadedAt ? formatDate(f.uploadedAt) : "—"}</td>
                    <td className="px-5 py-2 text-right">
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:underline">
                        View
                      </a>
                      <span className="px-2 text-slate-300">|</span>
                      <a href={f.url} download className="text-xs text-brand-600 hover:underline">
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
                {(files?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                      No files have been attached to this campaign or its tasks.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
