"use client";

import { useMemo, useState } from "react";
import { useRegions, RegionItem } from "@/hooks/use-regions";
import { RegionType } from "@/lib/shared-types";

// Walks a region's parent chain (not just its direct parent) so this works
// across a multi-hop gap too — e.g. MANDAL's parent is CONSTITUENCY, whose
// parent is DISTRICT, so scoping mandals by selected districts still matches.
export function isRegionWithinScope(regionId: string, scopeIds: Set<string>, byId: Map<string, RegionItem>): boolean {
  let current = byId.get(regionId);
  while (current?.parentId) {
    if (scopeIds.has(current.parentId)) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

export function RegionMultiSelect({
  type,
  selected,
  onChange,
  label,
  scopeIds,
  scopeLabel,
}: {
  type: RegionType;
  selected: string[];
  onChange: (ids: string[]) => void;
  label: string;
  // When provided, only regions descending from one of these region ids are
  // shown (and the picker is disabled/empty until at least one is selected).
  // Omit for a top-level picker (e.g. District) that isn't scoped by a parent.
  scopeIds?: string[];
  scopeLabel?: string;
}) {
  const { data: regions } = useRegions();
  const [filter, setFilter] = useState("");

  const byId = useMemo(() => new Map((regions ?? []).map((r) => [r.id, r])), [regions]);
  const isScoped = scopeIds !== undefined;
  const scopeSet = useMemo(() => new Set(scopeIds ?? []), [scopeIds]);
  const isDisabled = isScoped && scopeSet.size === 0;

  const options = isDisabled
    ? []
    : (regions ?? []).filter(
        (r) =>
          r.type === type &&
          r.name.toLowerCase().includes(filter.toLowerCase()) &&
          (!isScoped || isRegionWithinScope(r.id, scopeSet, byId)),
      );

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <div>
      <input
        type="text"
        placeholder={isDisabled ? `Select ${scopeLabel} first` : `Search ${label.toLowerCase()}...`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        disabled={isDisabled}
        className="mb-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
      />
      <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-300 p-2">
        {isDisabled && <p className="px-1 py-1 text-xs text-slate-400">Select {scopeLabel} first.</p>}
        {!isDisabled && options.length === 0 && <p className="px-1 py-1 text-xs text-slate-400">No matches.</p>}
        {!isDisabled &&
          options.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
              {r.name}
            </label>
          ))}
      </div>
      {selected.length > 0 && <p className="mt-1 text-xs text-slate-500">{selected.length} selected</p>}
    </div>
  );
}
