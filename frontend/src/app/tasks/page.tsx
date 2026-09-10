"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrentUser } from "@/hooks/use-auth";
import { useTaskList, usePendingAllocationTasks, TaskSummaryStatus } from "@/hooks/use-tasks";
import { TaskPriority } from "@/lib/shared-types";

const STATUS_OPTIONS: TaskSummaryStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "OVERDUE",
  "NEEDS_ATTENTION",
  "AWAITING_ALLOCATION",
  "CANCELLED",
];

const statusTone: Record<TaskSummaryStatus, "slate" | "blue" | "green" | "red" | "amber"> = {
  PENDING: "slate",
  IN_PROGRESS: "blue",
  COMPLETED: "green",
  OVERDUE: "red",
  NEEDS_ATTENTION: "amber",
  AWAITING_ALLOCATION: "amber",
  CANCELLED: "slate",
};

const statusLabel: Record<TaskSummaryStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  OVERDUE: "Overdue",
  NEEDS_ATTENTION: "Needs Attention",
  AWAITING_ALLOCATION: "Awaiting Allocation",
  CANCELLED: "Everyone Removed",
};

const priorityTone: Record<TaskPriority, "slate" | "blue" | "amber" | "red"> = {
  LOW: "slate",
  MEDIUM: "blue",
  HIGH: "amber",
  URGENT: "red",
};

export default function TasksPage() {
  const { data: user } = useCurrentUser();
  const { data: tasks, isLoading } = useTaskList();
  const { data: pendingAllocation } = usePendingAllocationTasks(user?.role === "ADMIN");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskSummaryStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "">("");
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) setCreateMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filtered = useMemo(() => {
    return (tasks ?? []).filter((t) => {
      if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      return true;
    });
  }, [tasks, search, statusFilter, priorityFilter]);

  if (user && user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Only Super Admins and Admins can view Tasks.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Tasks</h1>
        <div className="flex gap-2">
          <Link href="/tasks/analytics">
            <Button variant="secondary">📊 Communication & AI Insights</Button>
          </Link>
          <div className="relative" ref={createMenuRef}>
            <Button onClick={() => setCreateMenuOpen((v) => !v)}>+ Create ▾</Button>
            {createMenuOpen && (
              <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                <Link
                  href="/tasks/new"
                  onClick={() => setCreateMenuOpen(false)}
                  className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Create Task
                </Link>
                <Link
                  href="/polls/new"
                  onClick={() => setCreateMenuOpen(false)}
                  className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Create Poll
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {user?.role === "ADMIN" && pendingAllocation && pendingAllocation.length > 0 && (
        <Link
          href="/tasks/pending-allocation"
          className="mb-4 flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 hover:bg-amber-100"
        >
          <span>
            <span className="font-semibold">{pendingAllocation.length}</span> task
            {pendingAllocation.length === 1 ? "" : "s"} pending your allocation to Cadres
          </span>
          <span className="font-medium">Review &amp; Allocate →</span>
        </Link>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <select
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TaskSummaryStatus | "")}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {statusLabel[s]}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | "")}
        >
          <option value="">All priorities</option>
          {TaskPriority.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0) + p.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            All Tasks <span className="font-normal text-slate-400">({filtered.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-2">Task Name</th>
                <th className="px-5 py-2">District / Location</th>
                <th className="px-5 py-2">Assigned Members</th>
                <th className="px-5 py-2">Deadline</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2">Progress</th>
                <th className="px-5 py-2">Created</th>
                <th className="px-5 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-b border-slate-50">
                  <td className="px-5 py-2 font-medium text-slate-800">
                    {t.name}
                    <div className="mt-0.5">
                      <Badge tone={priorityTone[t.priority]}>{t.priority}</Badge>
                    </div>
                  </td>
                  <td className="px-5 py-2 text-slate-600">
                    {t.districts.length > 0 ? t.districts.join(", ") : "—"}
                  </td>
                  <td className="px-5 py-2 text-slate-600">
                    {t.assignedCount} cadre{t.assignedCount === 1 ? "" : "s"}
                    {t.assignedCount <= 3 && (
                      <p className="text-xs text-slate-400">{t.assignedNames.join(", ")}</p>
                    )}
                  </td>
                  <td className="px-5 py-2 text-slate-500">{new Date(t.deadline).toLocaleDateString()}</td>
                  <td className="px-5 py-2">
                    <Badge tone={statusTone[t.status]}>{statusLabel[t.status]}</Badge>
                  </td>
                  <td className="px-5 py-2 text-slate-600">{t.progressPct}%</td>
                  <td className="px-5 py-2 text-slate-500">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-2 text-right">
                    <Link href={`/tasks/${t.id}`}>
                      <Button variant="secondary">View Details</Button>
                    </Link>
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-slate-500">
                    {tasks?.length === 0 ? "No tasks created yet." : "No tasks match your filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
