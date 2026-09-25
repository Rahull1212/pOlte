import Link from "next/link";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { ProgressBar } from "./ui/progress";
import { Campaign } from "@/hooks/use-campaigns";
import { useCurrentUser } from "@/hooks/use-auth";

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
  const { data: user } = useCurrentUser();
  // An Admin needs to see at a glance which campaigns are waiting on their
  // accept/decline — the banner that asks for it lives one click away, and
  // without this the card gives no hint that anything is required of them.
  const myAssignment =
    user?.role === "ADMIN" ? campaign.assignedAdmins?.find((a) => a.adminId === user.id) : undefined;

  return (
    <Link href={`/campaigns/${campaign.id}`}>
      <Card className="p-4 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between">
          <h3 className="text-sm font-semibold text-slate-900">{campaign.name}</h3>
          <Badge tone={priorityTone[campaign.priority]}>{campaign.priority}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone={statusTone[campaign.status]}>{campaign.status}</Badge>
          {myAssignment?.status === "PENDING" && <Badge tone="amber">NEEDS YOUR RESPONSE</Badge>}
          {myAssignment?.status === "DECLINED" && <Badge tone="red">YOU DECLINED</Badge>}
        </div>
        <div className="mt-3">
          <ProgressBar value={progressPct} />
          <p className="mt-1 text-xs text-slate-500">{progressPct}% of target achieved</p>
        </div>
        {/* Only shown when the campaign actually declares these — most are
            planned by per-area allocation instead, and "Target: 0" would
            read as a campaign with nothing to do. */}
        {(campaign.totalTarget !== null || campaign.totalBudget !== null) && (
          <p className="mt-2 text-xs text-slate-500">
            {[
              campaign.totalTarget !== null ? `Target: ${campaign.totalTarget.toLocaleString()}` : null,
              campaign.totalBudget !== null
                ? `Budget: ₹${Number(campaign.totalBudget).toLocaleString()}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </Card>
    </Link>
  );
}
