"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { isRegionWithinScope } from "@/components/region-multi-select";
import { useTaskDetail, useAllocateTask, AllocationResult } from "@/hooks/use-tasks";
import { useRegions } from "@/hooks/use-regions";
import { useManagedUsers, ManagedUser } from "@/hooks/use-users";
import { useCurrentUser } from "@/hooks/use-auth";

export default function AllocateTaskPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const { data: currentUser } = useCurrentUser();
  const { data: task, isLoading: taskLoading } = useTaskDetail(id);
  const { data: regions, isLoading: regionsLoading } = useRegions();
  const { data: myCadres, isLoading: cadresLoading } = useManagedUsers("CADRE");
  const allocate = useAllocateTask(id);

  const [district, setDistrict] = useState("");
  const [mandal, setMandal] = useState("");
  const [search, setSearch] = useState("");
  const [selectedCadreIds, setSelectedCadreIds] = useState<string[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<AllocationResult | null>(null);

  const byId = useMemo(() => new Map((regions ?? []).map((r) => [r.id, r])), [regions]);
  const myRegion = currentUser ? byId.get(currentUser.regionId) : undefined;

  // District dropdown, scoped to the Admin's own authorized area: /regions
  // already returns only their own subtree, so any District here IS their
  // own (or the one District their scope contains).
  const districts = useMemo(() => (regions ?? []).filter((r) => r.type === "DISTRICT"), [regions]);
  const defaultDistrictId = useMemo(() => {
    if (myRegion?.type === "DISTRICT") return myRegion.id;
    return districts[0]?.id ?? "";
  }, [myRegion, districts]);
  const effectiveDistrict = district || defaultDistrictId;

  const mandalsAll = useMemo(() => (regions ?? []).filter((r) => r.type === "MANDAL"), [regions]);
  const mandals = useMemo(() => {
    if (effectiveDistrict) {
      return mandalsAll.filter((m) => isRegionWithinScope(m.id, new Set([effectiveDistrict]), byId));
    }
    // No District exists in this Admin's own scope (they're Mandal/Booth-level) — whatever Mandal(s) they have is all there is.
    return mandalsAll;
  }, [mandalsAll, effectiveDistrict, byId]);
  const defaultMandalId = useMemo(() => {
    if (myRegion?.type === "MANDAL") return myRegion.id;
    if (mandals.length === 1) return mandals[0].id;
    return "";
  }, [myRegion, mandals]);
  const effectiveMandal = mandal || defaultMandalId;

  const isBoothLevelAdmin = myRegion?.type === "BOOTH";

  const alreadyAssignedIds = useMemo(() => new Set((task?.assignedMembers ?? []).map((m) => m.id)), [task]);

  const cadresInScope = useMemo(() => {
    const activeCadres = (myCadres ?? []).filter((c) => c.isActive);
    if (effectiveMandal) {
      return activeCadres.filter((c) => isRegionWithinScope(c.regionId, new Set([effectiveMandal]), byId));
    }
    if (isBoothLevelAdmin) return activeCadres; // already fully scoped to their one Booth
    return [];
  }, [myCadres, effectiveMandal, byId, isBoothLevelAdmin]);

  const filteredCadres = useMemo(() => {
    if (!search.trim()) return cadresInScope;
    const q = search.toLowerCase();
    return cadresInScope.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  }, [cadresInScope, search]);

  const selectedCadres = useMemo(
    () => (myCadres ?? []).filter((c) => selectedCadreIds.includes(c.id)),
    [myCadres, selectedCadreIds],
  );

  const handleDistrictChange = (value: string) => {
    setDistrict(value);
    setMandal("");
  };

  const toggleCadre = (cadreId: string) => {
    setSelectedCadreIds((prev) => (prev.includes(cadreId) ? prev.filter((c) => c !== cadreId) : [...prev, cadreId]));
  };

  const selectAllVisible = () => {
    setSelectedCadreIds((prev) => Array.from(new Set([...prev, ...filteredCadres.map((c) => c.id)])));
  };

  const clearSelection = () => setSelectedCadreIds([]);

  const onConfirmSend = () => {
    allocate.mutate(
      { regionIds: [], cadreIds: selectedCadreIds },
      {
        onSuccess: (res) => {
          setShowConfirm(false);
          setResult(res);
        },
        onError: () => setShowConfirm(false),
      },
    );
  };

  if (taskLoading) {
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

  if (!task.awaitingAllocation && !result) {
    return (
      <AppShell>
        <Card className="mx-auto max-w-lg">
          <CardContent className="py-8 text-center">
            <p className="text-lg font-semibold text-slate-900">Nothing left to allocate</p>
            <p className="mt-2 text-sm text-slate-600">
              This task doesn't have any unallocated Cadres left in your area right now.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <Button onClick={() => router.push(`/tasks/${id}`)}>Back to Task Details</Button>
            </div>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (result) {
    const successCount = result.cadreCount - result.whatsappFailedCount;
    return (
      <AppShell>
        <Card className="mx-auto max-w-lg">
          <CardContent className="py-8 text-center">
            <p className="text-lg font-semibold text-slate-900">
              {result.whatsappFailedCount > 0 ? "Task allocated — some messages failed" : "Task allocated"}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {result.whatsappFailedCount === 0 ? (
                <>
                  Task successfully allocated to <span className="font-semibold">{result.cadreCount}</span> Cadre
                  {result.cadreCount === 1 ? "" : "s"} and WhatsApp notifications have been sent.
                </>
              ) : (
                <>
                  Allocated to {result.cadreCount} Cadre{result.cadreCount === 1 ? "" : "s"} — {successCount} WhatsApp
                  message{successCount === 1 ? "" : "s"} sent, but{" "}
                  <span className="font-semibold text-red-600">{result.whatsappFailedCount}</span> failed to send.
                  The allocation itself was still saved; retry the failed message(s) from the Task Dashboard.
                </>
              )}
            </p>
            {result.whatsappFailedCount > 0 && (
              <ul className="mx-auto mt-4 max-w-sm space-y-1 text-left text-xs">
                {result.allocated
                  .filter((a) => a.whatsappStatus === "FAILED")
                  .map((a) => (
                    <li key={a.taskId} className="flex items-center justify-between rounded-md bg-red-50 px-3 py-1.5">
                      <span className="text-slate-700">{a.name}</span>
                      <Badge tone="red">WhatsApp failed</Badge>
                    </li>
                  ))}
              </ul>
            )}
            <div className="mt-6 flex justify-center gap-2">
              <Button onClick={() => router.push("/tasks")}>Go to Tasks</Button>
              <Button variant="secondary" onClick={() => router.push(`/tasks/${id}/dashboard`)}>
                View Task Dashboard
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
        <h1 className="mt-1 text-lg font-semibold text-slate-900">Allocate Task to Cadres</h1>
        <p className="mt-1 text-sm text-slate-500">"{task.name}" — pick the Cadres this should go to.</p>
      </div>

      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <CardTitle>Select District → Mandal → Cadres</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="district">District</Label>
              {districts.length === 0 ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                  {myRegion ? `${myRegion.name} (${myRegion.type})` : "Your area"}
                </p>
              ) : (
                <select
                  id="district"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={effectiveDistrict}
                  onChange={(e) => handleDistrictChange(e.target.value)}
                >
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <Label htmlFor="mandal">Mandal</Label>
              {regionsLoading ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : mandals.length === 0 ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                  {isBoothLevelAdmin ? "N/A — your area is a single Booth" : "No Mandals found in this District."}
                </p>
              ) : (
                <select
                  id="mandal"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={effectiveMandal}
                  onChange={(e) => setMandal(e.target.value)}
                >
                  <option value="">Select a Mandal…</option>
                  {mandals.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="cadreSearch" className="mb-0">
                Cadres {effectiveMandal || isBoothLevelAdmin ? "" : "— select a Mandal first"}
              </Label>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" onClick={selectAllVisible} disabled={filteredCadres.length === 0}>
                  Select All
                </Button>
                <Button type="button" variant="secondary" onClick={clearSelection} disabled={selectedCadreIds.length === 0}>
                  Clear Selection
                </Button>
              </div>
            </div>
            <Input
              id="cadreSearch"
              placeholder="Search Cadre by name or mobile…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-2"
            />

            <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-slate-300 p-2">
              {cadresLoading && <p className="px-2 py-4 text-center text-sm text-slate-400">Loading Cadres…</p>}

              {!cadresLoading && !effectiveMandal && !isBoothLevelAdmin && (
                <p className="px-2 py-4 text-center text-sm text-slate-400">Select a Mandal to see its Cadres.</p>
              )}

              {!cadresLoading &&
                (effectiveMandal || isBoothLevelAdmin) &&
                filteredCadres.length === 0 && (
                  <p className="px-2 py-4 text-center text-sm text-slate-400">
                    {cadresInScope.length === 0 ? "No active Cadres found here." : "No Cadres match your search."}
                  </p>
                )}

              {filteredCadres.map((c: ManagedUser) => {
                const already = alreadyAssignedIds.has(c.id);
                return (
                  <label
                    key={c.id}
                    className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm ${
                      already ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={selectedCadreIds.includes(c.id)}
                      disabled={already}
                      onChange={() => toggleCadre(c.id)}
                    />
                    <div className="flex-1">
                      <p className="font-medium text-slate-800">{c.name}</p>
                      <p className="text-xs text-slate-500">
                        {c.region?.name ?? "—"} · {c.phone}
                      </p>
                    </div>
                    {already ? (
                      <Badge tone="slate">Already Assigned</Badge>
                    ) : (
                      <Badge tone="green">Active</Badge>
                    )}
                  </label>
                );
              })}
            </div>

            <p className="mt-2 text-sm font-medium text-slate-700">
              {selectedCadreIds.length} Cadre{selectedCadreIds.length === 1 ? "" : "s"} Selected
            </p>
          </div>

          {allocate.isError && <p className="text-xs text-red-600">{(allocate.error as Error)?.message}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={() => router.push(`/tasks/${id}`)}>
              Cancel
            </Button>
            <Button onClick={() => setShowConfirm(true)} disabled={selectedCadreIds.length === 0}>
              Allocate to Cadres
            </Button>
          </div>
        </CardContent>
      </Card>

      {showConfirm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
            <h2 className="text-base font-semibold text-slate-900">Confirm Task Allocation</h2>
            <p className="mt-2 text-sm text-slate-600">
              You are about to allocate this task to <span className="font-semibold">{selectedCadreIds.length}</span>{" "}
              Cadre{selectedCadreIds.length === 1 ? "" : "s"}. The selected Cadres will receive this task through
              WhatsApp.
            </p>
            <ul className="mt-3 max-h-32 space-y-0.5 overflow-y-auto text-xs text-slate-500">
              {selectedCadres.map((c) => (
                <li key={c.id}>
                  {c.name} — {c.region?.name}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowConfirm(false)} disabled={allocate.isPending}>
                Cancel
              </Button>
              <Button onClick={onConfirmSend} disabled={allocate.isPending}>
                {allocate.isPending ? "Sending…" : "Yes, Allocate & Send"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
