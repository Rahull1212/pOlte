"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { KpiTile } from "@/components/kpi-tile";
import { Badge } from "@/components/ui/badge";
import { useCampaign } from "@/hooks/use-campaigns";
import { useCampaignProgress } from "@/hooks/use-analytics";

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: campaign } = useCampaign(id);
  const { data: progress } = useCampaignProgress(id);

  if (!campaign) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Loading campaign...</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-900">{campaign.name}</h1>
        <Badge tone="blue">{campaign.priority}</Badge>
        <Badge tone="green">{campaign.status}</Badge>
      </div>
      <p className="mb-6 text-sm text-slate-600">{campaign.description}</p>

      <nav className="mb-6 flex gap-4 border-b border-slate-200 text-sm">
        <span className="border-b-2 border-brand-600 pb-2 font-medium text-brand-600">Overview</span>
        <Link href={`/campaigns/${id}/targets`} className="pb-2 text-slate-500 hover:text-slate-800">
          Targets
        </Link>
        <Link href={`/campaigns/${id}/tasks`} className="pb-2 text-slate-500 hover:text-slate-800">
          Tasks
        </Link>
        <Link href={`/campaigns/${id}/budget`} className="pb-2 text-slate-500 hover:text-slate-800">
          Budget
        </Link>
      </nav>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiTile label="Target Achievement" value={`${progress?.targetAchievementPct ?? 0}%`} />
        <KpiTile label="Budget Utilization" value={`${progress?.budgetUtilizationPct ?? 0}%`} />
        <KpiTile label="Completed Tasks" value={progress?.completedTasks ?? 0} sub={`of ${progress?.totalTasks ?? 0}`} />
        <KpiTile label="Overdue Tasks" value={progress?.overdueTasks ?? 0} />
      </div>
    </AppShell>
  );
}
