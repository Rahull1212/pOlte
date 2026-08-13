import Link from "next/link";
import { Card } from "./ui/card";

type Tone = "default" | "good" | "warning";

const valueTone: Record<Tone, string> = {
  default: "text-slate-900",
  good: "text-emerald-600",
  warning: "text-amber-600",
};

interface KpiTileProps {
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
  tone?: Tone;
}

export function KpiTile({ label, value, sub, href, tone = "default" }: KpiTileProps) {
  const content = (
    <Card className={`px-5 py-4 ${href ? "cursor-pointer transition hover:border-brand-300 hover:shadow-sm" : ""}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueTone[tone]}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </Card>
  );

  if (!href) return content;
  return (
    <Link href={href} className="block">
      {content}
    </Link>
  );
}
