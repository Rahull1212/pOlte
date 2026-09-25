import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { CommunicationStats } from "@/hooks/use-analytics";

/**
 * WhatsApp delivery at a glance, on both the Global and the Task dashboard.
 *
 * One component for both so the two can't drift into showing the same facts
 * differently — the numbers already come from one source (the Message Log),
 * and this keeps the reading of them single too.
 */
export function CommunicationCard({
  stats,
  title = "WhatsApp Communication",
  unit = "messages",
  href,
}: {
  stats: CommunicationStats;
  title?: string;
  /** What `total` counts — "messages" globally, "cadres" on one task. */
  unit?: string;
  /** Where "View all" goes; omitted when there's nowhere more detailed. */
  href?: string;
}) {
  if (stats.total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-center text-sm text-slate-500">Nothing sent yet.</p>
        </CardContent>
      </Card>
    );
  }

  // Stages, not slices: every read message was also delivered and sent, so
  // the bars are nested widths of the same total rather than a stacked split.
  const bars = [
    { label: "Sent", value: stats.sent, className: "bg-slate-400" },
    { label: "Delivered", value: stats.delivered, className: "bg-blue-500" },
    { label: "Read", value: stats.read, className: "bg-emerald-500" },
    { label: "Failed", value: stats.failed, className: "bg-red-500" },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {href && (
          <Link href={href} className="text-xs font-medium text-brand-600 hover:underline">
            View log
          </Link>
        )}
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Sent" value={stats.sent} />
          <Stat label="Delivered" value={stats.delivered} tone="text-blue-700" sub={`${stats.deliveryRatePct}%`} />
          <Stat label="Read" value={stats.read} tone="text-emerald-700" sub={`${stats.readRatePct}%`} />
          <Stat label="Failed" value={stats.failed} tone="text-red-600" sub={`${stats.failureRatePct}%`} />
        </div>

        <div className="space-y-2">
          {bars.map((bar) => (
            <div key={bar.label} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs text-slate-500">{bar.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${bar.className}`}
                  style={{ width: `${stats.total > 0 ? (bar.value / stats.total) * 100 : 0}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-600">{bar.value}</span>
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-slate-400">
          Out of {stats.total} {unit}. Delivered and Read are stages of the same message, so they overlap rather than
          add up.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub, tone = "text-slate-900" }: { label: string; value: number; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
