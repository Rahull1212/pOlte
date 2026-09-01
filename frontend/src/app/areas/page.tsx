"use client";

import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/use-auth";
import { useRegions, useCreateRegion, useUpdateRegion, useDeleteRegion, RegionItem } from "@/hooks/use-regions";
import { useCreateManagedUser } from "@/hooks/use-users";
import { RegionType } from "@/lib/shared-types";
import { ApiError } from "@/lib/api-client";
import { OverflowMenu, OverflowMenuItem } from "@/components/overflow-menu";

const TYPE_LABELS: Record<RegionType, string> = {
  STATE: "State",
  DISTRICT: "District",
  CONSTITUENCY: "Constituency",
  MANDAL: "Mandal",
  BOOTH: "Booth",
};

// Enforced hierarchy: State -> District -> Mandal -> Booth. Mandal's parent
// is District (not Constituency) — no entry for STATE since it's the root
// and can never have a parent. Mirrors REQUIRED_PARENT_TYPE in
// backend/src/regions/regions.service.ts, which is the actual enforcement;
// this just keeps the picker from ever offering an area the backend would
// reject.
const PARENT_TYPE_FOR: Partial<Record<RegionType, RegionType>> = {
  DISTRICT: "STATE",
  CONSTITUENCY: "DISTRICT",
  MANDAL: "DISTRICT",
  BOOTH: "MANDAL",
};

function RegionTree({
  regions,
  parentId,
  depth,
  onEdit,
  onMove,
  onDelete,
  onAddCadre,
  deletingId,
  fullControl,
  manageableType,
}: {
  regions: RegionItem[];
  parentId: string | undefined;
  depth: number;
  onEdit?: (region: RegionItem) => void;
  onMove?: (region: RegionItem) => void;
  onDelete?: (region: RegionItem) => void;
  onAddCadre?: (region: RegionItem) => void;
  deletingId?: string;
  /** Super Admin: full Rename/Change area/Delete on every row. */
  fullControl?: boolean;
  /** Admin: Rename/Delete only on rows of this type (e.g. "BOOTH"). */
  manageableType?: RegionType;
}) {
  const children = regions.filter((r) => (r.parentId ?? undefined) === parentId);
  if (children.length === 0) return null;

  return (
    <ul className={depth === 0 ? "space-y-1" : "ml-5 space-y-1 border-l border-slate-100 pl-4"}>
      {children.map((region) => {
        const canManage = fullControl || (manageableType && region.type === manageableType);
        const menuItems: OverflowMenuItem[] = [];
        if (canManage && onEdit) menuItems.push({ label: "Rename", onClick: () => onEdit(region) });
        if (fullControl && onMove) menuItems.push({ label: "Change area", onClick: () => onMove(region) });
        if (region.type === "BOOTH" && onAddCadre) {
          menuItems.push({ label: "Add Cadre", onClick: () => onAddCadre(region) });
        }
        if (canManage && onDelete) {
          menuItems.push({
            label: deletingId === region.id ? "Deleting..." : "Delete",
            onClick: () => onDelete(region),
            disabled: deletingId === region.id,
            tone: "danger",
          });
        }

        return (
          <li key={region.id} className="py-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-slate-800">
                {region.name} <span className="text-xs text-slate-400">({TYPE_LABELS[region.type]})</span>
              </span>
              {menuItems.length > 0 && <OverflowMenu items={menuItems} />}
            </div>
            <RegionTree
              regions={regions}
              parentId={region.id}
              depth={depth + 1}
              onEdit={onEdit}
              onMove={onMove}
              onDelete={onDelete}
              onAddCadre={onAddCadre}
              deletingId={deletingId}
              fullControl={fullControl}
              manageableType={manageableType}
            />
          </li>
        );
      })}
    </ul>
  );
}

