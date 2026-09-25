"use client";

import { Suspense, useMemo, useState } from "react";
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
import { useSearchQuery, matchesQuery } from "@/hooks/use-search-query";

const TYPE_LABELS: Record<RegionType, string> = {
  STATE: "State",
  DISTRICT: "District",
  CONSTITUENCY: "Assembly Constituency",
  BOOTH: "Polling Station",
};

// The Election Commission's hierarchy: State -> District -> Assembly
// Constituency -> Polling Station. No entry for STATE since it's the root
// and can never have a parent. Mirrors REQUIRED_PARENT_TYPE in
// backend/src/regions/regions.service.ts, which is the actual enforcement;
// this just keeps the picker from ever offering an area the backend would
// reject.
const PARENT_TYPE_FOR: Partial<Record<RegionType, RegionType>> = {
  DISTRICT: "STATE",
  CONSTITUENCY: "DISTRICT",
  BOOTH: "CONSTITUENCY",
};

function RegionTree({
  regions,
  parentId,
  depth,
  onEdit,
  onMove,
  onDelete,
  onAddCadre,
  onAddBooth,
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
  /** Offered on Constituencies only — a Polling Station can't sit under anything else. */
  onAddBooth?: (region: RegionItem) => void;
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
        // Constituencies only: a Polling Station's parent must be an AC, so
        // offering this anywhere else would produce a choice the hierarchy
        // rejects. The row itself supplies the parent id, so nothing has to
        // be re-selected.
        if (region.type === "CONSTITUENCY" && onAddBooth) {
          menuItems.push({ label: "Add Polling Station", onClick: () => onAddBooth(region) });
        }
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
              onAddBooth={onAddBooth}
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

// useSearchQuery() reads useSearchParams(), which needs a Suspense boundary
// or `next build` refuses to prerender the page.
export default function AreasPage() {
  return (
    <Suspense fallback={null}>
      <AreasPageContent />
    </Suspense>
  );
}

function AreasPageContent() {
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
  const [boothForm, setBoothForm] = useState({ name: "", number: "" });
  const [editing, setEditing] = useState<RegionItem | null>(null);
  const [editName, setEditName] = useState("");
  const [moving, setMoving] = useState<RegionItem | null>(null);
  const [moveParentId, setMoveParentId] = useState("");
  // The type an area is being changed to. Held alongside the parent because
  // the two are validated together — a Constituency under a State is invalid, but
  // the same move is correct if it's becoming a District at the same time.
  const [moveType, setMoveType] = useState<RegionType>("DISTRICT");
  // The Constituency whose menu opened the Add Booth modal. Holding the region
  // itself (not just an id) is what lets the modal show which Constituency it is
  // without asking the user to pick it again.
  const [boothParent, setBoothParent] = useState<RegionItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [addingCadreTo, setAddingCadreTo] = useState<RegionItem | null>(null);
  const [cadreForm, setCadreForm] = useState({ name: "", phone: "", password: "Password@123" });

  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN";

  // Searching a 700-node tree by pruning it would leave matches stranded
  // without their parents, so a query switches the panel to a flat result
  // list where each match carries its own full path instead.
  const query = useSearchQuery();
  const byId = useMemo(() => new Map((regions ?? []).map((r) => [r.id, r])), [regions]);
  const searchResults = useMemo(() => {
    if (!query) return [];
    return (regions ?? [])
      .filter((r) => matchesQuery(query, r.name, r.number))
      .map((region) => {
        const path: string[] = [];
        let parent = region.parentId ? byId.get(region.parentId) : undefined;
        while (parent) {
          path.unshift(parent.name);
          parent = parent.parentId ? byId.get(parent.parentId) : undefined;
        }
        return { region, path: path.join(" › ") };
      })
      .sort((a, b) => a.path.localeCompare(b.path) || a.region.name.localeCompare(b.region.name));
  }, [regions, query, byId]);
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

  const startAddBooth = (constituency: RegionItem) => {
    setBoothParent(constituency);
    setBoothForm({ name: "", number: "" });
    createRegion.reset();
  };

  const closeBoothModal = () => {
    setBoothParent(null);
    setBoothForm({ name: "", number: "" });
    createRegion.reset();
  };

  const onSubmitBooth = (e: React.FormEvent) => {
    e.preventDefault();
    if (!boothParent) return;
    const name = boothForm.name.trim();
    if (!name) return;
    createRegion.mutate(
      // boothParent.id is the Constituency whose menu was used — the booth is
      // created directly under that area, with no re-selection to get wrong.
      {
        name,
        number: boothForm.number.trim() || undefined,
        type: "BOOTH",
        parentId: boothParent.id,
      },
      { onSuccess: closeBoothModal },
    );
  };

  const startEdit = (region: RegionItem) => {
    setEditing(region);
    setEditName(region.name);
  };

  const closeEdit = () => {
    setEditing(null);
    setEditName("");
    // Drop a failed attempt's message so reopening starts clean.
    updateRegion.reset();
  };

  const saveEdit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!editing) return;
    const name = editName.trim();
    if (!name) return;
    // editing.id, not the row the menu happens to sit next to — this is what
    // guarantees only the selected area is renamed, whatever its type.
    updateRegion.mutate({ id: editing.id, name }, { onSuccess: closeEdit });
  };

  const startMove = (region: RegionItem) => {
    setMoving(region);
    setMoveParentId(region.parentId ?? "");
    setMoveType(region.type);
    updateRegion.reset();
  };

  const closeMove = () => {
    setMoving(null);
    setMoveParentId("");
    updateRegion.reset();
  };

  const saveMove = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!moving) return;
    // moving.id — the area the menu was opened on, never a positional guess.
    updateRegion.mutate(
      {
        id: moving.id,
        type: moveType,
        // A State has no parent; everything else requires one, which the
        // form enforces before this runs.
        parentId: moveType === "STATE" ? undefined : moveParentId,
      },
      { onSuccess: closeMove },
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

        <Card className={isSuperAdmin ? "md:col-span-2" : "md:col-span-3"}>
          <CardHeader>
            <CardTitle>
              {query ? "Matching areas" : isSuperAdmin ? "Area hierarchy" : "Your area"}{" "}
              <span className="font-normal text-slate-400">
                ({query ? searchResults.length : (regions?.length ?? 0)})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
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

            {/* A search replaces the tree with its matches — the tree's whole
                job is showing structure, which a filtered tree no longer does. */}
            {query && !isLoading && (
              <ul className="space-y-1">
                {searchResults.map(({ region, path }) => (
                  <li key={region.id} className="rounded-md px-1 py-1 hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 text-sm text-slate-800">
                        {region.number ? `${region.number} — ${region.name}` : region.name}{" "}
                        <span className="text-xs text-slate-400">({TYPE_LABELS[region.type]})</span>
                        {path && <span className="block truncate text-xs text-slate-400">{path}</span>}
                      </span>
                      {isSuperAdmin && (
                        <OverflowMenu
                          items={[
                            { label: "Rename", onClick: () => startEdit(region) },
                            { label: "Change area", onClick: () => startMove(region) },
                            ...(region.type === "CONSTITUENCY"
                              ? [{ label: "Add Polling Station", onClick: () => startAddBooth(region) }]
                              : []),
                            ...(region.type === "BOOTH"
                              ? [{ label: "Add Cadre", onClick: () => startAddCadre(region) }]
                              : []),
                            { label: "Delete", onClick: () => handleDelete(region), tone: "danger" as const },
                          ]}
                        />
                      )}
                    </div>
                  </li>
                ))}
                {searchResults.length === 0 && (
                  <li className="py-6 text-center text-sm text-slate-500">No areas match &quot;{query}&quot;.</li>
                )}
              </ul>
            )}

            {!query && isSuperAdmin && !isLoading && regions && regions.length > 0 && (
              <RegionTree
                regions={regions}
                parentId={undefined}
                depth={0}
                onEdit={startEdit}
                onMove={startMove}
                onDelete={handleDelete}
                onAddCadre={startAddCadre}
                onAddBooth={startAddBooth}
                deletingId={deleteRegion.isPending ? deleteRegion.variables : undefined}
                fullControl
              />
            )}
            {!query && isSuperAdmin && !isLoading && regions?.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500">No areas yet.</p>
            )}
            {!query && !isSuperAdmin && !isLoading && myRegion && (
              <ul className="space-y-1">
                <li className="py-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-800">
                      {myRegion.name} <span className="text-xs text-slate-400">({TYPE_LABELS[myRegion.type]})</span>
                    </span>
                    {/* An Admin's own area is rendered here rather than by
                        RegionTree (which only draws children), so its menu has
                        to be built here too — otherwise an Admin whose area IS
                        a Constituency would have no way to add a booth to it, which
                        is the one thing they're meant to do. */}
                    {myRegion.type === "CONSTITUENCY" && (
                      <OverflowMenu items={[{ label: "Add Polling Station", onClick: () => startAddBooth(myRegion) }]} />
                    )}
                  </div>
                  <RegionTree
                    regions={regions ?? []}
                    parentId={myRegion.id}
                    depth={1}
                    onEdit={startEdit}
                    onDelete={handleDelete}
                    onAddCadre={startAddCadre}
                    onAddBooth={startAddBooth}
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

      {moving && (
        <ChangeAreaModal
          area={moving}
          regions={regions ?? []}
          type={moveType}
          onTypeChange={(next) => {
            setMoveType(next);
            // The parent list is driven by the type, so a previously-picked
            // parent is almost never valid for the new one.
            setMoveParentId("");
          }}
          parentId={moveParentId}
          onParentChange={setMoveParentId}
          onSubmit={saveMove}
          onCancel={closeMove}
          isPending={updateRegion.isPending}
          error={updateRegion.isError ? (updateRegion.error as Error).message : null}
        />
      )}

      {boothParent && (
        <AddBoothModal
          constituency={boothParent}
          form={boothForm}
          setForm={setBoothForm}
          onSubmit={onSubmitBooth}
          onCancel={closeBoothModal}
          isPending={createRegion.isPending}
          error={createRegion.isError ? (createRegion.error as Error).message : null}
        />
      )}

      {editing && (
        <RenameAreaModal
          area={editing}
          name={editName}
          onNameChange={setEditName}
          onSubmit={saveEdit}
          onCancel={closeEdit}
          isPending={updateRegion.isPending}
          error={updateRegion.isError ? (updateRegion.error as Error).message : null}
        />
      )}
    </AppShell>
  );
}

