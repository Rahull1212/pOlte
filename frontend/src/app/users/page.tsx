"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RegionSelect } from "@/components/region-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { OverflowMenu, OverflowMenuItem } from "@/components/overflow-menu";
import { AdminProfileModal } from "@/components/users/admin-profile-modal";
import { EditAdminModal } from "@/components/users/edit-admin-modal";
import { useCurrentUser, ROLE_LABELS } from "@/hooks/use-auth";
import { useManagedUsers, useCreateManagedUser, useDeactivateUser, useDeleteUser, ManagedUser } from "@/hooks/use-users";
import { ApiError } from "@/lib/api-client";
import { useSearchQuery, matchesQuery } from "@/hooks/use-search-query";

interface CreateForm {
  name: string;
  phone: string;
  password: string;
  regionId: string;
}

/**
 * The create form, in a modal rather than a permanent side card so the list
 * owns the page. Same backdrop/card treatment as ConfirmDialog — this needs a
 * form rather than a message, so it doesn't reuse that component, but it
 * deliberately matches it.
 */
function CreateUserModal({
  roleNoun,
  isCadre,
  form,
  setForm,
  onSubmit,
  onCancel,
  isPending,
  error,
}: {
  roleNoun: string;
  isCadre: boolean;
  form: CreateForm;
  setForm: (form: CreateForm) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  isPending: boolean;
  error: string | null;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-lg">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Create {roleNoun}</h2>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="regionId">Area</Label>
            <RegionSelect value={form.regionId} onChange={(regionId) => setForm({ ...form, regionId })} />
          </div>
          {isCadre ? (
            <p className="text-xs text-slate-400">
              Cadres work entirely from WhatsApp and never need a password — one isn&apos;t asked for here.
            </p>
          ) : (
            <div>
              <Label htmlFor="password">Temporary password</Label>
              <Input id="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : `Create ${roleNoun}`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// useSearchParams() opts a page out of static generation unless it's inside
// a Suspense boundary — `next build` fails without this wrapper (dev mode
// doesn't enforce it, which is why this only ever showed up in a real build).
export default function UsersPage() {
  return (
    <Suspense fallback={null}>
      <UsersPageContent />
    </Suspense>
  );
}

function UsersPageContent() {
  const { data: currentUser } = useCurrentUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  // A Super Admin can look at either bucket; an Admin only ever manages
  // Cadres, so the URL param is ignored for them.
  const requestedRole = searchParams.get("role") === "CADRE" ? "CADRE" : "ADMIN";
  const targetRole = currentUser?.role === "SUPER_ADMIN" ? requestedRole : "CADRE";

  const { data: users, isLoading } = useManagedUsers(targetRole);
  const createUser = useCreateManagedUser();
  const deactivate = useDeactivateUser();
  const deleteUser = useDeleteUser();
  const [form, setForm] = useState({ name: "", phone: "", password: "Password@123", regionId: "" });
  // The create form lives in a modal rather than a permanent side card, so
  // the table gets the full width and the page opens on the list — which is
  // what someone comes here to read.
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Both destructive actions (deactivate, permanently delete) go through the
  // same confirm step instead of firing on click — deactivating especially
  // had no confirmation at all before, and this is where their distinct,
  // deliberately-worded copy lives.
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string; action: "deactivate" | "delete" } | null>(null);
  // Which row's profile / edit dialog is open, by user id.
  const [profileId, setProfileId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const isCadreForm = targetRole === "CADRE";

  /**
   * The three-dot menu for one row.
   *
   * Deactivate stays in the list rather than being dropped: the backend
   * refuses to delete an account that is still active (UsersService.remove),
   * so removing it entirely would make Delete permanently unreachable. It's
   * simply no longer a standing red button on every row.
   */
  const actionsFor = (u: ManagedUser): OverflowMenuItem[] => {
    const items: OverflowMenuItem[] = [
      { label: "View Profile", onClick: () => setProfileId(u.id) },
      { label: "Dashboard", onClick: () => router.push(`/users/${u.id}/dashboard`) },
      { label: "Edit", onClick: () => setEditId(u.id) },
    ];

    if (u.isActive) {
      items.push({
        label: "Deactivate",
        onClick: () => setConfirmTarget({ id: u.id, name: u.name, action: "deactivate" }),
        tone: "danger",
      });
    } else if (currentUser?.role === "SUPER_ADMIN") {
      // Only offered once the account is already deactivated, mirroring what
      // the API will actually allow.
      items.push({
        label: "Delete Permanently",
        onClick: () => setConfirmTarget({ id: u.id, name: u.name, action: "delete" }),
        tone: "danger",
      });
    }
    return items;
  };

  const query = useSearchQuery();
  const visibleUsers = useMemo(
    () => (users ?? []).filter((u) => matchesQuery(query, u.name, u.phone, u.region?.name)),
    [users, query],
  );

  const resetForm = () => setForm({ name: "", phone: "", password: "Password@123", regionId: "" });

  const closeCreate = () => {
    setCreateOpen(false);
    resetForm();
    // Clear a failed attempt's message so reopening starts clean.
    createUser.reset();
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createUser.mutate(
      // A Cadre works entirely from WhatsApp and never logs in with a
      // password — the backend generates one on its own for a Cadre
      // regardless, so there's nothing meaningful to send here.
      { ...form, password: isCadreForm ? undefined : form.password, role: targetRole },
      // The list refreshes itself (useCreateManagedUser invalidates ["users"]),
      // so success only has to dismiss the modal.
      { onSuccess: closeCreate },
    );
  };

  const roleNoun = ROLE_LABELS[targetRole];

  const runConfirmedAction = () => {
    if (!confirmTarget) return;
    setDeleteError(null);
    if (confirmTarget.action === "deactivate") {
      deactivate.mutate(confirmTarget.id, {
        onSuccess: () => setConfirmTarget(null),
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : "Failed to deactivate";
          setDeleteError(`${confirmTarget.name}: ${message}`);
          setConfirmTarget(null);
        },
      });
    } else {
      deleteUser.mutate(confirmTarget.id, {
        onSuccess: () => setConfirmTarget(null),
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : "Failed to delete";
          setDeleteError(`${confirmTarget.name}: ${message}`);
          setConfirmTarget(null);
        },
      });
    }
  };

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-900">
          {targetRole === "ADMIN" ? "Manage Admins" : "Manage Cadres"}
          {query && <span className="font-normal text-slate-400"> — search: &quot;{query}&quot;</span>}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {currentUser?.role === "SUPER_ADMIN" && (
            <>
              <button
                onClick={() => router.push("/users")}
                className={`rounded-full px-3 py-1 text-xs ${
                  targetRole === "ADMIN" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                Admins
              </button>
              <button
                onClick={() => router.push("/users?role=CADRE")}
                className={`rounded-full px-3 py-1 text-xs ${
                  targetRole === "CADRE" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                Cadres
              </button>
            </>
          )}
          <Button onClick={() => setCreateOpen(true)}>+ Create {roleNoun}</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {ROLE_LABELS[targetRole]}s{" "}
            <span className="font-normal text-slate-400">({visibleUsers.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {deleteError && <p className="px-5 pt-3 text-xs text-red-600">{deleteError}</p>}
          {/* Now that the table spans the full width, it scrolls inside its
              own container on narrow screens rather than widening the page. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-2">Name</th>
                  <th className="px-5 py-2">Phone</th>
                  <th className="px-5 py-2">Area</th>
                  <th className="px-5 py-2">Joined</th>
                  <th className="px-5 py-2">Status</th>
                  <th className="px-5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => (
                  <tr key={u.id} className="border-b border-slate-50">
                    <td className="px-5 py-2 font-medium text-slate-800">{u.name}</td>
                    <td className="px-5 py-2">{u.phone}</td>
                    <td className="px-5 py-2">
                      {u.region ? `${u.region.name} (${u.region.type})` : "—"}
                    </td>
                    <td className="px-5 py-2 text-slate-500">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-2">
                      <Badge tone={u.isActive ? "green" : "slate"}>{u.isActive ? "Active" : "Inactive"}</Badge>
                    </td>
                    <td className="px-5 py-2">
                      {/* Actions moved behind a three-dot menu: the row used
                          to carry a standing red Deactivate button, which put
                          the most destructive action one stray click away on
                          every line of the table. */}
                      <div className="flex justify-end">
                        <OverflowMenu items={actionsFor(u)} />
                      </div>
                    </td>
                  </tr>
                ))}
                {!isLoading && visibleUsers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                      {query ? `No one matches "${query}".` : "None yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {profileId && (
        <AdminProfileModal
          userId={profileId}
          onClose={() => setProfileId(null)}
          // Editing from the profile swaps one dialog for the other rather
          // than stacking them.
          onEdit={() => {
            setEditId(profileId);
            setProfileId(null);
          }}
        />
      )}

      {editId && (
        <EditAdminModal userId={editId} roleNoun={roleNoun} onClose={() => setEditId(null)} />
      )}

      {createOpen && (
        <CreateUserModal
          roleNoun={roleNoun}
          isCadre={isCadreForm}
          form={form}
          setForm={setForm}
          onSubmit={onSubmit}
          onCancel={closeCreate}
          isPending={createUser.isPending}
          error={createUser.isError ? (createUser.error as Error).message : null}
        />
      )}

      {confirmTarget?.action === "deactivate" && (
        <ConfirmDialog
          title={`Deactivate ${roleNoun}?`}
          message={`This will deactivate the ${roleNoun.toLowerCase()} and prevent them from receiving new assignments. Their existing assignments, reports, history, and records will be preserved.`}
          confirmLabel={deactivate.isPending ? "Deactivating…" : "Deactivate"}
          destructive
          isPending={deactivate.isPending}
          onConfirm={runConfirmedAction}
          onCancel={() => setConfirmTarget(null)}
        />
      )}

      {confirmTarget?.action === "delete" && (
        <ConfirmDialog
          title={`Permanently delete "${confirmTarget.name}"?`}
          message="This will permanently remove the account and cannot be undone. Their phone number will become available for reuse."
          confirmLabel={deleteUser.isPending ? "Deleting…" : "Permanently Delete"}
          destructive
          isPending={deleteUser.isPending}
          onConfirm={runConfirmedAction}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </AppShell>
  );
}
