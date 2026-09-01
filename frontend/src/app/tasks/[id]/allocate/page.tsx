"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RegionMultiSelect, isRegionWithinScope } from "@/components/region-multi-select";
import { useTaskDetail, useAllocateTask } from "@/hooks/use-tasks";
import { useRegions } from "@/hooks/use-regions";

export default function AllocateTaskPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { data: task, isLoading } = useTaskDetail(id);
  const { data: regions } = useRegions();
  const allocate = useAllocateTask(id);

  const [districtIds, setDistrictIds] = useState<string[]>([]);
  const [mandalIds, setMandalIds] = useState<string[]>([]);
  const [boothIds, setBoothIds] = useState<string[]>([]);
  const [result, setResult] = useState<{ cadreCount: number } | null>(null);

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

  const regionIds = [...districtIds, ...mandalIds, ...boothIds];

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    allocate.mutate(regionIds, { onSuccess: (res) => setResult(res) });
  };

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Loading…</p>
      </AppShell>
    );
  }

  if (!task) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Task not found.</p>
      </AppShell>
    );
  }

  if (result) {
    return (
      <AppShell>
        <Card className="mx-auto max-w-lg">
          <CardContent className="py-8 text-center">
            <p className="text-lg font-semibold text-slate-900">Task allocated</p>
            <p className="mt-2 text-sm text-slate-600">
              "{task.name}" was assigned to <span className="font-semibold">{result.cadreCount}</span> Cadre
              {result.cadreCount === 1 ? "" : "s"} and sent via WhatsApp.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <Button onClick={() => router.push("/tasks")}>Go to Tasks</Button>
              <Button variant="secondary" onClick={() => router.push(`/tasks/${id}`)}>
                View Task Details
              </Button>
            </div>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6">
        <Link href={`/tasks/${id}`} className="text-xs text-brand-600 hover:underline">
          ← Back to Task Details
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-slate-900">Allocate "{task.name}" to Cadres</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose which of your District(s)/Mandal(s)/Booth(s) this task should go to. Every active Cadre in the
          selected area(s) will be notified via WhatsApp.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Select Area(s)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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

            {allocate.isError && (
              <p className="text-xs text-red-600">{(allocate.error as Error)?.message}</p>
            )}

            <Button type="submit" className="w-full" disabled={allocate.isPending || regionIds.length === 0}>
              {allocate.isPending ? "Allocating & sending via WhatsApp..." : "Allocate to Cadres"}
            </Button>
          </CardContent>
        </Card>
      </form>
    </AppShell>
  );
}
