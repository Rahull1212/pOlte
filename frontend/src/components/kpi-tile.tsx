import Link from "next/link";
import { Card } from "./ui/card";

interface KpiTileProps {
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
}

export function KpiTile({ label, value, sub, href }: KpiTileProps) {
  const content = (
    <Card className={`px-5 py-4 ${href ? "cursor-pointer transition hover:border-brand-300 hover:shadow-sm" : ""}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
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
