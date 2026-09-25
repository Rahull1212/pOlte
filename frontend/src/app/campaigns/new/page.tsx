"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CampaignType, createCampaignSchema, CreateCampaignDto } from "@/lib/shared-types";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCreateCampaign } from "@/hooks/use-campaigns";
import { useManagedUsers } from "@/hooks/use-users";
import { useRegions } from "@/hooks/use-regions";
import { useCurrentUser } from "@/hooks/use-auth";

// Only the levels a campaign is planned at are offered.
const AREA_LABELS: Record<string, string> = {
  STATE: "State",
  DISTRICT: "District",
  CONSTITUENCY: "Assembly Constituency",
  BOOTH: "Polling Station",
};

export default function NewCampaignPage() {
  const router = useRouter();
  const createCampaign = useCreateCampaign();
  const { data: me } = useCurrentUser();
  // Admins see only the Admins in their own area — /users is already scoped
  // by the backend, so this list never needs filtering here.
  const { data: admins } = useManagedUsers("ADMIN");
  const { data: regions } = useRegions();
  const [regionIds, setRegionIds] = useState<string[]>([]);
  const [areaSearch, setAreaSearch] = useState("");

  const allRegions = useMemo(() => regions ?? [], [regions]);
  // The top of the hierarchy — what "All areas" resolves to.
  const rootRegions = useMemo(() => allRegions.filter((r) => !r.parentId), [allRegions]);
  const allAreas =
    rootRegions.length > 0 && rootRegions.every((r) => regionIds.includes(r.id));

  // Polling stations are deliberately absent: a campaign is planned at
  // District/Constituency level, and listing 600 booths would bury the
  // levels anyone actually picks.
  const selectableAreas = useMemo(
    () => allRegions.filter((r) => r.type === "DISTRICT" || r.type === "CONSTITUENCY"),
    [allRegions],
  );

  const visibleAreas = useMemo(() => {
    const q = areaSearch.trim().toLowerCase();
    if (!q) return selectableAreas;
    return selectableAreas.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.number ?? "").toLowerCase().includes(q),
    );
  }, [selectableAreas, areaSearch]);

  const toggleRegion = (id: string) =>
    setRegionIds((current) => (current.includes(id) ? current.filter((r) => r !== id) : [...current, id]));

  const toggleAllAreas = () =>
    setRegionIds(allAreas ? [] : rootRegions.map((r) => r.id));

  // Which Admins the chosen areas actually reach. Mirrors the backend rule
  // (RegionsService.adminsCovering): an Admin is covered if their area sits
  // inside a selection, or contains one.
  const coveredAdmins = useMemo(() => {
    if (regionIds.length === 0) return [];
    const byId = new Map(allRegions.map((r) => [r.id, r]));
    const within = (regionId: string, targets: Set<string>) => {
      let cur = byId.get(regionId);
      while (cur) {
        if (targets.has(cur.id)) return true;
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return false;
    };
    const selected = new Set(regionIds);
    return (admins ?? []).filter(
      (a) =>
        a.isActive &&
        (within(a.regionId, selected) ||
          regionIds.some((t) => within(t, new Set([a.regionId])))),
    );
  }, [admins, regionIds, allRegions]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateCampaignDto>({
    resolver: zodResolver(createCampaignSchema),
    defaultValues: { priority: "MEDIUM", requiredDocuments: [], adminIds: [], regionIds: [] },
  });

  // Nothing is rendered until the role is known. Guessing wrong for even
  // one frame would flash the whole create form at an Admin who isn't
  // allowed to use it, then yank it away on hydration.
  if (!me) {
    return (
      <AppShell>
        <Card className="mx-auto max-w-lg">
          <CardContent className="py-12 text-center text-sm text-slate-500">Loading…</CardContent>
        </Card>
      </AppShell>
    );
  }

  // Reached by typing the URL. The API refuses the POST either way; this
  // stops someone filling in a long form that was always going to fail.
  if (me.role !== "SUPER_ADMIN") {
    return (
      <AppShell>
        <Card className="mx-auto max-w-lg">
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-slate-800">Only a Super Admin can create a campaign</p>
            <p className="mt-1 text-sm text-slate-500">
              Campaigns are assigned to you. Accept one from the Campaigns list, then allocate its tasks to
              your Cadres.
            </p>
            <Button variant="secondary" className="mt-4" onClick={() => router.push("/campaigns")}>
              ← Back to Campaigns
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const onSubmit = handleSubmit((dto) => {
    createCampaign.mutate(
      // Areas go up, not people: the backend resolves whoever covers them,
      // using the same rule that routes task batches.
      { ...dto, regionIds, adminIds: [] },
      { onSuccess: (campaign: any) => router.push(`/campaigns/${campaign.id}`) },
    );
  });

  return (
    <AppShell>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">Create Campaign</h1>
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>Campaign details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">Campaign name</Label>
              <Input id="name" placeholder="Membership Drive 2026" {...register("name")} />
              {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={5}
                placeholder="Collect new membership forms across the state"
                {...register("description")}
              />
              {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="objective">Objective</Label>
                <Input id="objective" {...register("objective")} />
              </div>
              <div>
                <Label htmlFor="category">Campaign Type</Label>
                <select
                  id="category"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  {...register("category")}
                >
                  <option value="">Select a type…</option>
                  {CampaignType.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="startDate">Start date</Label>
                <Input id="startDate" type="date" {...register("startDate")} />
                {errors.startDate && <p className="mt-1 text-xs text-red-600">{errors.startDate.message}</p>}
              </div>
              <div>
                <Label htmlFor="endDate">End date</Label>
                <Input id="endDate" type="date" {...register("endDate")} />
                {errors.endDate && <p className="mt-1 text-xs text-red-600">{errors.endDate.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="priority">Priority</Label>
                <select id="priority" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" {...register("priority")}>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>
              <div>
                <Label htmlFor="expectedVolunteers">Expected volunteers</Label>
                <Input id="expectedVolunteers" type="number" {...register("expectedVolunteers", { valueAsNumber: true })} />
              </div>
            </div>

            <div>
              <Label>Areas</Label>
              <p className="mb-2 text-xs text-slate-500">
                Where this campaign runs. Every Admin covering the areas you choose is assigned it — each of
                them accepts or declines, and only then can they allocate its tasks to their Cadres.
              </p>

              <div className="rounded-md border border-slate-200">
                <div className="space-y-2 border-b border-slate-100 p-2">
                  <Input
                    type="search"
                    placeholder="Search areas by name or number..."
                    value={areaSearch}
                    onChange={(e) => setAreaSearch(e.target.value)}
                    aria-label="Search areas"
                  />
                  <div className="flex items-center justify-between gap-2 px-1">
                    {/* "All areas" selects the root of the hierarchy rather
                        than ticking 700-odd rows: an Admin anywhere sits
                        inside the State, so one id covers everybody and the
                        payload stays sane. */}
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                      <input type="checkbox" checked={allAreas} onChange={toggleAllAreas} />
                      All areas{rootRegions.length > 0 ? ` (${rootRegions.map((r) => r.name).join(", ")})` : ""}
                    </label>
                    {regionIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setRegionIds([])}
                        className="text-xs text-slate-500 hover:text-slate-800 hover:underline"
                      >
                        Clear selection
                      </button>
                    )}
                  </div>
                </div>

                <div className="max-h-48 space-y-1 overflow-y-auto p-2">
                  {allAreas && (
                    <p className="px-1 py-3 text-center text-xs text-slate-500">
                      Every area is covered. Uncheck &quot;All areas&quot; to pick specific ones.
                    </p>
                  )}
                  {!allAreas && visibleAreas.length === 0 && (
                    <p className="px-1 py-3 text-center text-xs text-slate-400">
                      {areaSearch.trim() ? `No areas match "${areaSearch.trim()}".` : "No areas available."}
                    </p>
                  )}
                  {!allAreas &&
                    visibleAreas.map((region) => (
                      <label
                        key={region.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={regionIds.includes(region.id)}
                          onChange={() => toggleRegion(region.id)}
                        />
                        <span className="text-slate-800">
                          {region.number ? `${region.number} — ${region.name}` : region.name}
                        </span>
                        <span className="text-xs text-slate-400">({AREA_LABELS[region.type]})</span>
                      </label>
                    ))}
                </div>
              </div>

              {/* Says who this will actually reach, so the Super Admin isn't
                  guessing which Admins a District covers. */}
              <p className="mt-1 text-xs text-slate-500">
                {regionIds.length === 0
                  ? "No areas selected — the campaign will be created with no Admins assigned."
                  : `${coveredAdmins.length} Admin(s) will be assigned: ${coveredAdmins.map((a) => a.name).join(", ") || "none in these areas"}`}
              </p>
            </div>

            {createCampaign.isError && (
              <p className="text-xs text-red-600">{(createCampaign.error as Error).message}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" disabled={createCampaign.isPending}>
                {createCampaign.isPending ? "Creating..." : "Create Campaign"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
