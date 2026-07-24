"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TaskBoard } from "@/components/task-board";
import { useTasks } from "@/hooks/use-tasks";
import { useCampaign } from "@/hooks/use-campaigns";

export default function CampaignTasksPage() {
  const { id } = useParams<{ id: string }>();
  const { data: campaign } = useCampaign(id);
  const { data: tasks } = useTasks({ campaignId: id });

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Tasks</h1>
      <p className="mb-6 text-sm text-slate-500">{campaign?.name}</p>
      <TaskBoard tasks={tasks ?? []} />
    </AppShell>
  );
}
