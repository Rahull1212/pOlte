/**
 * Formatting and tone helpers shared by the Campaign Details page and its
 * task drawer, so a status badge means the same colour in both.
 */

type Tone = "slate" | "green" | "amber" | "red" | "blue";

/** Status colours match the rest of PoliOS: green done, red bad, amber waiting. */
export function statusTone(status: string): Tone {
  switch (status) {
    case "COMPLETED":
    case "DELIVERED":
    case "READ":
    case "ACTIVE":
      return "green";
    case "OVERDUE":
    case "FAILED":
    case "CANCELLED":
    case "DECLINED":
      return "red";
    case "IN_PROGRESS":
    case "SENT":
    case "UPCOMING":
      return "blue";
    case "PENDING":
    case "AWAITING_ALLOCATION":
    case "AWAITING":
    case "DRAFT":
      return "amber";
    default:
      return "slate";
  }
}

export function priorityTone(priority: string): Tone {
  switch (priority) {
    case "URGENT":
    case "CRITICAL":
      return "red";
    case "HIGH":
      return "amber";
    case "MEDIUM":
      return "blue";
    default:
      return "slate";
  }
}

/** "IN_PROGRESS" -> "In progress". */
export function humanise(value: string): string {
  const spaced = value.replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-IN");
}

export function formatMoney(value: number): string {
  return `₹${value.toLocaleString("en-IN")}`;
}

/**
 * A progress bar. `disabled` greys it out for the case where a percentage
 * is technically 0 but meaningless — no targets allocated, no tasks yet —
 * so an empty bar doesn't read as "0% achieved" when it means "nothing to
 * measure against".
 */
export function ProgressBar({
  pct,
  compact = false,
  disabled = false,
}: {
  pct: number;
  compact?: boolean;
  disabled?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className={`${compact ? "h-1.5 w-20" : "mt-2 h-2.5 w-full"} overflow-hidden rounded-full bg-slate-100`}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-all ${disabled ? "bg-slate-200" : "bg-brand-600"}`}
        style={{ width: `${disabled ? 0 : clamped}%` }}
      />
    </div>
  );
}
