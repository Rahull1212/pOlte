"use client";

import { useState } from "react";
import { ButtonReplyAction, TemplateButtonReplyDto, TemplateVariableSource } from "@/lib/shared-types";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { TemplateFlowDiagram } from "@/components/templates/template-flow-diagram";
import {
  useMessageTemplates,
  useAssignMessageTemplate,
  useClearMessageTemplate,
  useAvailableTemplates,
  useSyncTemplates,
  TemplateOwner,
  AvailableTemplate,
} from "@/hooks/use-message-templates";

// Matches TemplateVariableSource in shared-types. Labels are what the Super
// Admin picks from; the value is what the backend fills the slot with.
const VARIABLE_SOURCES: { value: TemplateVariableSource; label: string; example: string }[] = [
  { value: "CADRE_NAME", label: "Cadre's name", example: "Sai" },
  { value: "TASK_NAME", label: "Task name", example: "Collect Ward IDs" },
  { value: "DEADLINE", label: "Deadline", example: "22 Sept" },
  { value: "PRIORITY", label: "Priority", example: "Urgent" },
  { value: "ASSIGNED_BY", label: "Assigning Admin", example: "Sai Ganesh" },
];

const DEFAULT_ORDER: TemplateVariableSource[] = ["CADRE_NAME", "TASK_NAME", "DEADLINE"];

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : "Something went wrong";
}

// The one body variable every assignment template takes is the Cadre's name,
// so the preview substitutes a sample name for {{1}} — showing the Super
// Admin what a Cadre will actually read, not the raw placeholder.
/**
 * A sensible starting action for a freshly-picked template, guessed from
 * the button's own wording. Only a default — the Super Admin can change
 * any of them, and a button we can't guess starts as "no reply" rather
 * than sending something wrong.
 */
function defaultActionFor(label: string): ButtonReplyAction {
  const l = label.toLowerCase();
  if (l.includes("task") || l.includes("detail") || l.includes("view")) return "TASK_DETAILS";
  if (l.includes("admin") || l.includes("contact") || l.includes("call")) return "ADMIN_CONTACT";
  return "NONE";
}

const ACTION_LABELS: Record<ButtonReplyAction, string> = {
  TASK_DETAILS: "Send the task details",
  ADMIN_CONTACT: "Send their Admin's contact",
  CUSTOM_TEXT: "Send a custom message",
  NONE: "Do nothing",
};

function preview(body: string): string {
  return body.replace(/\{\{1\}\}/g, "Ravi").replace(/\{\{(\d+)\}\}/g, "…");
}

