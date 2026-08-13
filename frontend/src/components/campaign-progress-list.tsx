import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import { CampaignWithProgress } from "@/hooks/use-analytics";

const STATUS_TONE: Record<string, "green" | "blue" | "slate" | "amber" | "red"> = {
  ACTIVE: "green",
  UPCOMING: "blue",
  DRAFT: "slate",
  COMPLETED: "slate",
  CANCELLED: "red",
};

export function CampaignProgressList({ campaigns }: { campaigns?: CampaignWithProgress[] }) {
  if (!campaigns || campaigns.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">No active campaigns in scope.</p>;
  }

  return (
    <ul className="space-y-4">
      {campaigns.map((c) => (
        <li key={c.id}>
          <Link href={`/campaigns/${c.id}`} className="block">
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="truncate text-sm font-medium text-slate-800 hover:text-brand-700">{c.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={STATUS_TONE[c.status] ?? "slate"}>{c.status}</Badge>
                <span className="text-xs font-medium text-slate-500">{c.progressPct}%</span>
              </span>
            </div>
            <ProgressBar value={c.progressPct} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
