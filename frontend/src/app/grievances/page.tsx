"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RegionSelect } from "@/components/region-select";
import {
  Grievance,
  useGrievances,
  useSubmitGrievance,
  useUploadGrievanceAttachments,
  useDecideGrievance,
  useUpdateGrievanceStatus,
  useDeleteGrievance,
} from "@/hooks/use-grievances";
import { ApiError } from "@/lib/api-client";
import { useCurrentUser } from "@/hooks/use-auth";
import { GrievanceCategory, GrievanceStatus } from "@/lib/shared-types";
import { useSearchQuery, matchesQuery } from "@/hooks/use-search-query";

const statusTone = { OPEN: "amber", IN_PROGRESS: "blue", RESOLVED: "green", REJECTED: "red" } as const;
const STATUS_OPTIONS: GrievanceStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"];

// Mirrors GRIEVANCE_ATTACHMENT_TYPES in the backend's attachment-storage.ts —
// the browser pre-filters the picker, the server is what actually enforces it.
const ACCEPTED_FILE_TYPES =
  ".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 5;

const statusLabel = (status: GrievanceStatus) => status.replace("_", " ");

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** Strips the storage URL down to something readable in a link. */
const attachmentLabel = (url: string, index: number) => {
  const extension = url.split(".").pop()?.toUpperCase() ?? "FILE";
  return `Attachment ${index + 1} (${extension})`;
};

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
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const statusFilter = (searchParams.get("status") as GrievanceStatus | null) ?? undefined;

  const { data: allGrievances, isLoading, isError, error } = useGrievances(statusFilter);

  // The header search narrows whatever the status pills already selected —
  // the two filters compose rather than replacing one another.
  const query = useSearchQuery();
  const grievances = useMemo(
    () =>
      (allGrievances ?? []).filter((g) =>
        matchesQuery(query, g.category, g.description, g.region.name, g.submittedBy.name),
      ),
    [allGrievances, query],
  );

  // A Super Admin reviews and decides; they never raise a grievance, so the
  // submission card isn't rendered for them at all. The backend refuses
  // POST /grievances from a Super Admin regardless of what the UI shows.
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const setStatusFilter = (status?: GrievanceStatus) => {
    router.push(status ? `/grievances?status=${status}` : "/grievances");
  };

  return (
    <AppShell>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">
        Grievances
        {query && <span className="font-normal text-slate-400"> — search: &quot;{query}&quot;</span>}
      </h1>

      <div className="mb-6 flex flex-wrap gap-2">
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

      {/* Which layout to show depends entirely on the role, so nothing is
          rendered until the role is known. Guessing wrong for even one frame
          would flash the Submit Grievance form at a Super Admin, who is the
          one person who must never be offered it. */}
      {userLoading || !user ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-500">Loading grievances...</CardContent>
        </Card>
      ) : isSuperAdmin ? (
        <ReviewQueue
          grievances={grievances}
          isLoading={isLoading}
          loadError={isError ? ((error as Error)?.message ?? "Could not load grievances") : null}
          statusFilter={statusFilter}
        />
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="md:col-span-1">
            <SubmitGrievanceCard />
          </div>
          <div className="md:col-span-2">
            <MyGrievances
              grievances={grievances}
              isLoading={isLoading}
              loadError={isError ? ((error as Error)?.message ?? "Could not load grievances") : null}
              statusFilter={statusFilter}
            />
          </div>
        </div>
      )}
    </AppShell>
  );
}

// ============================================================
// ADMIN / CADRE
// ============================================================

const EMPTY_FORM = { regionId: "", category: "", description: "" };

