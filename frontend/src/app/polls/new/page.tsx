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

export default function CreatePollPage() {
  const router = useRouter();
  const { data: currentUser } = useCurrentUser();
  const { data: regions } = useRegions();
  const createPoll = useCreatePoll();

  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [districtIds, setDistrictIds] = useState<string[]>([]);
  const [mandalIds, setMandalIds] = useState<string[]>([]);
  const [boothIds, setBoothIds] = useState<string[]>([]);
  const [deadline, setDeadline] = useState("");
  const [result, setResult] = useState<{ id: string; question: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const isAdmin = currentUser?.role === "ADMIN";
  const regionIds = isAdmin ? (currentUser?.regionId ? [currentUser.regionId] : []) : [...districtIds, ...mandalIds, ...boothIds];

  const byId = useMemo(() => new Map((regions ?? []).map((r) => [r.id, r])), [regions]);

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

  const updateOption = (i: number, value: string) => {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  };

  const addOption = () => {
    if (options.length >= 3) return;
    setOptions((prev) => [...prev, ""]);
  };

  const removeOption = (i: number) => {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (regionIds.length === 0) {
      setFormError(isAdmin ? "Your account has no area assigned — contact your Super Admin." : "Select at least one District, Mandal, or Booth.");
      return;
    }
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (cleanOptions.length < 2) {
      setFormError("Add at least 2 options.");
      return;
    }

    createPoll.mutate(
      {
        question,
        options: cleanOptions,
        regionIds,
        deadline: deadline ? new Date(deadline) : undefined,
      },
      { onSuccess: (res) => setResult({ id: res.id, question: res.question }) },
    );
  };

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
              <Label>Options (2–3)</Label>
              <div className="space-y-2">
                {options.map((option, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      required
                      value={option}
                      onChange={(e) => updateOption(i, e.target.value)}
                      placeholder={`Option ${i + 1}`}
                    />
                    {options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeOption(i)}
                        className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {options.length < 3 && (
                <button type="button" onClick={addOption} className="mt-2 text-xs text-brand-600 hover:underline">
                  + Add another option
                </button>
              )}
              <p className="mt-1 text-xs text-slate-500">
                Capped at 3 — WhatsApp delivery uses fixed Option A/B/C reply buttons.
              </p>
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