function OwnerRow({ owner, available }: { owner: TemplateOwner; available: AvailableTemplate[] }) {
  const assign = useAssignMessageTemplate();
  const clear = useClearMessageTemplate();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(owner.templateName ?? "");
  const [language, setLanguage] = useState(owner.templateLanguage ?? "en");
  const [body, setBody] = useState(owner.templateBody ?? "");
  const [variables, setVariables] = useState<TemplateVariableSource[]>(
    (owner.templateVariables ?? []) as TemplateVariableSource[],
  );
  // What each Quick Reply answers with. Keyed by the button's label, since
  // that is what actually arrives on a tap.
  const [buttons, setButtons] = useState<TemplateButtonReplyDto[]>(owner.templateButtons ?? []);
  // Free typing stays available even with a synced catalogue — a template
  // approved a minute ago won't be in the last sync, and blocking it would
  // be worse than allowing a name that might be wrong.
  const [manual, setManual] = useState(false);
  // Open by default: the whole point is that you see the flow while editing
  // it, not that you go looking for it.
  const [flowOpen, setFlowOpen] = useState(true);
  const usePicker = available.length > 0 && !manual;

  // Choosing from the catalogue fills language and body too, so the Super
  // Admin never retypes copy that the provider already knows.
  const pick = (templateName: string) => {
    const match = available.find((t) => t.name === templateName);
    setName(templateName);
    if (match) {
      setLanguage(match.language);
      setBody(match.body ?? "");
      // Seed one slot per declared variable with the conventional order, so
      // a template is usable without touching the dropdowns.
      const count = match.variables ?? 1;
      setVariables(Array.from({ length: count }, (_, i) => DEFAULT_ORDER[i] ?? "CADRE_NAME"));
      // One row per approved button, keeping any reply already configured
      // for a button of the same name.
      setButtons(
        (match.buttons ?? []).map((label) => {
          const existing = (owner.templateButtons ?? []).find(
            (b) => b.label.trim().toLowerCase() === label.trim().toLowerCase(),
          );
          return existing ?? { label, action: defaultActionFor(label) };
        }),
      );
    }
  };

  /**
   * One row per Quick Reply the SELECTED template declares, carrying
   * whatever reply is currently configured for it.
   *
   * Derived from the synced catalogue rather than from saved config: an
   * Admin whose template was assigned before button replies existed has no
   * saved config, and keying off that alone hid the whole section from
   * them until they re-picked the template.
   */
  const buttonRows: TemplateButtonReplyDto[] = (
    available.find((t) => t.name === name)?.buttons ?? buttons.map((b) => b.label)
  ).map((label) => {
    const configured = buttons.find(
      (b) => b.label.trim().toLowerCase() === label.trim().toLowerCase(),
    );
    return configured ?? { label, action: defaultActionFor(label) };
  });

  // Which buttons currently have their context box open. A button with
  // saved wording counts as open, so reopening the form shows what is
  // already there rather than hiding it behind the +.
  const [contextOpen, setContextOpen] = useState<string[]>([]);
  const hasContext = (b: TemplateButtonReplyDto) =>
    Boolean(b.text?.length) || contextOpen.includes(b.label) || b.action === "CUSTOM_TEXT";

  const toggleContext = (label: string) => {
    const row = buttonRows.find((b) => b.label === label);
    // Closing it clears the wording — leaving hidden text that still sends
    // would be worse than losing a sentence the user chose to discard.
    if (row && hasContext(row)) {
      updateButton(label, { text: undefined });
      setContextOpen((current) => current.filter((l) => l !== label));
      return;
    }
    setContextOpen((current) => [...current, label]);
  };

  /** Updates one button's config, inserting it if it wasn't saved before. */
  const updateButton = (label: string, patch: Partial<TemplateButtonReplyDto>) =>
    setButtons((current) => {
      const existing = current.find((b) => b.label.trim().toLowerCase() === label.trim().toLowerCase());
      if (existing) {
        return current.map((b) => (b === existing ? { ...b, ...patch } : b));
      }
      return [...current, { label, action: defaultActionFor(label), ...patch }];
    });

  // How many {{n}} the selected template declares — from the sync, so the
  // form asks for exactly the right number.
  const variableSlots = Array.from(
    { length: available.find((t) => t.name === name)?.variables ?? Math.max(variables.length, 1) },
    (_, i) => i,
  );

  const startEditing = () => {
    setName(owner.templateName ?? "");
    setLanguage(owner.templateLanguage ?? "en");
    setBody(owner.templateBody ?? "");
    setVariables((owner.templateVariables ?? []) as TemplateVariableSource[]);
    setButtons(owner.templateButtons ?? []);
    assign.reset();
    setEditing(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    assign.mutate(
      {
        userId: owner.userId,
        templateName: name.trim(),
        templateLanguage: language.trim() || "en",
        templateBody: body,
        // Only the slots this template actually declares are sent; trailing
        // entries left over from a previously-selected template would make
        // the count wrong.
        templateVariables: variableSlots.map((_, i) => variables[i] ?? DEFAULT_ORDER[i] ?? "CADRE_NAME"),
        templateButtons: buttonRows,
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CardTitle>{owner.name}</CardTitle>
          <Badge tone={owner.role === "SUPER_ADMIN" ? "blue" : "slate"}>
            {owner.role === "SUPER_ADMIN" ? "Super Admin" : "Admin"}
          </Badge>
          {owner.isSelf && <Badge tone="slate">You</Badge>}
        </div>
        <span className="text-xs text-slate-400">{owner.area}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {!editing && (
          <>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium uppercase text-slate-400">Template</p>
                {owner.templateName ? (
                  <code className="text-slate-800">{owner.templateName}</code>
                ) : (
                  <p className="text-slate-500">Not assigned — uses the default</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-slate-400">Language</p>
                <p className="text-slate-700">{owner.templateLanguage ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-slate-400">Cadre sees</p>
                <p className="text-slate-700">{owner.templateBody ? preview(owner.templateBody) : "—"}</p>
              </div>
            </div>
            {errorMessage(clear.error) && <p className="text-sm text-red-600">{errorMessage(clear.error)}</p>}
            <div className="flex justify-end gap-2">
              {owner.templateName && (
                <Button
                  variant="secondary"
                  onClick={() => clear.mutate(owner.userId)}
                  disabled={clear.isPending}
                >
                  {clear.isPending ? "Removing…" : "Remove"}
                </Button>
              )}
              <Button variant={owner.templateName ? "secondary" : "primary"} onClick={startEditing}>
                {owner.templateName ? "Change" : "Assign template"}
              </Button>
            </div>
          </>
        )}

        {editing && (
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <Label htmlFor={`name-${owner.userId}`} className="mb-0">
                    Approved template name
                  </Label>
                  {available.length > 0 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-brand-600 hover:underline"
                      onClick={() => setManual((v) => !v)}
                    >
                      {usePicker ? "Type a name instead" : "Pick from synced list"}
                    </button>
                  )}
                </div>
                {usePicker ? (
                  <select
                    id={`name-${owner.userId}`}
                    value={name}
                    onChange={(e) => pick(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    required
                  >
                    <option value="">Select a template…</option>
                    {available.map((t) => (
                      <option key={t.name} value={t.name} disabled={Boolean(t.status && t.status !== "APPROVED")}>
                        {t.name} ({t.language})
                        {t.buttons.length > 0 ? ` · ${t.buttons.join(" / ")}` : ""}
                        {t.status && t.status !== "APPROVED" ? ` — ${t.status.toLowerCase()}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={`name-${owner.userId}`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="polios_east"
                    required
                  />
                )}
              </div>
              <div>
                <Label htmlFor={`lang-${owner.userId}`}>Language</Label>
                <Input
                  id={`lang-${owner.userId}`}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="en"
                />
              </div>
            </div>
            {/* One row per {{n}} the template declares — the count comes from
                the sync, so the form always asks for exactly the right
                number and a mismatch (a hard 400 from Fyxo) can't happen. */}
            <div>
              <Label className="mb-1">What goes in each variable</Label>
              <div className="space-y-2">
                {variableSlots.map((i) => (
                  <div key={i} className="flex items-center gap-2">
                    <code className="w-12 shrink-0 rounded bg-slate-100 px-1.5 py-1 text-center text-xs text-slate-700">
                      {`{{${i + 1}}}`}
                    </code>
                    <select
                      value={variables[i] ?? DEFAULT_ORDER[i] ?? "CADRE_NAME"}
                      onChange={(e) => {
                        const next = [...variables];
                        next[i] = e.target.value as TemplateVariableSource;
                        setVariables(next);
                      }}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      {VARIABLE_SOURCES.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label} — e.g. {v.example}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {variableSlots.length === 1
                  ? "This template takes one variable."
                  : `This template takes ${variableSlots.length} variables.`}{" "}
                Match them to the approved wording — the order must be exactly what Meta approved, or the send is
                rejected.
              </p>
            </div>

            {/* What each Quick Reply answers with. Shown only when the
                selected template actually has buttons — a template without
                them has nothing to configure. */}
            {buttonRows.length > 0 && (
              <div>
                <Label>What each button replies with</Label>
                <div className="mt-1 space-y-2">
                  {buttonRows.map((button) => (
                    <div key={button.label} className="rounded-md border border-slate-200 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {button.label}
                        </span>
                        <select
                          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                          value={button.action}
                          onChange={(e) =>
                            updateButton(button.label, { action: e.target.value as ButtonReplyAction })
                          }
                        >
                          {(Object.keys(ACTION_LABELS) as ButtonReplyAction[]).map((action) => (
                            <option key={action} value={action}>
                              {ACTION_LABELS[action]}
                            </option>
                          ))}
                        </select>
                        {/* Context can be added to ANY button, not just a
                            custom-message one — it's appended to whatever
                            the action produces. The + is always available so
                            a one-off instruction never needs the action to
                            be changed first. */}
                        {button.action !== "CUSTOM_TEXT" && (
                        <button
                          type="button"
                          aria-label={`Add a message to the "${button.label}" button`}
                          title="Add your own message to this button"
                          onClick={() => toggleContext(button.label)}
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-lg leading-none transition ${
                            hasContext(button)
                              ? "border-brand-300 bg-brand-50 text-brand-700"
                              : "border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                          }`}
                        >
                          {hasContext(button) ? "−" : "+"}
                        </button>
                        )}
                      </div>
                      {hasContext(button) && (
                        <>
                          <Textarea
                            className="mt-2"
                            rows={2}
                            placeholder={
                              button.action === "NONE"
                                ? "The message the Cadre receives when they tap this"
                                : "Extra wording sent after the action's message"
                            }
                            value={button.text ?? ""}
                            onChange={(e) => updateButton(button.label, { text: e.target.value })}
                          />
                          {button.action !== "NONE" && button.action !== "CUSTOM_TEXT" && (
                            <p className="mt-1 text-xs text-slate-400">
                              Sent after the {ACTION_LABELS[button.action].toLowerCase()}, as part of the same
                              reply.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Sent as a normal WhatsApp reply the moment the Cadre taps. A button set to &ldquo;Do
                  nothing&rdquo; is left to the Fyxo flow to answer.
                </p>
              </div>
            )}

            <div>
              <Label htmlFor={`body-${owner.userId}`}>Approved body text (optional)</Label>
              <Textarea
                id={`body-${owner.userId}`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Hi {{1}}, we have assigned a task to you please check"
              />
              <p className="mt-1 text-xs text-slate-500">
                Copy it exactly as approved, <code>{"{{1}}"}</code> included. It is never sent — WhatsApp uses the
                approved copy on Meta&apos;s side. PoliOS only uses this to show what the Cadre reads and to write it
                into the Google Sheet log.
              </p>
            </div>

            {/* PoliOS sends exactly one variable (the Cadre's name), so a
                template expecting a different number would fail at send
                time. Caught here, while it can still be changed. */}
            {(() => {
              const picked = available.find((t) => t.name === name);
              if (!picked || picked.variables === null || picked.variables === 1) return null;
              return (
                <p className="text-sm text-amber-700">
                  Heads up: <code>{picked.name}</code> expects {picked.variables} variables, but PoliOS sends exactly
                  one (the Cadre&apos;s name). Messages using it will be rejected by WhatsApp.
                </p>
              );
            })()}

            {/* The three fields above describe the send in pieces — a name, a
                body, a list of actions — and none of them shows what a Cadre
                actually experiences. Drawn as one flow it's obvious, and it
                redraws as the actions and wording are edited, so a wrong
                action is caught here rather than after a thousand sends. */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>How this message is sent</Label>
                <button
                  type="button"
                  onClick={() => setFlowOpen((v) => !v)}
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  {flowOpen ? "Hide preview" : "Show preview"}
                </button>
              </div>
              {flowOpen && (
                <div className="mt-2">
                  <TemplateFlowDiagram
                    templateName={name || owner.templateName || "polios"}
                    buttons={buttonRows}
                    bodyPreview={body || available.find((t) => t.name === name)?.body || undefined}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Follow a branch to read what that button replies with. Edits above redraw it straight away.
                  </p>
                </div>
              )}
            </div>

            {errorMessage(assign.error) && <p className="text-sm text-red-600">{errorMessage(assign.error)}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={assign.isPending}>
                {assign.isPending ? "Saving…" : "Save template"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Super Admin's assignment of one approved WhatsApp template per Admin.
 *
 * The template follows whoever CREATED a task, mirroring the Google Sheet's
 * tab rule: a task the Super Admin creates goes out with the Super Admin's
 * template even though an Admin is the one allocating it, while a task an
 * Admin creates themselves uses their own.
 */
export default function MessageTemplatesPage() {
  const { data: owners, isLoading } = useMessageTemplates();
  const { data: available } = useAvailableTemplates();
  const sync = useSyncTemplates();

  const catalogue = available ?? [];
  const lastSynced = catalogue[0]?.syncedAt ?? null;

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-slate-900">WhatsApp Templates</h1>
        <p className="mt-1 text-sm text-slate-500">
          Each Admin owns one approved WhatsApp template, assigned here and nowhere else. When a task is allocated to
          Cadres, it goes out with the template belonging to whoever <span className="font-medium">created</span> that
          task — yours for tasks you create and route to an Admin, the Admin&apos;s own for tasks they create
          themselves. Anyone without a template assigned uses the shared default (<code>polios</code>).
        </p>
        <p className="mt-2 text-xs text-slate-500">
          A template must already be approved in Fyxo/Meta — PoliOS can only point at one by name, it can&apos;t create
          or approve it. Every template must take a single variable, <code>{"{{1}}"}</code>, the Cadre&apos;s name. The
          same template can be shared by as many Admins as you like.
        </p>
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="text-sm">
            <p className="font-medium text-slate-800">
              {catalogue.length > 0
                ? `${catalogue.length} template${catalogue.length === 1 ? "" : "s"} available`
                : "No templates synced yet"}
            </p>
            <p className="text-xs text-slate-500">
              {lastSynced
                ? `Last synced ${new Date(lastSynced).toLocaleString()} from ${catalogue[0].source}.`
                : "Fetch your approved templates so they can be picked from a list instead of typed."}
            </p>
          </div>
          <Button variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? "Syncing…" : "Sync templates"}
          </Button>
        </CardContent>
      </Card>

      {/* The sync result is the whole point of the button when nothing can be
          fetched, so it's shown in full rather than reduced to a toast. */}
      {sync.data && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            sync.data.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {sync.data.message}
        </div>
      )}
      {errorMessage(sync.error) && <p className="mb-4 text-sm text-red-600">{errorMessage(sync.error)}</p>}

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      <div className="space-y-4">
        {owners?.map((owner) => (
          <OwnerRow key={owner.userId} owner={owner} available={catalogue} />
        ))}
      </div>
    </AppShell>
  );
}
