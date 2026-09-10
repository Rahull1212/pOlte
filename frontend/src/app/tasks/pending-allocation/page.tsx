"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePendingAllocationTasks } from "@/hooks/use-tasks";

const priorityTone: Record<string, "slate" | "blue" | "amber" | "red"> = {
  LOW: "slate",
  MEDIUM: "blue",
  HIGH: "amber",
  URGENT: "red",
};

export default function PendingAllocationPage() {
  const { data: tasks, isLoading } = usePendingAllocationTasks();

  return (
    <AppShell>
      <div className="mb-6">
        <Link href="/tasks" className="text-xs text-brand-600 hover:underline">
          ← Back to Tasks
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-slate-900">Tasks Pending Your Allocation</h1>
        <p className="mt-1 text-sm text-slate-500">
          These tasks — whether created by you or routed here by a Super Admin — haven't been sent to any Cadres
          yet. Review each one and allocate it to your Cadres; it's sent via WhatsApp only once you allocate it.
        </p>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {!isLoading && tasks?.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-500">
            Nothing pending — you're all caught up.
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {tasks?.map((t) => (
          <Card key={t.id}>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>{t.name}</CardTitle>
              <Badge tone={priorityTone[t.priority]}>{t.priority}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {t.objective && <p className="text-sm text-slate-700">{t.objective}</p>}
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs font-medium uppercase text-slate-400">Area</p>
                  <p className="text-slate-700">{t.districts.join(", ") || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-slate-400">Deadline</p>
                  <p className="text-slate-700">{new Date(t.deadline).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-slate-400">Routed By</p>
                  <p className="text-slate-700">{t.createdByName}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-slate-400">Created</p>
                  <p className="text-slate-700">{new Date(t.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Link href={`/tasks/${t.id}`}>
                  <Button variant="secondary">View Details</Button>
                </Link>
                <Link href={`/tasks/${t.id}/allocate`}>
                  <Button>Allocate to Cadres</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
