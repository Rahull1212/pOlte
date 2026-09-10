"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RegionMultiSelect, isRegionWithinScope } from "@/components/region-multi-select";
import { useCreateTaskBatch, useUploadTaskAttachments } from "@/hooks/use-tasks";
import { useCampaigns } from "@/hooks/use-campaigns";
import { useRegions } from "@/hooks/use-regions";
import { useCurrentUser } from "@/hooks/use-auth";
import { TaskPriority } from "@/lib/shared-types";

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export default function CreateTaskPage() {
  const router = useRouter();
  const { data: currentUser } = useCurrentUser();
  const { data: campaigns } = useCampaigns();
  const { data: regions } = useRegions();
  const createBatch = useCreateTaskBatch();
  const uploadAttachments = useUploadTaskAttachments();

  const [name, setName] = useState("");
  const [districtIds, setDistrictIds] = useState<string[]>([]);
  const [mandalIds, setMandalIds] = useState<string[]>([]);
  const [boothIds, setBoothIds] = useState<string[]>([]);
  const [objective, setObjective] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [remarks, setRemarks] = useState("");
  const [additionalDetails, setAdditionalDetails] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<{ id: string; name: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // An Admin manages exactly one area (their own regionId) — the District/
  // Mandal/Booth drill-down exists so a Super Admin can route a task to
  // areas they don't personally sit in, which doesn't apply to an Admin.
  const isAdmin = currentUser?.role === "ADMIN";
  const regionIds = isAdmin ? (currentUser?.regionId ? [currentUser.regionId] : []) : [...districtIds, ...mandalIds, ...boothIds];

  const byId = useMemo(() => new Map((regions ?? []).map((r) => [r.id, r])), [regions]);

  // District -> Mandal -> Booth is a strict dependent hierarchy: narrowing or
  // clearing a parent selection must drop any child selections that no
  // longer belong to it, otherwise a stale Mandal/Booth from a deselected
  // District could stay checked even though it's no longer shown.
  const handleDistrictChange = (ids: string[]) => {
    setDistrictIds(ids);
    const districtSet = new Set(ids);
    const nextMandalIds = mandalIds.filter((id) => isRegionWithinScope(id, districtSet, byId));
    setMandalIds(nextMandalIds);
    const mandalSet = new Set(nextMandalIds);
    setBoothIds((prev) => prev.filter((id) => isRegionWithinScope(id, mandalSet, byId)));
  };

  const handleMandalChange = (ids: string[]) => {
    setMandalIds(ids);
    const mandalSet = new Set(ids);
    setBoothIds((prev) => prev.filter((id) => isRegionWithinScope(id, mandalSet, byId)));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (regionIds.length === 0) {
      setFormError(isAdmin ? "Your account has no area assigned — contact your Super Admin." : "Select at least one District, Mandal, or Booth.");
      return;
    }

    let attachmentUrls: string[] = [];
    if (files.length > 0) {
      try {
        const uploaded = await uploadAttachments.mutateAsync(files);
        attachmentUrls = uploaded.urls;
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Attachment upload failed");
        return;
      }
    }

    createBatch.mutate(
      {
        name,
        objective: objective || undefined,
        description: description || undefined,
        additionalDetails: additionalDetails || undefined,
        remarks: remarks || undefined,
        deadline: new Date(deadline),
        priority,
        campaignId: campaignId || undefined,
        regionIds,
        attachmentUrls,
      },
      {
        onSuccess: (res) => setResult({ id: res.batch.id, name: res.batch.name }),
      },
    );
  };

  if (result) {
    return (
      <AppShell>
        <Card className="mx-auto max-w-lg">
          <CardContent className="py-8 text-center">
            <p className="text-lg font-semibold text-slate-900">Task created</p>
            <p className="mt-2 text-sm text-slate-600">
              "{result.name}" has been created. Nothing has been sent yet — allocate it to your Cadres next to
              actually send it out over WhatsApp.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <Button onClick={() => router.push(`/tasks/${result.id}/allocate`)}>Allocate to Cadres</Button>
              <Button variant="secondary" onClick={() => router.push("/tasks")}>
                Go to Tasks
              </Button>
            </div>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">Create Task</h1>

      <form onSubmit={onSubmit} className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Task Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Task Name</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            {!isAdmin && (
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
            )}
            <p className="text-xs text-slate-500">
              {isAdmin
                ? "This creates the task record only — nothing is sent yet. You'll choose which Cadres to send it to on the next screen."
                : `This creates the task record only — nothing is sent yet. It'll be routed to the Admins covering the selected area(s) — ${regionIds.length} area${regionIds.length === 1 ? "" : "s"} selected so far — for them to allocate to their Cadres.`}
            </p>

            <div>
              <Label htmlFor="objective">Task Objective</Label>
              <Input id="objective" value={objective} onChange={(e) => setObjective(e.target.value)} />
            </div>

            <div>
              <Label htmlFor="description">Task Description / Instructions</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="deadline">Deadline</Label>
                <Input
                  id="deadline"
                  type="datetime-local"
                  required
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="priority">Priority</Label>
                <select
                  id="priority"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                >
                  {TaskPriority.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <Label htmlFor="remarks">Comments / Remarks</Label>
              <Textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>

            <div>
              <Label htmlFor="additionalDetails">Additional Details</Label>
              <Textarea
                id="additionalDetails"
                value={additionalDetails}
                onChange={(e) => setAdditionalDetails(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="campaignId">Campaign — optional</Label>
              <select
                id="campaignId"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
              >
                <option value="">No campaign — standalone task</option>
                {campaigns?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="attachments">Attachments — optional</Label>
              <input
                id="attachments"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
              />
              {files.length > 0 && <p className="mt-1 text-xs text-slate-500">{files.length} file(s) selected</p>}
            </div>

            {(formError || createBatch.isError) && (
              <p className="text-xs text-red-600">{formError ?? (createBatch.error as Error)?.message}</p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={createBatch.isPending || uploadAttachments.isPending}
            >
              {uploadAttachments.isPending
                ? "Uploading attachments..."
                : createBatch.isPending
                  ? "Creating..."
                  : "Create Task"}
            </Button>
          </CardContent>
        </Card>
      </form>
    </AppShell>
  );
}
