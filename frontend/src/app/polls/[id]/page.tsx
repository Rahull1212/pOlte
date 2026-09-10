"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { RegionMultiSelect, isRegionWithinScope } from "@/components/region-multi-select";
import { usePollDetail, useAllocatePoll } from "@/hooks/use-polls";
import { useManagedUsers } from "@/hooks/use-users";
import { useRegions } from "@/hooks/use-regions";

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
  const { data: regions } = useRegions();
  const { data: myCadres } = useManagedUsers("CADRE");
  const allocate = useAllocatePoll(id);

  const [districtIds, setDistrictIds] = useState<string[]>([]);
  const [mandalIds, setMandalIds] = useState<string[]>([]);
  const [boothIds, setBoothIds] = useState<string[]>([]);
  const [cadreIds, setCadreIds] = useState<string[]>([]);
  const [result, setResult] = useState<{ sentCount: number; failedCount: number } | null>(null);

  const byId = useMemo(() => new Map((regions ?? []).map((r) => [r.id, r])), [regions]);

  const handleDistrictChange = (ids: string[]) => {
    setDistrictIds(ids);
    const districtSet = new Set(ids);
    const nextMandalIds = mandalIds.filter((mid) => isRegionWithinScope(mid, districtSet, byId));
    setMandalIds(nextMandalIds);
    const mandalSet = new Set(nextMandalIds);
    setBoothIds((prev) => prev.filter((bid) => isRegionWithinScope(bid, mandalSet, byId)));
  };

  const handleMandalChange = (ids: string[]) => {
    setMandalIds(ids);
    const mandalSet = new Set(ids);
    setBoothIds((prev) => prev.filter((bid) => isRegionWithinScope(bid, mandalSet, byId)));
  };

  const toggleCadre = (cadreId: string) => {
    setCadreIds((prev) => (prev.includes(cadreId) ? prev.filter((c) => c !== cadreId) : [...prev, cadreId]));
  };

  const regionIds = [...districtIds, ...mandalIds, ...boothIds];

  const onSubmitAllocate = (e: React.FormEvent) => {
    e.preventDefault();
    allocate.mutate({ regionIds, cadreIds }, { onSuccess: (res) => setResult(res) });
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
                  Choose an area (every active Cadre there gets it) and/or hand-pick specific Cadres. Either way,
                  selected Cadres are sent this poll via WhatsApp.
                </p>
                <form onSubmit={onSubmitAllocate} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <Label>Select District(s)</Label>
                      <RegionMultiSelect type="DISTRICT" selected={districtIds} onChange={handleDistrictChange} label="districts" />
                    </div>
                    <div>
                      <Label>Select Mandal(s) — optional</Label>
                      <RegionMultiSelect
                        type="MANDAL"
                        selected={mandalIds}
                        onChange={handleMandalChange}
                        label="mandals"
                        scopeIds={districtIds}
                        scopeLabel="a district"
                      />
                    </div>
                    <div>
                      <Label>Select Village / Booth — optional</Label>
                      <RegionMultiSelect
                        type="BOOTH"
                        selected={boothIds}
                        onChange={setBoothIds}
                        label="booths"
                        scopeIds={mandalIds}
                        scopeLabel="a mandal"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    {regionIds.length} area{regionIds.length === 1 ? "" : "s"} selected so far.
                  </p>

                  {myCadres && myCadres.length > 0 && (
                    <div>
                      <Label>Or hand-pick specific Cadres — optional</Label>
                      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-300 p-2">
                        {myCadres.map((c) => (
                          <label key={c.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={cadreIds.includes(c.id)}
                              onChange={() => toggleCadre(c.id)}
                              className="h-4 w-4 rounded border-slate-300"
                            />
                            <span className="text-slate-800">{c.name}</span>
                            {c.region && <span className="text-xs text-slate-400">{c.region.name} ({c.region.type})</span>}
                          </label>
                        ))}
                      </div>
                      {cadreIds.length > 0 && <p className="mt-1 text-xs text-slate-500">{cadreIds.length} Cadre(s) selected.</p>}
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
                    disabled={allocate.isPending || (regionIds.length === 0 && cadreIds.length === 0)}
                  >
                    {allocate.isPending ? "Sending…" : "Allocate & Send"}
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
