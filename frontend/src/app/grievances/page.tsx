"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RegionSelect } from "@/components/region-select";
import { useGrievances, useSubmitGrievance, useDecideGrievance, useDeleteGrievance } from "@/hooks/use-grievances";
import { ApiError } from "@/lib/api-client";
import { useCurrentUser } from "@/hooks/use-auth";
import { GrievanceStatus } from "@/lib/shared-types";

const statusTone = { OPEN: "amber", IN_PROGRESS: "blue", RESOLVED: "green", REJECTED: "red" } as const;
const STATUS_OPTIONS: GrievanceStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"];

// useSearchParams() opts a page out of static generation unless it's inside
// a Suspense boundary — `next build` fails without this wrapper (dev mode
// doesn't enforce it, which is why this only ever showed up in a real build).
export default function GrievancesPage() {
  return (
    <Suspense fallback={null}>
      <GrievancesPageContent />
    </Suspense>
  );
}

function GrievancesPageContent() {
  const { data: user } = useCurrentUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const statusFilter = (searchParams.get("status") as GrievanceStatus | null) ?? undefined;

  const { data: grievances, isLoading } = useGrievances(statusFilter);
  const submitGrievance = useSubmitGrievance();
  const decide = useDecideGrievance();
  const deleteGrievance = useDeleteGrievance();
  const [form, setForm] = useState({ regionId: "", category: "", description: "" });
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canDecide = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";

  const handleDelete = (id: string, label: string) => {
    if (!window.confirm(`Delete this grievance (${label})? This cannot be undone.`)) return;
    setDeleteError(null);
    deleteGrievance.mutate(id, {
      onError: (err) => {
        const message = err instanceof ApiError ? err.message : "Failed to delete grievance";
        setDeleteError(message);
      },
    });
  };

  const setStatusFilter = (status?: GrievanceStatus) => {
    router.push(status ? `/grievances?status=${status}` : "/grievances");
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitGrievance.mutate(
      { ...form, photos: [] },
      { onSuccess: () => setForm({ regionId: "", category: "", description: "" }) },
    );
  };

  return (
    <AppShell>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">Grievances</h1>

      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setStatusFilter(undefined)}
          className={`rounded-full px-3 py-1 text-xs ${!statusFilter ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          All
        </button>
        {STATUS_OPTIONS.map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`rounded-full px-3 py-1 text-xs ${statusFilter === status ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {status}
          </button>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Submit Grievance</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <Label htmlFor="regionId">Area</Label>
                <RegionSelect
                  id="regionId"
                  value={form.regionId}
                  onChange={(regionId) => setForm({ ...form, regionId })}
                />
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  required
                  placeholder="Water Supply, Road Repair..."
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  required
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              {submitGrievance.isError && (
                <p className="text-xs text-red-600">{(submitGrievance.error as Error).message}</p>
              )}
              <Button type="submit" className="w-full" disabled={submitGrievance.isPending}>
                {submitGrievance.isPending ? "Submitting..." : "Submit"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>
              {statusFilter ? `${statusFilter.replace("_", " ")} Grievances` : "All Grievances"}{" "}
              <span className="font-normal text-slate-400">({grievances?.length ?? 0})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
            {grievances?.map((g) => (
              <div key={g.id} className="rounded-md border border-slate-100 p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {g.category} — {g.region.name}
                      {g.citizen && <span className="font-normal text-slate-500"> ({g.citizen.name})</span>}
                    </p>
                    <p className="text-xs text-slate-500">{g.description}</p>
                    {g.resolutionNotes && (
                      <p className="mt-1 text-xs text-slate-500">Notes: {g.resolutionNotes}</p>
                    )}
                  </div>
                  <Badge tone={statusTone[g.status]}>{g.status}</Badge>
                </div>
                {canDecide && (
                  <div className="mt-2 flex justify-end gap-2">
                    {(g.status === "OPEN" || g.status === "IN_PROGRESS") && (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() => decide.mutate({ id: g.id, action: "resolve", notes: "Resolved" })}
                        >
                          Resolve
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => decide.mutate({ id: g.id, action: "reject", notes: "Rejected" })}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    <Button
                      variant="danger"
                      disabled={deleteGrievance.isPending && deleteGrievance.variables === g.id}
                      onClick={() => handleDelete(g.id, `${g.category} — ${g.region.name}`)}
                    >
                      {deleteGrievance.isPending && deleteGrievance.variables === g.id ? "Deleting..." : "Delete"}
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {!isLoading && grievances?.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500">No grievances yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
