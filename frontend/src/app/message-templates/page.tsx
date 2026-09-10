"use client";

import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  useMessageTemplates,
  useAssignMessageTemplate,
  useClearMessageTemplate,
  useAvailableTemplates,
  useSyncTemplates,
  TemplateOwner,
  AvailableTemplate,
} from "@/hooks/use-message-templates";

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : "Something went wrong";
}

// The one body variable every assignment template takes is the Cadre's name,
// so the preview substitutes a sample name for {{1}} — showing the Super
// Admin what a Cadre will actually read, not the raw placeholder.
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
  // Free typing stays available even with a synced catalogue — a template
  // approved a minute ago won't be in the last sync, and blocking it would
  // be worse than allowing a name that might be wrong.
  const [manual, setManual] = useState(false);
  const usePicker = available.length > 0 && !manual;

  // Choosing from the catalogue fills language and body too, so the Super
  // Admin never retypes copy that the provider already knows.
  const pick = (templateName: string) => {
    const match = available.find((t) => t.name === templateName);
    setName(templateName);
    if (match) {
      setLanguage(match.language);
      setBody(match.body ?? "");
    }
  };

  const startEditing = () => {
    setName(owner.templateName ?? "");
    setLanguage(owner.templateLanguage ?? "en");
    setBody(owner.templateBody ?? "");
    assign.reset();
    setEditing(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    assign.mutate(
      { userId: owner.userId, templateName: name.trim(), templateLanguage: language.trim() || "en", templateBody: body },
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
