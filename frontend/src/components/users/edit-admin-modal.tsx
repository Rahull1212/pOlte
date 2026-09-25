"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { RegionSelect } from "@/components/region-select";
import { useManagedUser, useUpdateManagedUser } from "@/hooks/use-users";
import { ApiError } from "@/lib/api-client";

/**
 * Renaming an Admin, moving their area, or reactivating a deactivated
 * account.
 *
 * Deliberately narrow: phone number and role are not editable here. A phone
 * number is the login identity and has its own verified change flow
 * (OTP-confirmed, see PhoneChangeCard); changing a role would move someone
 * between permission models and silently orphan the work scoped to them.
 * Neither belongs behind a quiet inline form.
 */
export function EditAdminModal({
  userId,
  roleNoun,
  onClose,
}: {
  userId: string;
  roleNoun: string;
  onClose: () => void;
}) {
  const { data: user, isLoading } = useManagedUser(userId);
  const update = useUpdateManagedUser();

  const [form, setForm] = useState({ name: "", regionId: "", isActive: true });
  const [error, setError] = useState<string | null>(null);

  // Seeded once loaded; the form owns the values afterwards so a background
  // refetch can't overwrite what's being typed.
  useEffect(() => {
    if (!user) return;
    setForm({ name: user.name, regionId: user.regionId, isActive: user.isActive });
  }, [user]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError("Name can't be empty.");
      return;
    }
    update.mutate(
      { id: userId, name: form.name.trim(), regionId: form.regionId, isActive: form.isActive },
      {
        onSuccess: onClose,
        onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save changes"),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-lg">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Edit {roleNoun}</h2>
        </div>

        {isLoading ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">Loading…</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
            <div>
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                required
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="edit-region">Assigned area</Label>
              <RegionSelect
                id="edit-region"
                value={form.regionId}
                onChange={(regionId) => setForm({ ...form, regionId })}
              />
            </div>

            {/* Phone is the login identity and changes through its own
                OTP-verified flow, so it's shown read-only rather than
                silently absent. */}
            {user && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium uppercase text-slate-400">Phone (login)</p>
                <p className="text-sm text-slate-700">{user.phone}</p>
              </div>
            )}

            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Account is active
            </label>
            {!form.isActive && (
              <p className="text-xs text-amber-600">
                A deactivated {roleNoun.toLowerCase()} cannot sign in. This is also how an account is prepared
                for permanent deletion.
              </p>
            )}

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={onClose} disabled={update.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
