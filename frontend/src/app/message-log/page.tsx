"use client";

import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  useMessageLog,
  useMessageLogSummary,
  useResendMessage,
  downloadMessageLogCsv,
  MessageLogFilters,
  MessageLogRow,
} from "@/hooks/use-message-log";

const KIND_LABELS: Record<string, string> = {
  ASSIGNMENT: "Task assigned",
  RETRY: "Retry",
  COMPLETION_CHECK: "Completion check",
  NOTIFICATION: "Notification",
};

const selectClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

// Which KPI card is selected. "all" is the unfiltered log; the other two set
// the table's status filter. Kept as a view rather than a raw status string
// because each view also decides which COLUMNS are worth showing.
type View = "all" | "sent" | "failed";

// SENT is only the provider's acceptance — DELIVERED and READ are later
// stages of the same success, so the Sent view shows all three.
const SENT_STATUSES = ["SENT", "DELIVERED", "READ"];

function statusTone(status: string): "green" | "red" | "blue" {
  if (status === "DELIVERED" || status === "READ") return "green";
  if (status === "FAILED") return "red";
  return "blue";
}

/** A KPI card that doubles as the table's filter. */
function KpiCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number | undefined;
  tone: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border bg-white p-4 text-left shadow-sm transition ${
        active ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value ?? "—"}</p>
      <p className="mt-1 text-xs text-slate-400">{active ? "Showing these — click to clear" : "Click to filter"}</p>
    </button>
  );
}

/**
 * Every task WhatsApp message PoliOS has sent, straight from the database.
 * Delivery states arrive later on Fyxo's message.sent/delivered/read/failed
 * webhooks, which is why a row can start at SENT and change afterwards.
 *
 * The KPI cards are the primary filter: each one narrows the table to its own
 * rows and shows only the columns that matter for that view. Their counts come
 * from the same query the table does (minus the status filter), so they always
 * agree with what clicking them produces.
 *
 * Scoping is enforced server-side: an Admin sees only their own sends, a
 * Super Admin sees everything.
 */
