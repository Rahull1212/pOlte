"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/use-auth";
import { useCampaignOverview } from "@/hooks/use-campaign-detail";
import { useUpdateCampaign } from "@/hooks/use-campaigns";
import { CampaignPriority, CampaignStatus, CampaignType } from "@/lib/shared-types";
import { ApiError } from "@/lib/api-client";

/** Dates arrive as ISO strings; <input type="date"> wants YYYY-MM-DD. */
const toDateInput = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/**
 * Editing an existing campaign. Deliberately narrower than the create form:
 * Admin assignment and target/budget *allocation* have their own screens
 * (Assign Admins on create, and the Targets/Budget pages), so duplicating
 * them here would give two places to change the same thing.
 */
export default function EditCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const { data, isLoading } = useCampaignOverview(id);
  const updateCampaign = useUpdateCampaign(id);

  const [form, setForm] = useState({
    name: "",
    description: "",
    objective: "",
    category: "",
    startDate: "",
    endDate: "",
    priority: "MEDIUM" as CampaignPriority,
    status: "DRAFT" as CampaignStatus,
    // Strings, not numbers: blank has to mean "not declared", which 0
    // cannot express — 0 is a real (if odd) target, null is no target.
    totalTarget: "",
    totalBudget: "",
    expectedVolunteers: "",
  });
  const [error, setError] = useState<string | null>(null);

  // Seeded once the campaign loads; the form owns the values after that so
  // typing isn't overwritten by a background refetch.
  useEffect(() => {
    if (!data) return;
    const c = data.campaign;
    setForm({
      name: c.name,
      description: c.description,
      objective: c.objective ?? "",
      category: c.category ?? "",
      startDate: toDateInput(c.startDate),
      endDate: toDateInput(c.endDate),
      priority: c.priority,
      status: c.status,
      totalTarget: c.totalTarget?.toString() ?? "",
      totalBudget: c.totalBudget?.toString() ?? "",
      expectedVolunteers: c.expectedVolunteers?.toString() ?? "",
    });
  }, [data]);

  const campaign = data?.campaign;
  // Super Admin only, matching the API. An Admin reaching this URL directly
  // gets told why rather than a form whose Save would be refused.
  const canEdit = user?.role === "SUPER_ADMIN";

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (new Date(form.endDate) <= new Date(form.startDate)) {
      setError("End date must be after the start date.");
      return;
    }

    updateCampaign.mutate(
      {
        name: form.name,
        description: form.description,
        objective: form.objective || undefined,
        category: form.category || undefined,
        startDate: new Date(form.startDate),
        endDate: new Date(form.endDate),
        priority: form.priority,
        // Left blank stays blank rather than being sent as 0.
        totalTarget: form.totalTarget ? Number(form.totalTarget) : undefined,
        totalBudget: form.totalBudget ? Number(form.totalBudget) : undefined,
        expectedVolunteers: form.expectedVolunteers ? Number(form.expectedVolunteers) : undefined,
      },
      {
        onSuccess: () => router.push(`/campaigns/${id}`),
        onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save this campaign"),
      },
    );
  };

  if (isLoading) {
    return (
      <AppShell>
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">Loading campaign…</CardContent>
        </Card>
      </AppShell>
    );
  }

  // The backend refuses the update either way; this keeps someone who
  // typed the URL from filling in a form that was always going to 403.
  if (!campaign || !canEdit) {
    return (
      <AppShell>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-slate-800">You can&apos;t edit this campaign</p>
            <p className="mt-1 text-sm text-slate-500">
              Only a Super Admin can change a campaign. Your part is accepting it and allocating the work to your
              Cadres.
            </p>
            <Link href={`/campaigns/${id}`} className="mt-4 inline-block">
              <Button variant="secondary">← Back to campaign</Button>
            </Link>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const selectClass = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

  return (
    <AppShell>
      <nav className="mb-4 flex items-center gap-1 text-xs text-slate-400">
        <Link href="/campaigns" className="hover:text-slate-700 hover:underline">
          Campaigns
        </Link>
        <span>›</span>
        <Link href={`/campaigns/${id}`} className="hover:text-slate-700 hover:underline">
          {campaign.name}
        </Link>
        <span>›</span>
        <span className="text-slate-600">Edit</span>
      </nav>

      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>Edit Campaign</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">Campaign name</Label>
              <Input
                id="name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                required
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="objective">Objective</Label>
                <Input
                  id="objective"
                  value={form.objective}
                  onChange={(e) => setForm({ ...form, objective: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="category">Campaign Type</Label>
                <select
                  id="category"
                  className={selectClass}
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  <option value="">Select a type…</option>
                  {/* A campaign created before this list existed carries a
                      value that isn't in it ("Membership"). Offering it keeps
                      editing anything else on the form from silently
                      rewriting the type to blank. */}
                  {!CampaignType.includes(form.category as (typeof CampaignType)[number]) &&
                    form.category !== "" && <option value={form.category}>{form.category}</option>}
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
                <Input
                  id="startDate"
                  type="date"
                  required
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="endDate">End date</Label>
                <Input
                  id="endDate"
                  type="date"
                  required
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="priority">Priority</Label>
                <select
                  id="priority"
                  className={selectClass}
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value as CampaignPriority })}
                >
                  {CampaignPriority.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="expectedVolunteers">Expected volunteers</Label>
                <Input
                  id="expectedVolunteers"
                  type="number"
                  value={form.expectedVolunteers}
                  onChange={(e) => setForm({ ...form, expectedVolunteers: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="totalTarget">
                  Total target <span className="font-normal text-slate-400">— optional</span>
                </Label>
                <Input
                  id="totalTarget"
                  type="number"
                  value={form.totalTarget}
                  placeholder="Allocated per area on the Targets screen"
                  onChange={(e) => setForm({ ...form, totalTarget: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="totalBudget">
                  Total budget (₹) <span className="font-normal text-slate-400">— optional</span>
                </Label>
                <Input
                  id="totalBudget"
                  type="number"
                  value={form.totalBudget}
                  placeholder="Allocated per area on the Budget screen"
                  onChange={(e) => setForm({ ...form, totalBudget: e.target.value })}
                />
              </div>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => router.push(`/campaigns/${id}`)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateCampaign.isPending}>
                {updateCampaign.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
