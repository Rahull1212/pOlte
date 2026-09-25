"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RegionMultiSelect, isRegionWithinScope } from "@/components/region-multi-select";
import { useCreatePoll } from "@/hooks/use-polls";
import { useRegions } from "@/hooks/use-regions";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAvailableTemplates } from "@/hooks/use-message-templates";
import { useTaskList } from "@/hooks/use-tasks";

export default function CreatePollPage() {
  const router = useRouter();
  const { data: currentUser } = useCurrentUser();
  const { data: regions } = useRegions();
  const createPoll = useCreatePoll();

  const [question, setQuestion] = useState("");
  // The answers are the chosen template's Quick Reply buttons — WhatsApp
  // fixes button labels at approval time, so they can't be typed per poll.
  const [templateName, setTemplateName] = useState("");
  // Standalone unless a task is picked.
  const [taskId, setTaskId] = useState("");
  const [districtIds, setDistrictIds] = useState<string[]>([]);
  const [constituencyIds, setConstituencyIds] = useState<string[]>([]);
  const [boothIds, setBoothIds] = useState<string[]>([]);
  const [deadline, setDeadline] = useState("");
  const [result, setResult] = useState<{ id: string; question: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const isAdmin = currentUser?.role === "ADMIN";
  const regionIds = isAdmin ? (currentUser?.regionId ? [currentUser.regionId] : []) : [...districtIds, ...constituencyIds, ...boothIds];

  const { data: templates } = useAvailableTemplates();
  const { data: tasks } = useTaskList();

  // Only templates that can actually pose a question: approved, at least two
  // buttons for the Cadre to choose between, and exactly one dynamic value —
  // the question itself. A one-button template is an announcement, and a
  // multi-variable one has slots a poll cannot fill, which would go out as em
  // dashes mid-message. The API enforces both; this keeps the list from
  // offering something that would only be refused on submit.
  const pollable = useMemo(
    () =>
      (templates ?? []).filter(
        (t) => t.buttons.length >= 2 && t.status !== "REJECTED" && (t.variables === null || t.variables <= 1),
      ),
    [templates],
  );
  const picked = pollable.find((t) => t.name === templateName);

  const byId = useMemo(() => new Map((regions ?? []).map((r) => [r.id, r])), [regions]);

  const handleDistrictChange = (ids: string[]) => {
    setDistrictIds(ids);
    const districtSet = new Set(ids);
    const nextConstituencyIds = constituencyIds.filter((id) => isRegionWithinScope(id, districtSet, byId));
    setConstituencyIds(nextConstituencyIds);
    const constituencySet = new Set(nextConstituencyIds);
    setBoothIds((prev) => prev.filter((id) => isRegionWithinScope(id, constituencySet, byId)));
  };

  const handleConstituencyChange = (ids: string[]) => {
    setConstituencyIds(ids);
    const constituencySet = new Set(ids);
    setBoothIds((prev) => prev.filter((id) => isRegionWithinScope(id, constituencySet, byId)));
  };




  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (regionIds.length === 0) {
      setFormError(isAdmin ? "Your account has no area assigned — contact your Super Admin." : "Select at least one District, Constituency, or Booth.");
      return;
    }
    if (!templateName) {
      setFormError("Choose the template to ask with — its buttons are the answers.");
      return;
    }

    createPoll.mutate(
      {
        question,
        templateName,
        taskId: taskId || undefined,
        regionIds,
        deadline: deadline ? new Date(deadline) : undefined,
      },
      { onSuccess: (res) => setResult({ id: res.id, question: res.question }) },
    );
  };

  // Waits for the role to resolve before deciding what to show. Rendering
  // the form first and swapping it out once currentUser arrives flashes a
  // form the person is not allowed to submit — the same flash that had to be
  // fixed on Grievances and /campaigns/new.
  if (!currentUser) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Loading…</p>
      </AppShell>
    );
  }

  // Super Admins and Admins both write polls. An Admin's reach is their own
  // area — enforced server-side against every requested region, not by the
  // fact that this form offers them no area picker.
  if (currentUser.role !== "SUPER_ADMIN" && currentUser.role !== "ADMIN") {
    return (
      <AppShell>
        <Card className="mx-auto max-w-lg">
          <CardContent className="py-8 text-center">
            <p className="text-lg font-semibold text-slate-900">You can&apos;t create polls</p>
            <p className="mt-2 text-sm text-slate-600">
              Polls are created by Super Admins and Admins, and sent to Cadres over WhatsApp.
            </p>
            <div className="mt-6 flex justify-center">
              <Button onClick={() => router.push("/polls")}>Go to Polls</Button>
            </div>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (result) {
    return (
      <AppShell>
        <Card className="mx-auto max-w-lg">
          <CardContent className="py-8 text-center">
            <p className="text-lg font-semibold text-slate-900">Poll created</p>
            <p className="mt-2 text-sm text-slate-600">
              "{result.question}" has been created. Nothing has been sent yet — allocate it to your Cadres next to
              actually send it out over WhatsApp.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <Button onClick={() => router.push(`/polls/${result.id}`)}>Allocate to Cadres</Button>
              <Button variant="secondary" onClick={() => router.push("/polls")}>
                Go to Polls
              </Button>
            </div>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">Create Poll</h1>

      <form onSubmit={onSubmit} className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Poll Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="question">Question</Label>
              <Input id="question" required value={question} onChange={(e) => setQuestion(e.target.value)} />
            </div>

            <div>
              <Label htmlFor="poll-template">Template to ask with</Label>
              <select
                id="poll-template"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              >
                <option value="">Select a template…</option>
                {pollable.map((t) => (
                  <option key={t.name} value={t.name} disabled={t.status === "REJECTED"}>
                    {t.name} — {t.buttons.join(" / ")}
                    {t.status && t.status !== "APPROVED" ? ` (${t.status})` : ""}
                  </option>
                ))}
              </select>
              {/* The buttons ARE the answers, so showing them is showing the
                  poll. Meta fixes button labels at approval time — that is why
                  options can't be typed per poll. */}
              {picked ? (
                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Cadres will choose from</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {picked.buttons.map((b) => (
                      <span key={b} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700">
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500">
                  A poll&apos;s answers are the template&apos;s WhatsApp buttons, and its one variable is the
                  question you typed above. Only approved templates with 2+ buttons and a single variable can be used.
                </p>
              )}
              {pollable.length === 0 && (
                <p className="mt-1 text-xs text-amber-600">
                  No approved template has 2+ buttons and a single variable. Sync templates, or get one approved in
                  Fyxo first.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="poll-task">Attach to a task — optional</Label>
              <select
                id="poll-task"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
              >
                <option value="">Standalone poll</option>
                {(tasks ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Leave as Standalone to ask a question on its own. Attaching it files the answers against that task too.
              </p>
            </div>

            {!isAdmin && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label>Select District(s)</Label>
                  <RegionMultiSelect type="DISTRICT" selected={districtIds} onChange={handleDistrictChange} label="districts" />
                </div>
                <div>
                  <Label>Select Constituency(s) — optional</Label>
                  <RegionMultiSelect
                    type="CONSTITUENCY"
                    selected={constituencyIds}
                    onChange={handleConstituencyChange}
                    label="constituencies"
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
                    scopeIds={constituencyIds}
                    scopeLabel="a constituency"
                  />
                </div>
              </div>
            )}
            <p className="text-xs text-slate-500">
              {isAdmin
                ? "This creates the poll record only — nothing is sent yet. You'll choose which Cadres to send it to on the next screen."
                : `This creates the poll record only — nothing is sent yet. It'll be routed to the Admins covering the selected area(s) — ${regionIds.length} area${regionIds.length === 1 ? "" : "s"} selected so far — for them to allocate to their Cadres.`}
            </p>

            <div>
              <Label htmlFor="deadline">Deadline — optional</Label>
              <Input id="deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>

            {(formError || createPoll.isError) && (
              <p className="text-xs text-red-600">{formError ?? (createPoll.error as Error)?.message}</p>
            )}

            <Button type="submit" className="w-full" disabled={createPoll.isPending}>
              {createPoll.isPending ? "Creating..." : "Create Poll"}
            </Button>
          </CardContent>
        </Card>
      </form>
    </AppShell>
  );
}
