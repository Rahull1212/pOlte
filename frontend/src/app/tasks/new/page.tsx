"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TaskTemplatePicker } from "@/components/tasks/task-template-picker";
import {
  OfficialLocationPicker,
  OfficialLocation,
  EMPTY_OFFICIAL_LOCATION,
  deepestSelectedId,
  officialLocationError,
} from "@/components/official-location-picker";
import { useRegions } from "@/hooks/use-regions";
import { useCreateTaskBatch, useUploadTaskAttachments, useAllocateNewTask } from "@/hooks/use-tasks";
import { useCampaigns } from "@/hooks/use-campaigns";
import { useManagedUsers } from "@/hooks/use-users";
import { TaskPriority } from "@/lib/shared-types";

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

// useSearchParams() opts a page out of static generation unless it sits
// inside a Suspense boundary — `next build` fails without this wrapper.
export default function CreateTaskPage() {
  return (
    <Suspense fallback={null}>
      <CreateTaskPageContent />
    </Suspense>
  );
}

function CreateTaskPageContent() {
  const router = useRouter();
  const { data: campaigns } = useCampaigns();
  // Cached by the same query the picker uses — no extra request.
  const { data: regions } = useRegions();
  const createBatch = useCreateTaskBatch();
  const allocate = useAllocateNewTask();
  const uploadAttachments = useUploadTaskAttachments();
  // Only fetched when it's actually needed — the routed path never shows
  // a Cadre list.
  const { data: cadres } = useManagedUsers("CADRE");

  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [remarks, setRemarks] = useState("");
  // Pre-selected when arriving from a campaign page ("+ Create Task" there),
  // so an Admin filing work under a campaign doesn't have to find it again
  // in a dropdown — and can't pick the wrong one by accident.
  const presetCampaignId = useSearchParams().get("campaignId") ?? "";
  const [campaignId, setCampaignId] = useState(presetCampaignId);
  const [location, setLocation] = useState<OfficialLocation>(EMPTY_OFFICIAL_LOCATION);
  // Either route the task to the Admins covering the target area(s) for
  // them to allocate, or hand it straight to named Cadres — the second is
  // create-then-allocate in one submit, so the Cadres get their WhatsApp
  // message without a second screen.
  const [assignMode, setAssignMode] = useState<"ROUTE" | "DIRECT">("ROUTE");
  const [cadreIds, setCadreIds] = useState<string[]>([]);
  const [cadreSearch, setCadreSearch] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<{ id: string; name: string; sentTo: number } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);

  // The official location IS the task's area — how deep you went is the
  // targeting decision, so there is nothing else to pick. Stopping at a
  // District routes the task to every Admin covering it; going down to a
  // Polling Station routes it to that station's Admin alone.
  const targetRegionId = deepestSelectedId(location);
  const regionIds = targetRegionId ? [targetRegionId] : [];

  const visibleCadres = useMemo(() => {
    const q = cadreSearch.trim().toLowerCase();
    return (cadres ?? [])
      .filter((c) => c.isActive)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q));
  }, [cadres, cadreSearch]);

  const toggleCadre = (id: string) =>
    setCadreIds((current) => (current.includes(id) ? current.filter((c) => c !== id) : [...current, id]));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const locationError = officialLocationError(location, regions);
    if (locationError) {
      setFormError(locationError);
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

    if (assignMode === "DIRECT" && cadreIds.length === 0) {
      setFormError("Select at least one Cadre to assign this task to.");
      return;
    }

    setIsAssigning(true);
    try {
      const created = await createBatch.mutateAsync({
        name,
        objective: objective || undefined,
        description: description || undefined,
        remarks: remarks || undefined,
        deadline: new Date(deadline),
        priority,
        campaignId: campaignId || undefined,
        pollingStationId: location.pollingStationId || undefined,
        regionIds,
        attachmentUrls,
      });

      if (assignMode === "ROUTE") {
        setResult({ id: created.batch.id, name: created.batch.name, sentTo: 0 });
        return;
      }

      // The task record exists at this point either way. If allocation
      // fails, say so plainly and send them to the allocate screen rather
      // than implying nothing was created.
      const allocated = await allocate.mutateAsync({
        id: created.batch.id,
        regionIds: [],
        cadreIds,
      });
      setResult({ id: created.batch.id, name: created.batch.name, sentTo: allocated.cadreCount ?? cadreIds.length });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create the task");
    } finally {
      setIsAssigning(false);
    }
  };

  if (result) {
    return (
      <AppShell>
        <Card className="mx-auto max-w-lg">
          <CardContent className="py-8 text-center">
            <p className="text-lg font-semibold text-slate-900">
              {result.sentTo > 0 ? "Task assigned" : "Task created"}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {result.sentTo > 0
                ? `"${result.name}" was assigned to ${result.sentTo} Cadre${result.sentTo === 1 ? "" : "s"} and their WhatsApp message has gone out.`
                : `"${result.name}" has been created. Nothing has been sent yet — allocate it to your Cadres next to actually send it out over WhatsApp.`}
            </p>
            <div className="mt-6 flex justify-center gap-2">
              {result.sentTo === 0 && (
                <Button onClick={() => router.push(`/tasks/${result.id}/allocate`)}>Allocate to Cadres</Button>
              )}
              <Button
                variant={result.sentTo > 0 ? undefined : "secondary"}
                onClick={() => router.push(result.sentTo > 0 ? `/tasks/${result.id}` : "/tasks")}
              >
                {result.sentTo > 0 ? "View Task" : "Go to Tasks"}
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

            <OfficialLocationPicker value={location} onChange={setLocation} />

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

            {/* Shown on the form that sends it, because that is where the
                choice matters — and it is the only place an Admin can see
                or change their template. */}
            <TaskTemplatePicker />

            <div>
              <Label>Assign to</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {(["ROUTE", "DIRECT"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAssignMode(mode)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      assignMode === mode ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {mode === "ROUTE" ? "Route to Admins for allocation" : "Assign directly to Cadres"}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {assignMode === "ROUTE"
                  ? "Nothing is sent yet — the task goes to the Admins covering the official location you chose, for them to allocate to their Cadres."
                  : "The Cadres you pick below are assigned the task immediately and receive their WhatsApp message on submit."}
              </p>
            </div>

            {assignMode === "DIRECT" && (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="cadre-search">Cadres</Label>
                  {/* Acts on what is currently VISIBLE, not on every Cadre:
                      with a search typed, "Select all 3" selecting fifty
                      people would be the opposite of what it says. Selections
                      made under a previous search are kept. */}
                  {visibleCadres.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setCadreIds((current) => {
                          const visibleIds = visibleCadres.map((c) => c.id);
                          const allVisibleSelected = visibleIds.every((id) => current.includes(id));
                          return allVisibleSelected
                            ? current.filter((id) => !visibleIds.includes(id))
                            : [...new Set([...current, ...visibleIds])];
                        })
                      }
                      className="text-xs font-medium text-brand-600 hover:underline"
                    >
                      {visibleCadres.every((c) => cadreIds.includes(c.id))
                        ? "Clear all"
                        : `Select all ${visibleCadres.length}`}
                    </button>
                  )}
                </div>
                <Input
                  id="cadre-search"
                  placeholder="Search by name or phone…"
                  value={cadreSearch}
                  onChange={(e) => setCadreSearch(e.target.value)}
                />
                <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                  {visibleCadres.length === 0 && (
                    <p className="px-1 py-3 text-center text-xs text-slate-400">
                      {cadreSearch ? "No Cadres match that search." : "No active Cadres in your area."}
                    </p>
                  )}
                  {visibleCadres.map((cadre) => (
                    <label
                      key={cadre.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={cadreIds.includes(cadre.id)}
                        onChange={() => toggleCadre(cadre.id)}
                      />
                      <span className="text-slate-800">{cadre.name}</span>
                      <span className="text-xs text-slate-400">{cadre.phone}</span>
                      {cadre.region && <span className="text-xs text-slate-400">· {cadre.region.name}</span>}
                    </label>
                  ))}
                </div>
                {cadreIds.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    {cadreIds.length} of {(cadres ?? []).filter((c) => c.isActive).length} Cadres selected
                  </p>
                )}
              </div>
            )}

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

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <Button type="submit" className="w-full" disabled={isAssigning || uploadAttachments.isPending}>
              {uploadAttachments.isPending
                ? "Uploading attachments..."
                : isAssigning
                  ? assignMode === "DIRECT"
                    ? "Assigning and sending..."
                    : "Creating..."
                  : assignMode === "DIRECT"
                    ? "Create & Assign to Cadres"
                    : "Create Task"}
            </Button>
          </CardContent>
        </Card>
      </form>
    </AppShell>
  );
}
