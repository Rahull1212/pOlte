import { AuditEntry } from "@/hooks/use-audit";

const VERB_BY_METHOD: Record<string, string> = {
  POST: "created",
  PATCH: "updated",
  PUT: "updated",
  DELETE: "removed",
};

function describe(entry: AuditEntry): string {
  const method = entry.action.split(" ")[0];
  const verb = VERB_BY_METHOD[method] ?? "acted on";
  const entityLabel = entry.entityType.replace(/-/g, " ");
  return `${entry.userName} ${verb} ${entityLabel}`;
}

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ActivityFeed({ entries, isLoading }: { entries?: AuditEntry[]; isLoading?: boolean }) {
  if (isLoading) return <p className="text-sm text-slate-400">Loading activity...</p>;
  if (!entries || entries.length === 0) {
    return <p className="py-4 text-center text-sm text-slate-400">No recent activity yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-start gap-3 text-sm">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
          <div>
            <p className="text-slate-700">{describe(entry)}</p>
            <p className="text-xs text-slate-400">{timeAgo(entry.createdAt)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