export default function MessageLogPage() {
  const [view, setView] = useState<View>("all");
  const [baseFilters, setBaseFilters] = useState<MessageLogFilters>({});
  // This page owns its own Search field (below the KPI cards) rather than
  // using the header one — it filters server-side on Apply, not per
  // keystroke, so it needs its own submit.
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // The status filter is derived from the selected card rather than stored,
  // so the two can never drift apart.
  const filters: MessageLogFilters = {
    ...baseFilters,
    ...(view === "failed" ? { status: "FAILED" } : {}),
  };

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useMessageLog(filters);
  const { data: summary } = useMessageLogSummary(baseFilters);
  const resend = useResendMessage();

  const allRows = data?.pages.flatMap((p) => p.rows) ?? [];
  // "Sent" spans three statuses, which the single-value status filter can't
  // express, so that one is narrowed here instead of server-side.
  const rows = view === "sent" ? allRows.filter((r) => SENT_STATUSES.includes(r.status)) : allRows;

  const toggle = (next: View) => setView((current) => (current === next ? "all" : next));

  const applySearch = (e: React.FormEvent) => {
    e.preventDefault();
    setBaseFilters((f) => ({ ...f, search: search.trim() || undefined }));
  };

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadMessageLogCsv(filters);
    } catch (err) {
      setExportError((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Message Log</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every task message PoliOS has sent to a Cadre — what was sent, to whom, by whom, and whether it landed.
            &quot;Sent&quot; means the provider accepted it; it becomes Delivered, Read or Failed once WhatsApp reports
            back. A failed row shows the provider&apos;s own reason and can be resent.
          </p>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={exporting}>
          {exporting ? "Preparing…" : "Download CSV"}
        </Button>
      </div>

      {exportError && <p className="mb-4 text-sm text-red-600">{exportError}</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Total messages"
          value={summary?.total}
          tone="text-slate-900"
          active={view === "all"}
          onClick={() => setView("all")}
        />
        <KpiCard
          label="Sent"
          value={summary?.sent}
          tone="text-emerald-700"
          active={view === "sent"}
          onClick={() => toggle("sent")}
        />
        <KpiCard
          label="Failed"
          value={summary?.failed}
          tone="text-red-600"
          active={view === "failed"}
          onClick={() => toggle("failed")}
        />
      </div>

      <Card className="mb-4">
        <CardContent className="py-4">
          <form onSubmit={applySearch} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <Label htmlFor="log-search">Search</Label>
              <Input
                id="log-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cadre, number, task or Admin"
              />
            </div>
            <div>
              <Label htmlFor="log-kind">Type</Label>
              <select
                id="log-kind"
                className={selectClass}
                value={baseFilters.kind ?? ""}
                onChange={(e) => setBaseFilters((f) => ({ ...f, kind: e.target.value || undefined }))}
              >
                <option value="">All</option>
                {Object.entries(KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="submit">Apply</Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setBaseFilters({});
                  setView("all");
                }}
              >
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {resend.data && (
        <p className={`mb-4 text-sm ${resend.data.success ? "text-emerald-700" : "text-red-600"}`}>
          {resend.data.success
            ? `Resent to ${resend.data.row.cadreName}.`
            : `Resend failed: ${resend.data.error ?? "unknown error"}`}
        </p>
      )}
      {resend.error && <p className="mb-4 text-sm text-red-600">{(resend.error as Error).message}</p>}

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {!isLoading && rows.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-500">
            {view === "failed"
              ? "No failed messages — everything the provider accepted is still accepted."
              : view === "sent"
                ? "No sent messages yet."
                : "No messages logged yet. Rows appear here the moment a task is allocated to Cadres."}
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          {/* Wide table scrolls inside its own container so the page itself
              never scrolls sideways. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Cadre</th>
                  <th className="px-4 py-2 font-medium">Number</th>
                  {view === "all" && (
                    <>
                      <th className="px-4 py-2 font-medium">Message</th>
                      <th className="px-4 py-2 font-medium">Task</th>
                      <th className="px-4 py-2 font-medium">Assigned by</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                    </>
                  )}
                  <th className="px-4 py-2 font-medium">Status</th>
                  {view === "failed" && <th className="px-4 py-2 font-medium">Reason</th>}
                  <th className="px-4 py-2 font-medium">{view === "failed" ? "Attempted" : "Sent"}</th>
                  {view === "failed" && <th className="px-4 py-2 font-medium">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <Row key={r.id} row={r} view={view} onResend={() => resend.mutate(r.id)} resending={resend.isPending} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </AppShell>
  );
}

function Row({
  row,
  view,
  onResend,
  resending,
}: {
  row: MessageLogRow;
  view: View;
  onResend: () => void;
  resending: boolean;
}) {
  return (
    <tr className="align-top">
      <td className="px-4 py-2 text-slate-800">{row.cadreName}</td>
      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{row.cadrePhone}</td>
      {view === "all" && (
        <>
          <td className="max-w-md px-4 py-2 text-slate-700">{row.message}</td>
          <td className="px-4 py-2 text-slate-700">{row.taskName ?? "—"}</td>
          <td className="px-4 py-2 text-slate-700">{row.assignedByName ?? "—"}</td>
          <td className="whitespace-nowrap px-4 py-2 text-slate-600">{KIND_LABELS[row.kind] ?? row.kind}</td>
        </>
      )}
      <td className="px-4 py-2">
        <Badge tone={statusTone(row.status)}>{row.status}</Badge>
        {/* Shown in every view: a row that needed retrying is worth knowing
            about even once it finally succeeded. */}
        {row.retryCount > 0 && (
          <p className="mt-1 text-xs text-slate-400">
            {row.retryCount} retr{row.retryCount === 1 ? "y" : "ies"}
          </p>
        )}
      </td>
      {view === "failed" && (
        <td className="max-w-sm px-4 py-2 text-xs text-red-600">{row.failureReason ?? "No reason reported"}</td>
      )}
      <td className="whitespace-nowrap px-4 py-2 text-slate-500">
        {new Date(row.lastRetryAt ?? row.sentAt).toLocaleString()}
      </td>
      {view === "failed" && (
        <td className="px-4 py-2">
          <Button variant="secondary" onClick={onResend} disabled={resending}>
            {resending ? "Sending…" : "Resend"}
          </Button>
        </td>
      )}
    </tr>
  );
}
