"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { usePollDetail, useAllocatePoll } from "@/hooks/use-polls";
import { useManagedUsers } from "@/hooks/use-users";

const statusTone: Record<string, "slate" | "blue" | "green" | "red"> = {
  PENDING: "slate",
  SENT: "blue",
  FAILED: "red",
  ANSWERED: "green",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{value || <span className="text-slate-400">—</span>}</p>
    </div>
  );
}

export default function PollDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: poll, isLoading } = usePollDetail(id);
  const { data: myCadres } = useManagedUsers("CADRE");
  const allocate = useAllocatePoll(id);

  const [cadreIds, setCadreIds] = useState<string[]>([]);
  const [result, setResult] = useState<{ sentCount: number; failedCount: number } | null>(null);

  // Only the Cadres this Admin manages — the API returns their own people, so
  // there is nothing here to narrow by area.
  const cadres = useMemo(() => (myCadres ?? []).filter((c) => c.isActive), [myCadres]);
  const allSelected = cadres.length > 0 && cadreIds.length === cadres.length;

  const toggleCadre = (cadreId: string) => {
    setCadreIds((prev) => (prev.includes(cadreId) ? prev.filter((c) => c !== cadreId) : [...prev, cadreId]));
  };

  const onSubmitAllocate = (e: React.FormEvent) => {
    e.preventDefault();
    // Cadres only. Area targeting is gone: an Admin sends to their own
    // people, and asking them to first pick a District — one they often
    // cannot even see, since an Admin scoped to a Constituency has no
    // districts in scope — was a step that could only go wrong.
    allocate.mutate({ regionIds: [], cadreIds }, { onSuccess: (res) => setResult(res) });
  };

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Loading poll…</p>
      </AppShell>
    );
  }

  if (!poll) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Poll not found.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link href="/polls" className="text-xs text-brand-600 hover:underline">
            ← Back to Polls
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">{poll.question}</h1>
          <div className="mt-2 flex items-center gap-2">
            <Badge tone={poll.awaitingAllocation ? "amber" : "green"}>
              {poll.awaitingAllocation ? "Awaiting Allocation" : "Sent"}
            </Badge>
          </div>
        </div>
        {!poll.awaitingAllocation && (
          <Link href={`/polls/${id}/dashboard`}>
            <Button variant="secondary">📊 View Dashboard</Button>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Poll Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Options" value={poll.options.join(", ")} />
              <Field label="Area" value={poll.districts.join(", ")} />
              <Field label="Created By" value={poll.createdByName} />
              <Field label="Deadline" value={poll.deadline ? new Date(poll.deadline).toLocaleString() : "—"} />
            </CardContent>
          </Card>

          {poll.awaitingAllocation ? (
            <Card>
              <CardHeader>
                <CardTitle>Allocate to Cadres</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-slate-500">
                  Pick who gets this poll. Every Cadre you select is sent it on WhatsApp straight away.
                </p>
                <form onSubmit={onSubmitAllocate} className="space-y-4">
                  {cadres.length === 0 ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      You have no active Cadres to send this to yet.
                    </p>
                  ) : (
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label>Your Cadres</Label>
                        <button
                          type="button"
                          onClick={() => setCadreIds(allSelected ? [] : cadres.map((c) => c.id))}
                          className="text-xs font-medium text-brand-600 hover:underline"
                        >
                          {allSelected ? "Clear all" : `Select all ${cadres.length}`}
                        </button>
                      </div>
                      <div className="mt-1 max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-300 p-2">
                        {cadres.map((c) => (
                          <label
                            key={c.id}
                            className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={cadreIds.includes(c.id)}
                              onChange={() => toggleCadre(c.id)}
                              className="h-4 w-4 rounded border-slate-300"
                            />
                            <span className="text-slate-800">{c.name}</span>
                            {c.region && (
                              <span className="text-xs text-slate-400">
                                {c.region.name} ({c.region.type})
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {cadreIds.length} of {cadres.length} selected.
                      </p>
                    </div>
                  )}

                  {allocate.isError && <p className="text-xs text-red-600">{(allocate.error as Error)?.message}</p>}
                  {result && (
                    <p className="text-xs text-emerald-700">
                      Sent to {result.sentCount} Cadre{result.sentCount === 1 ? "" : "s"}
                      {result.failedCount > 0 ? `, ${result.failedCount} failed` : ""}. See the Dashboard for results
                      as they come in.
                    </p>
                  )}

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={allocate.isPending || cadreIds.length === 0}
                  >
                    {allocate.isPending
                      ? "Sending…"
                      : `Send to ${cadreIds.length || "…"} Cadre${cadreIds.length === 1 ? "" : "s"}`}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Recipients ({poll.recipients.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-2">Cadre</th>
                      <th className="px-5 py-2">Area</th>
                      <th className="px-5 py-2">WhatsApp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poll.recipients.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50">
                        <td className="px-5 py-2 text-slate-800">{r.cadreName}</td>
                        <td className="px-5 py-2 text-slate-600">{r.area}</td>
                        <td className="px-5 py-2">
                          <Badge tone={statusTone[r.status]}>{r.status}</Badge>
                        </td>
                      </tr>
                    ))}
                    {poll.recipients.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-5 py-6 text-center text-slate-400">
                          No recipients.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