export default function AreasPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: regions, isLoading } = useRegions();
  const createRegion = useCreateRegion();
  const updateRegion = useUpdateRegion();
  const deleteRegion = useDeleteRegion();
  const createCadre = useCreateManagedUser();

  const [form, setForm] = useState<{ name: string; type: RegionType; parentId: string }>({
    name: "",
    type: "DISTRICT",
    parentId: "",
  });
  const [boothForm, setBoothForm] = useState({ name: "", parentId: "" });
  const [editing, setEditing] = useState<RegionItem | null>(null);
  const [editName, setEditName] = useState("");
  const [moving, setMoving] = useState<RegionItem | null>(null);
  const [moveParentId, setMoveParentId] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [addingCadreTo, setAddingCadreTo] = useState<RegionItem | null>(null);
  const [cadreForm, setCadreForm] = useState({ name: "", phone: "", password: "Password@123" });

  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN";
  const isAdmin = currentUser?.role === "ADMIN";

  if (currentUser && !isSuperAdmin && !isAdmin) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Only Super Admins and Admins can view areas.</p>
      </AppShell>
    );
  }

  // Admins are scoped server-side to their own region subtree (GET /regions
  // already returns just that), but the region hierarchy's true root
  // (State) isn't part of that scoped set — so their own region has to be
  // rendered as an explicit top node, with RegionTree only handling what's
  // beneath it. Only Super Admin walks the tree from the real root.
  const myRegion = !isSuperAdmin ? regions?.find((r) => r.id === currentUser?.regionId) : undefined;
  const mandalsInScope = regions?.filter((r) => r.type === "MANDAL") ?? [];

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createRegion.mutate(
      {
        name: form.name,
        type: form.type,
        parentId: form.type === "STATE" ? undefined : form.parentId || undefined,
      },
      { onSuccess: () => setForm({ name: "", type: "DISTRICT", parentId: "" }) },
    );
  };

  const onSubmitBooth = (e: React.FormEvent) => {
    e.preventDefault();
    createRegion.mutate(
      { name: boothForm.name, type: "BOOTH", parentId: boothForm.parentId },
      { onSuccess: () => setBoothForm({ name: "", parentId: "" }) },
    );
  };

  const startEdit = (region: RegionItem) => {
    setEditing(region);
    setEditName(region.name);
  };

  const saveEdit = () => {
    if (!editing) return;
    updateRegion.mutate({ id: editing.id, name: editName }, { onSuccess: () => setEditing(null) });
  };

  const startMove = (region: RegionItem) => {
    setMoving(region);
    setMoveParentId(region.parentId ?? "");
  };

  const saveMove = () => {
    if (!moving) return;
    updateRegion.mutate(
      { id: moving.id, parentId: moveParentId || undefined },
      { onSuccess: () => setMoving(null) },
    );
  };

  const handleDelete = (region: RegionItem) => {
    if (!window.confirm(`Delete "${region.name}" (${TYPE_LABELS[region.type]})? This cannot be undone.`)) {
      return;
    }
    setDeleteError(null);
    deleteRegion.mutate(region.id, {
      onError: (err) => {
        const message = err instanceof ApiError ? err.message : "Failed to delete area";
        setDeleteError(`${region.name}: ${message}`);
      },
    });
  };

  const startAddCadre = (region: RegionItem) => {
    setAddingCadreTo(region);
    setCadreForm({ name: "", phone: "", password: "Password@123" });
  };

  const saveCadre = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addingCadreTo) return;
    createCadre.mutate(
      { ...cadreForm, role: "CADRE", regionId: addingCadreTo.id },
      { onSuccess: () => setAddingCadreTo(null) },
    );
  };

  return (
    <AppShell>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">{isSuperAdmin ? "Manage Areas" : "My Area"}</h1>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {isSuperAdmin && (
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle>Add Area</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-3">
                <div>
                  <Label htmlFor="type">Type</Label>
                  <select
                    id="type"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as RegionType, parentId: "" })}
                  >
                    {RegionType.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                {form.type !== "STATE" && (
                  <div>
                    <Label htmlFor="parentId">Parent area</Label>
                    <select
                      id="parentId"
                      required
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      value={form.parentId}
                      onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                    >
                      <option value="">Select {TYPE_LABELS[PARENT_TYPE_FOR[form.type]!].toLowerCase()}...</option>
                      {regions
                        ?.filter((r) => r.type === PARENT_TYPE_FOR[form.type])
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} ({TYPE_LABELS[r.type]})
                          </option>
                        ))}
                    </select>
                    {regions?.filter((r) => r.type === PARENT_TYPE_FOR[form.type]).length === 0 && (
                      <p className="mt-1 text-xs text-slate-400">
                        No {TYPE_LABELS[PARENT_TYPE_FOR[form.type]!].toLowerCase()} areas exist yet — add one first.
                      </p>
                    )}
                  </div>
                )}
                {createRegion.isError && (
                  <p className="text-xs text-red-600">{(createRegion.error as Error).message}</p>
                )}
                <Button type="submit" className="w-full" disabled={createRegion.isPending}>
                  {createRegion.isPending ? "Adding..." : "Add Area"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle>Add Booth</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmitBooth} className="space-y-3">
                <div>
                  <Label htmlFor="boothName">Name</Label>
                  <Input
                    id="boothName"
                    required
                    value={boothForm.name}
                    onChange={(e) => setBoothForm({ ...boothForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="boothParentId">Mandal</Label>
                  <select
                    id="boothParentId"
                    required
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={boothForm.parentId}
                    onChange={(e) => setBoothForm({ ...boothForm, parentId: e.target.value })}
                  >
                    <option value="">Select mandal...</option>
                    {mandalsInScope.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  {mandalsInScope.length === 0 && (
                    <p className="mt-1 text-xs text-slate-400">No mandals in your area yet.</p>
                  )}
                </div>
                {createRegion.isError && (
                  <p className="text-xs text-red-600">{(createRegion.error as Error).message}</p>
                )}
                <Button type="submit" className="w-full" disabled={createRegion.isPending}>
                  {createRegion.isPending ? "Adding..." : "Add Booth"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>
              {isSuperAdmin ? "Area hierarchy" : "Your area"}{" "}
              <span className="font-normal text-slate-400">({regions?.length ?? 0})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {editing && (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-brand-100 bg-brand-50 p-3">
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1" />
                <Button onClick={saveEdit} disabled={updateRegion.isPending}>
                  {updateRegion.isPending ? "Saving..." : "Save"}
                </Button>
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            )}
            {moving && moving.type === "STATE" && (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm text-amber-800">
                  <span className="font-medium">{moving.name}</span> is a State — the root of the area hierarchy —
                  and cannot be moved under anything.
                </p>
                <div className="mt-2">
                  <Button variant="secondary" onClick={() => setMoving(null)}>
                    Close
                  </Button>
                </div>
              </div>
            )}
            {moving && moving.type !== "STATE" && (
              <div className="mb-4 rounded-md border border-brand-100 bg-brand-50 p-3">
                <p className="mb-2 text-sm text-slate-700">
                  Move <span className="font-medium">{moving.name}</span> ({TYPE_LABELS[moving.type]}) under a{" "}
                  {TYPE_LABELS[PARENT_TYPE_FOR[moving.type]!]}:
                </p>
                <div className="flex items-center gap-2">
                  <select
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={moveParentId}
                    onChange={(e) => setMoveParentId(e.target.value)}
                  >
                    <option value="">Select {TYPE_LABELS[PARENT_TYPE_FOR[moving.type]!].toLowerCase()}...</option>
                    {regions
                      ?.filter((r) => r.type === PARENT_TYPE_FOR[moving.type] && r.id !== moving.id)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({TYPE_LABELS[r.type]})
                        </option>
                      ))}
                  </select>
                  <Button onClick={saveMove} disabled={updateRegion.isPending || !moveParentId}>
                    {updateRegion.isPending ? "Moving..." : "Move"}
                  </Button>
                  <Button variant="secondary" onClick={() => setMoving(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {addingCadreTo && (
              <div className="mb-4 rounded-md border border-brand-100 bg-brand-50 p-3">
                <p className="mb-2 text-sm text-slate-700">
                  Add a Cadre to <span className="font-medium">{addingCadreTo.name}</span>:
                </p>
                <form onSubmit={saveCadre} className="space-y-2">
                  <Input
                    placeholder="Name"
                    required
                    value={cadreForm.name}
                    onChange={(e) => setCadreForm({ ...cadreForm, name: e.target.value })}
                  />
                  <Input
                    placeholder="Phone"
                    required
                    value={cadreForm.phone}
                    onChange={(e) => setCadreForm({ ...cadreForm, phone: e.target.value })}
                  />
                  <Input
                    placeholder="Temporary password"
                    value={cadreForm.password}
                    onChange={(e) => setCadreForm({ ...cadreForm, password: e.target.value })}
                  />
                  {createCadre.isError && (
                    <p className="text-xs text-red-600">{(createCadre.error as Error).message}</p>
                  )}
                  <div className="flex gap-2">
                    <Button type="submit" disabled={createCadre.isPending}>
                      {createCadre.isPending ? "Adding..." : "Add Cadre"}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setAddingCadreTo(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </div>
            )}
            {updateRegion.isError && (
              <p className="mb-3 text-xs text-red-600">{(updateRegion.error as Error).message}</p>
            )}
            {deleteError && <p className="mb-3 text-xs text-red-600">{deleteError}</p>}
            {isSuperAdmin && !isLoading && regions && regions.length > 0 && (
              <RegionTree
                regions={regions}
                parentId={undefined}
                depth={0}
                onEdit={startEdit}
                onMove={startMove}
                onDelete={handleDelete}
                onAddCadre={startAddCadre}
                deletingId={deleteRegion.isPending ? deleteRegion.variables : undefined}
                fullControl
              />
            )}
            {isSuperAdmin && !isLoading && regions?.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500">No areas yet.</p>
            )}
            {!isSuperAdmin && !isLoading && myRegion && (
              <ul className="space-y-1">
                <li className="py-0.5">
                  <span className="text-sm text-slate-800">
                    {myRegion.name} <span className="text-xs text-slate-400">({TYPE_LABELS[myRegion.type]})</span>
                  </span>
                  <RegionTree
                    regions={regions ?? []}
                    parentId={myRegion.id}
                    depth={1}
                    onEdit={startEdit}
                    onDelete={handleDelete}
                    onAddCadre={startAddCadre}
                    deletingId={deleteRegion.isPending ? deleteRegion.variables : undefined}
                    manageableType="BOOTH"
                  />
                </li>
              </ul>
            )}
            {!isSuperAdmin && !isLoading && !myRegion && (
              <p className="py-6 text-center text-sm text-slate-500">No area data available.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
