import Link from "next/link";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { ProgressBar } from "./ui/progress";
import { Campaign } from "@/hooks/use-campaigns";

const statusTone: Record<string, "slate" | "green" | "amber" | "blue"> = {
  DRAFT: "slate",
  UPCOMING: "blue",
  ACTIVE: "green",
  COMPLETED: "slate",
  CANCELLED: "slate",
};

const priorityTone: Record<string, "slate" | "amber" | "red" | "blue"> = {
  LOW: "slate",
  MEDIUM: "blue",
  HIGH: "amber",
  CRITICAL: "red",
};

export function CampaignCard({ campaign, progressPct = 0 }: { campaign: Campaign; progressPct?: number }) {
  return (
    <Link href={`/campaigns/${campaign.id}`}>
      <Card className="p-4 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between">
          <h3 className="text-sm font-semibold text-slate-900">{campaign.name}</h3>
          <Badge tone={priorityTone[campaign.priority]}>{campaign.priority}</Badge>
        </div>
        <Badge tone={statusTone[campaign.status]} className="mt-2">
          {campaign.status}
        </Badge>
        <div className="mt-3">
          <ProgressBar value={progressPct} />
          <p className="mt-1 text-xs text-slate-500">{progressPct}% of target achieved</p>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Target: {campaign.totalTarget.toLocaleString()} · Budget: ₹{Number(campaign.totalBudget).toLocaleString()}
        </p>
      </Card>
    </Link>
  );
}
