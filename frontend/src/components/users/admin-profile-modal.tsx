"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useManagedUser } from "@/hooks/use-users";
import { ROLE_LABELS } from "@/hooks/use-auth";

/**
 * Everything the Super Admin can see about one Admin, opened from the
 * three-dot menu on the Admins table.
 *
 * A modal rather than a route: you are inspecting a row of the table you're
 * looking at, and closing it should put you back on that exact filtered
 * table rather than re-running the page.
 *
 * Fields are fetched fresh by id rather than passed down from the row, so
 * the profile shows current data even if the list behind it is stale.
 */
export function AdminProfileModal({
  userId,
  onClose,
  onEdit,
}: {
  userId: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { data: user, isLoading, isError, error } = useManagedUser(userId);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-800">
              {user?.name ?? "Profile"}
            </h2>
            <p className="text-xs text-slate-400">{user ? ROLE_LABELS[user.role] : "Loading…"}</p>
          </div>
          {user && <Badge tone={user.isActive ? "green" : "slate"}>{user.isActive ? "Active" : "Inactive"}</Badge>}
        </div>

        <div className="px-5 py-4">
          {isLoading && <p className="py-8 text-center text-sm text-slate-500">Loading profile…</p>}
          {isError && (
            <p className="py-8 text-center text-sm text-red-600">
              {(error as Error)?.message ?? "Could not load this profile"}
            </p>
          )}

          {user && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Profile information
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Name" value={user.name} />
                <Field label="Phone number" value={user.phone} />
                <Field label="Email" value={user.email} />
                <Field label="Role" value={ROLE_LABELS[user.role]} />
                <Field label="Status" value={user.isActive ? "Active" : "Inactive"} />
                <Field label="Joined" value={formatDate(user.createdAt)} />
                <Field
                  label="Assigned area"
                  value={user.region ? `${user.region.name} (${user.region.type})` : null}
                />
                <Field label="Created by" value={user.parent?.name} />
                {/* Null means never signed in — normal for a Cadre, who works
                    entirely in WhatsApp, but worth noticing on an Admin. */}
                <Field
                  label="Last login"
                  value={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never signed in"}
                />
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium uppercase text-slate-400">Admin ID</p>
                  <p className="font-mono text-xs text-slate-600">{user.id}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4">
          {user && (
            <Link href={`/message-log?q=${encodeURIComponent(user.phone)}`}>
              <Button variant="secondary">Their messages</Button>
            </Link>
          )}
          <Button variant="secondary" onClick={onEdit}>
            Edit
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className="text-sm text-slate-800">{value || "—"}</p>
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