function SubmitGrievanceCard() {
  const submitGrievance = useSubmitGrievance();
  const uploadAttachments = useUploadGrievanceAttachments();

  const [form, setForm] = useState(EMPTY_FORM);
  const [files, setFiles] = useState<File[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isBusy = submitGrievance.isPending || uploadAttachments.isPending;

  const onPickFiles = (selected: File[]) => {
    setFormError(null);
    if (selected.length > MAX_ATTACHMENT_COUNT) {
      setFormError(`Attach at most ${MAX_ATTACHMENT_COUNT} files.`);
      return;
    }
    const tooBig = selected.find((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig) {
      setFormError(`"${tooBig.name}" is larger than 10MB.`);
      return;
    }
    setFiles(selected);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);

    if (!form.regionId) {
      setFormError("Select the area this grievance relates to.");
      return;
    }
    if (!form.category) {
      setFormError("Select a category.");
      return;
    }

    // Upload first, then submit with the returned URLs — a failed upload
    // must not leave a grievance recorded without its evidence.
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

    submitGrievance.mutate(
      { ...form, attachmentUrls },
      {
        onSuccess: () => {
          setForm(EMPTY_FORM);
          setFiles([]);
          setSuccess("Grievance submitted. A Super Admin will review it.");
        },
        onError: (err) => {
          setFormError(err instanceof ApiError ? err.message : "Could not submit the grievance");
        },
      },
    );
  };

  return (
    <Card>
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
            <select
              id="category"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option value="">Select category...</option>
              {GrievanceCategory.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              required
              rows={4}
              placeholder="Enter grievance details..."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="attachments">Attachment — optional</Label>
            <input
              id="attachments"
              type="file"
              multiple
              accept={ACCEPTED_FILE_TYPES}
              onChange={(e) => onPickFiles(e.target.files ? Array.from(e.target.files) : [])}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
            />
            <p className="mt-1 text-xs text-slate-400">PDF, JPG, PNG, DOC or DOCX — up to 10MB each.</p>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((file) => (
                  <li key={file.name} className="flex items-center gap-2 text-xs text-slate-600">
                    <span>📎</span>
                    <span className="truncate">{file.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {formError && <p className="text-xs text-red-600">{formError}</p>}
          {success && <p className="text-xs text-emerald-600">{success}</p>}

          <Button type="submit" className="w-full" disabled={isBusy}>
            {uploadAttachments.isPending
              ? "Uploading attachment..."
              : submitGrievance.isPending
                ? "Submitting..."
                : "Submit"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MyGrievances({
  grievances,
  isLoading,
  loadError,
  statusFilter,
}: {
  grievances?: Grievance[];
  isLoading: boolean;
  loadError: string | null;
  statusFilter?: GrievanceStatus;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          My Grievances{" "}
          <span className="font-normal text-slate-400">({grievances?.length ?? 0})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loadError && <p className="text-xs text-red-600">{loadError}</p>}
        {isLoading && <p className="py-6 text-center text-sm text-slate-500">Loading grievances...</p>}

        {grievances?.map((g) => (
          <div key={g.id} className="rounded-md border border-slate-100 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">
                  {g.category} — {g.region.name}
                  {g.citizen && <span className="font-normal text-slate-500"> ({g.citizen.name})</span>}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{g.description}</p>
                <p className="mt-1 text-xs text-slate-400">Submitted {formatDate(g.createdAt)}</p>
                {g.attachmentUrls.length > 0 && (
                  <AttachmentLinks urls={g.attachmentUrls} className="mt-1" />
                )}
                {g.resolutionNotes && (
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="font-medium">
                      {g.status === "REJECTED" ? "Reason" : "Resolution"}:
                    </span>{" "}
                    {g.resolutionNotes}
                  </p>
                )}
              </div>
              <Badge tone={statusTone[g.status]}>{statusLabel(g.status)}</Badge>
            </div>
          </div>
        ))}

        {!isLoading && !loadError && grievances?.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">
            {statusFilter
              ? `No ${statusLabel(statusFilter).toLowerCase()} grievances.`
              : "You haven't submitted any grievances yet."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// SUPER ADMIN
// ============================================================

type DecisionAction = "resolve" | "reject";

function ReviewQueue({
  grievances,
  isLoading,
  loadError,
  statusFilter,
}: {
  grievances?: Grievance[];
  isLoading: boolean;
  loadError: string | null;
  statusFilter?: GrievanceStatus;
}) {
  const updateStatus = useUpdateGrievanceStatus();
  const deleteGrievance = useDeleteGrievance();

  const [details, setDetails] = useState<Grievance | null>(null);
  const [decision, setDecision] = useState<{ grievance: Grievance; action: DecisionAction } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDelete = (g: Grievance) => {
    if (!window.confirm(`Delete this grievance (${g.category} — ${g.region.name})? This cannot be undone.`)) return;
    setActionError(null);
    deleteGrievance.mutate(g.id, {
      onError: (err) => setActionError(err instanceof ApiError ? err.message : "Failed to delete grievance"),
    });
  };

  const startReview = (g: Grievance) => {
    setActionError(null);
    updateStatus.mutate(
      { id: g.id, status: "IN_PROGRESS" },
      { onError: (err) => setActionError(err instanceof ApiError ? err.message : "Could not update status") },
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            {statusFilter ? `${statusLabel(statusFilter)} Grievances` : "All Grievances"}{" "}
            <span className="font-normal text-slate-400">({grievances?.length ?? 0})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadError && <p className="text-xs text-red-600">{loadError}</p>}
          {actionError && <p className="text-xs text-red-600">{actionError}</p>}
          {isLoading && <p className="py-6 text-center text-sm text-slate-500">Loading grievances...</p>}

          {grievances?.map((g) => {
            const isPending = g.status === "OPEN" || g.status === "IN_PROGRESS";
            return (
              <div key={g.id} className="rounded-md border border-slate-100 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">
                      {g.category} — {g.region.name}
                      {g.citizen && <span className="font-normal text-slate-500"> ({g.citizen.name})</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Submitted by {g.submittedBy.name} ({g.submittedByRole}) · {formatDate(g.createdAt)}
                    </p>
                    <p className="mt-2 text-xs text-slate-600">{g.description}</p>
                    {g.attachmentUrls.length > 0 && (
                      <AttachmentLinks urls={g.attachmentUrls} className="mt-2" />
                    )}
                    {g.resolutionNotes && (
                      <p className="mt-2 text-xs text-slate-500">
                        <span className="font-medium">
                          {g.status === "REJECTED" ? "Reason" : "Resolution"}:
                        </span>{" "}
                        {g.resolutionNotes}
                        {g.resolvedBy && ` — ${g.resolvedBy.name}`}
                      </p>
                    )}
                  </div>
                  <Badge tone={statusTone[g.status]}>{statusLabel(g.status)}</Badge>
                </div>

                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={() => setDetails(g)}>
                    View Details
                  </Button>
                  {g.status === "OPEN" && (
                    <Button
                      variant="secondary"
                      disabled={updateStatus.isPending}
                      onClick={() => startReview(g)}
                    >
                      {updateStatus.isPending ? "Updating..." : "Start Review"}
                    </Button>
                  )}
                  {isPending && (
                    <>
                      <Button onClick={() => setDecision({ grievance: g, action: "resolve" })}>Resolve</Button>
                      <Button variant="danger" onClick={() => setDecision({ grievance: g, action: "reject" })}>
                        Reject
                      </Button>
                    </>
                  )}
                  <Button
                    variant="danger"
                    disabled={deleteGrievance.isPending && deleteGrievance.variables === g.id}
                    onClick={() => handleDelete(g)}
                  >
                    {deleteGrievance.isPending && deleteGrievance.variables === g.id ? "Deleting..." : "Delete"}
                  </Button>
                </div>
              </div>
            );
          })}

          {!isLoading && !loadError && grievances?.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              {statusFilter
                ? `No ${statusLabel(statusFilter).toLowerCase()} grievances.`
                : "No grievances have been submitted yet."}
            </p>
          )}
        </CardContent>
      </Card>

      {details && <GrievanceDetailsModal grievance={details} onClose={() => setDetails(null)} />}
      {decision && (
        <DecisionModal
          grievance={decision.grievance}
          action={decision.action}
          onClose={() => setDecision(null)}
        />
      )}
    </>
  );
}

function GrievanceDetailsModal({ grievance, onClose }: { grievance: Grievance; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Grievance Details</h2>
          <Badge tone={statusTone[grievance.status]}>{statusLabel(grievance.status)}</Badge>
        </div>

        <div className="space-y-4 px-5 py-4">
          <Field label="Category" value={grievance.category} />
          <Field label="Area" value={`${grievance.region.name} (${grievance.region.type})`} />
          <Field
            label="Submitted by"
            value={`${grievance.submittedBy.name} (${grievance.submittedByRole})`}
          />
          <Field label="Submitted" value={formatDate(grievance.createdAt)} />
          {grievance.citizen && <Field label="Citizen" value={grievance.citizen.name} />}
          <Field label="Description" value={grievance.description} />

          <div>
            <p className="text-xs font-medium uppercase text-slate-400">Attachments</p>
            {grievance.attachmentUrls.length > 0 ? (
              <AttachmentLinks urls={grievance.attachmentUrls} className="mt-1" />
            ) : (
              <p className="mt-1 text-sm text-slate-500">No files attached.</p>
            )}
          </div>

          {grievance.resolutionNotes && (
            <Field
              label={grievance.status === "REJECTED" ? "Reason" : "Resolution"}
              value={grievance.resolutionNotes}
            />
          )}
          {grievance.resolvedBy && grievance.resolvedAt && (
            <Field
              label="Decided by"
              value={`${grievance.resolvedBy.name} · ${formatDate(grievance.resolvedAt)}`}
            />
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-5 py-4">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function DecisionModal({
  grievance,
  action,
  onClose,
}: {
  grievance: Grievance;
  action: DecisionAction;
  onClose: () => void;
}) {
  const decide = useDecideGrievance();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isResolve = action === "resolve";

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    decide.mutate(
      { id: grievance.id, action, notes: notes.trim() },
      {
        onSuccess: onClose,
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : `Could not ${action} this grievance`),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-lg">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">
            {isResolve ? "Resolve Grievance" : "Reject Grievance"}
          </h2>
        </div>

        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-medium uppercase text-slate-400">Grievance</p>
            <p className="text-sm text-slate-800">
              {grievance.category} — {grievance.region.name}
            </p>
          </div>

          <div>
            <Label htmlFor="resolution-notes">
              {isResolve ? "Resolution / Remarks" : "Reason for rejection"}
            </Label>
            <Textarea
              id="resolution-notes"
              required
              rows={4}
              autoFocus
              placeholder={isResolve ? "Enter resolution details..." : "Explain why this is being rejected..."}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            {/* The submitter is notified with this text, so an empty note
                would reach them as a decision with no explanation. */}
            <p className="mt-1 text-xs text-slate-400">This is sent to the person who submitted the grievance.</p>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} disabled={decide.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={isResolve ? "primary" : "danger"}
              disabled={decide.isPending || !notes.trim()}
            >
              {decide.isPending ? (isResolve ? "Resolving..." : "Rejecting...") : isResolve ? "Resolve" : "Reject"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================

function AttachmentLinks({ urls, className }: { urls: string[]; className?: string }) {
  return (
    <ul className={className}>
      {urls.map((url, index) => (
        <li key={url}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
          >
            📎 {attachmentLabel(url, index)}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className="whitespace-pre-line text-sm text-slate-800">{value}</p>
    </div>
  );
}