const selectClass = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/**
 * Changing what an area IS (its type) and where it sits (its parent) are one
 * dialog because they're one decision: a Constituency moved under a State is
 * invalid, while the same move is correct if it becomes a District at the
 * same time. Validating them separately would reject edits that are fine.
 *
 * The parent list is derived from the chosen type, so only areas that can
 * legally hold it are offered — the server re-checks regardless.
 */
function ChangeAreaModal({
  area,
  regions,
  type,
  onTypeChange,
  parentId,
  onParentChange,
  onSubmit,
  onCancel,
  isPending,
  error,
}: {
  area: RegionItem;
  regions: RegionItem[];
  type: RegionType;
  onTypeChange: (type: RegionType) => void;
  parentId: string;
  onParentChange: (id: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  onCancel: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const requiredParent = PARENT_TYPE_FOR[type];
  // Excludes the area itself and its descendants: moving something under its
  // own child would detach that branch from the tree. The server enforces
  // this too; doing it here means the invalid option is never offered.
  const descendantIds = collectDescendantIds(regions, area.id);
  const parentOptions = requiredParent
    ? regions.filter((r) => r.type === requiredParent && r.id !== area.id && !descendantIds.has(r.id))
    : [];

  const needsParent = type !== "STATE";
  const unchanged = type === area.type && (parentId || "") === (area.parentId ?? "");
  const canSave = !isPending && !unchanged && (!needsParent || Boolean(parentId));

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-lg">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Change Area</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {area.name} — currently a {TYPE_LABELS[area.type]}
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="change-type">New type</Label>
            <select
              id="change-type"
              className={selectClass}
              value={type}
              onChange={(e) => onTypeChange(e.target.value as RegionType)}
            >
              {RegionType.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {needsParent ? (
            <div>
              <Label htmlFor="change-parent">Parent area ({TYPE_LABELS[requiredParent!]})</Label>
              <select
                id="change-parent"
                className={selectClass}
                value={parentId}
                onChange={(e) => onParentChange(e.target.value)}
              >
                <option value="">Select {TYPE_LABELS[requiredParent!].toLowerCase()}...</option>
                {parentOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {parentOptions.length === 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  No {TYPE_LABELS[requiredParent!].toLowerCase()} is available to hold this area.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              A State is the root of the hierarchy, so it has no parent area.
            </p>
          )}

          {type !== area.type && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Changing a {TYPE_LABELS[area.type]} to a {TYPE_LABELS[type]} is refused if it still holds areas that
              can no longer sit under it.
            </p>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Adding a booth to a Constituency the user already chose, from that Constituency's own
 * menu — so the parent is context, not a question. Re-asking for
 * State/District/Constituency here would invite picking a different Constituency than the
 * row that was clicked, which is exactly the mistake this avoids.
 */
function AddBoothModal({
  constituency,
  form,
  setForm,
  onSubmit,
  onCancel,
  isPending,
  error,
}: {
  constituency: RegionItem;
  form: { name: string; number: string };
  setForm: (form: { name: string; number: string }) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  isPending: boolean;
  error: string | null;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-lg">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Add Polling Station</h2>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          {/* Read-only: this is the Constituency whose menu opened the dialog, and
              its id is what the booth is created under. */}
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-medium uppercase text-slate-400">Assembly Constituency</p>
            <p className="text-sm text-slate-800">{constituency.name}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="booth-name">Polling Station name</Label>
              <Input
                id="booth-name"
                required
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="booth-number">Polling Station number</Label>
              <Input
                id="booth-number"
                value={form.number}
                placeholder="142"
                onChange={(e) => setForm({ ...form, number: e.target.value })}
              />
            </div>
          </div>

          {/* Duplicate name/number clashes within this Constituency come back from
              the server and land here, rather than closing the dialog. */}
          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !form.name.trim()}>
              {isPending ? "Adding..." : "Add Polling Station"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}


/** Every area beneath `rootId`, so a move can't target its own descendant. */
function collectDescendantIds(regions: RegionItem[], rootId: string): Set<string> {
  const byParent = new Map<string, RegionItem[]>();
  for (const r of regions) {
    if (!r.parentId) continue;
    byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r]);
  }
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const child of byParent.get(id) ?? []) {
      if (out.has(child.id)) continue;
      out.add(child.id);
      walk(child.id);
    }
  };
  walk(rootId);
  return out;
}

/**
 * Renaming happens in place, over the hierarchy, rather than anywhere that
 * takes the user off this page — the tree behind it is the context that makes
 * "which area is this?" answerable, so the area's type and parentage are shown
 * alongside the field.
 *
 * Works for every level: nothing here is type-specific, and the id comes from
 * the selected row rather than from anything positional.
 */
function RenameAreaModal({
  area,
  name,
  onNameChange,
  onSubmit,
  onCancel,
  isPending,
  error,
}: {
  area: RegionItem;
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  onCancel: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const trimmed = name.trim();
  const unchanged = trimmed === area.name;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-lg">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Rename Area</h2>
          {/* Names repeat across the hierarchy ("Booth 2" under several
              Constituencies), so the type is spelled out — it's how you tell at a
              glance that the right row was picked. */}
          <p className="mt-0.5 text-xs text-slate-400">
            {area.name} ({area.type})
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="area-name">Area name</Label>
            <Input
              id="area-name"
              autoFocus
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              // Selects the existing name on open so typing replaces it,
              // while still allowing a small edit.
              onFocus={(e) => e.currentTarget.select()}
            />
            {!trimmed && <p className="mt-1 text-xs text-amber-700">A name is required.</p>}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !trimmed || unchanged}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
