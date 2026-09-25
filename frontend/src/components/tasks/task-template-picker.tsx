"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import {
  useMyTemplate,
  useAvailableTemplates,
  useAssignMessageTemplate,
} from "@/hooks/use-message-templates";
import { ApiError } from "@/lib/api-client";
import { TemplateFlowDiagram } from "@/components/templates/template-flow-diagram";
import { TemplateButtonReplyDto } from "@/lib/shared-types";

/**
 * The WhatsApp template a task will go out with, shown where the choice
 * actually matters — on the form that sends it.
 *
 * An Admin has no WhatsApp Templates page of their own, so this is the only
 * place they can see or change what their Cadres will receive. Changing it
 * here updates their own assigned template (the same record a Super Admin
 * edits), which is what the send then uses — there is no per-task override,
 * so what you see here is genuinely what goes out.
 */
export function TaskTemplatePicker() {
  const { data: mine, isLoading } = useMyTemplate();
  const { data: available } = useAvailableTemplates();
  const assign = useAssignMessageTemplate();

  const owner = mine?.[0];
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Closed by default here: this is a task form, not a template editor — the
  // flow is a check you ask for, not something to scroll past every time.
  const [flowOpen, setFlowOpen] = useState(false);

  useEffect(() => {
    if (owner?.templateName) setChoice(owner.templateName);
  }, [owner?.templateName]);

  if (isLoading) {
    return <p className="text-xs text-slate-500">Loading template…</p>;
  }
  if (!owner) return null;

  const current = available?.find((t) => t.name === owner.templateName);
  const picked = available?.find((t) => t.name === choice);

  // Prefer the configured replies; fall back to the catalogue's bare labels so
  // the flow still draws for a template nobody has configured yet — it just
  // shows the taps landing nowhere, which is the truth.
  const flowButtons: TemplateButtonReplyDto[] = owner.templateButtons?.length
    ? owner.templateButtons
    : (current?.buttons ?? []).map((label) => ({ label, action: "NONE" as const }));

  const save = () => {
    setError(null);
    if (!choice) {
      setError("Choose a template.");
      return;
    }
    assign.mutate(
      {
        userId: owner.userId,
        templateName: choice,
        templateLanguage: picked?.language ?? owner.templateLanguage ?? "en",
        templateBody: picked?.body ?? undefined,
        // Variable order and button replies belong to the template, not to
        // this one send — keeping whatever is already configured avoids
        // silently resetting them from a form that doesn't show them.
        templateVariables: owner.templateVariables?.length
          ? (owner.templateVariables as never[])
          : undefined,
        templateButtons: owner.templateButtons?.length ? owner.templateButtons : undefined,
      },
      {
        onSuccess: () => setOpen(false),
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : "Could not change the template"),
      },
    );
  };

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Label>WhatsApp template</Label>
          <p className="mt-0.5 text-sm text-slate-800">
            {owner.templateName ?? "Default (polios)"}
            {current?.buttons?.length ? (
              <span className="text-slate-400"> · {current.buttons.join(" / ")}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            What every Cadre on this task receives. Changing it here changes it for your future tasks too.
          </p>
        </div>
        {!open && (
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setFlowOpen((v) => !v)}>
              {flowOpen ? "Hide flow" : "Preview flow"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
              Change
            </Button>
          </div>
        )}
      </div>

      {/* An Admin has no Templates page, so this is the only place they can
          see what their Cadres actually get back when they tap a button. */}
      {flowOpen && !open && (
        <div className="mt-3">
          <TemplateFlowDiagram
            templateName={owner.templateName ?? "polios"}
            buttons={flowButtons}
            bodyPreview={owner.templateBody || current?.body || undefined}
          />
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-white p-3">
          <Label htmlFor="task-template">Approved template</Label>
          <select
            id="task-template"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            <option value="">Select a template…</option>
            {(available ?? []).map((t) => (
              <option key={t.name} value={t.name} disabled={t.status === "REJECTED"}>
                {t.name} ({t.language})
                {t.buttons.length > 0 ? ` · ${t.buttons.join(" / ")}` : ""}
                {t.status && t.status !== "APPROVED" ? ` — ${t.status}` : ""}
              </option>
            ))}
          </select>
          {/* Only approved templates actually send; a pending one is shown
              rather than hidden so it's clear it exists but isn't usable. */}
          {picked && picked.status !== "APPROVED" && (
            <p className="text-xs text-amber-600">
              {picked.name} is {picked.status ?? "not approved"} — sends using it will be rejected by WhatsApp
              until Meta approves it.
            </p>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={assign.isPending}
              onClick={() => {
                setOpen(false);
                setChoice(owner.templateName ?? "");
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={assign.isPending}>
              {assign.isPending ? "Saving…" : "Use this template"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
