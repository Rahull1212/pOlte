"use client";

import { useEffect, useMemo } from "react";
import { Label } from "@/components/ui/input";
import { useRegions, RegionItem } from "@/hooks/use-regions";
import { RegionType } from "@/lib/shared-types";

/**
 * The Election Commission's location chain, picked one level at a time:
 * State → District → Assembly Constituency → Polling Station.
 *
 * This is the only place a task's location is chosen. There is no parallel
 * "target areas" picker any more — two controls naming the same place could
 * disagree, and only one of them was official.
 *
 * How far down you go is the decision: stopping at a District targets the
 * whole District, going all the way to a Polling Station targets just that
 * station. `deepestSelectedId` is what the caller sends as the task's area.
 */
export interface OfficialLocation {
  stateId: string;
  districtId: string;
  constituencyId: string;
  pollingStationId: string;
}

export const EMPTY_OFFICIAL_LOCATION: OfficialLocation = {
  stateId: "",
  districtId: "",
  constituencyId: "",
  pollingStationId: "",
};

const LEVELS: { type: RegionType; key: keyof OfficialLocation; label: string; placeholder: string }[] = [
  { type: "STATE", key: "stateId", label: "State", placeholder: "Select a State…" },
  { type: "DISTRICT", key: "districtId", label: "District", placeholder: "Select a District…" },
  { type: "CONSTITUENCY", key: "constituencyId", label: "Assembly Constituency", placeholder: "Select a Constituency…" },
  { type: "BOOTH", key: "pollingStationId", label: "Polling Station No. & Name", placeholder: "Select a Polling Station…" },
];

/** The narrowest area actually chosen — what the task is filed against. */
export function deepestSelectedId(value: OfficialLocation): string {
  return value.pollingStationId || value.constituencyId || value.districtId || value.stateId || "";
}

/**
 * Why a selection isn't usable yet, or null when it is.
 *
 * A State on its own is never enough: it's pre-selected for whoever can see
 * only one, so accepting it would let an unattended submit route a task to
 * every Admin in the state. At least a District has to be chosen — unless
 * the caller's scope has no District level at all, in which case whatever
 * level they do have is as specific as it gets.
 */
export function officialLocationError(value: OfficialLocation, regions: RegionItem[] | undefined): string | null {
  const hasDistricts = (regions ?? []).some((r) => r.type === "DISTRICT");
  if (hasDistricts && !value.districtId) {
    return "Choose the official location this task covers — at least a District.";
  }
  if (!deepestSelectedId(value)) return "Choose the official location this task covers.";
  return null;
}

export function OfficialLocationPicker({
  value,
  onChange,
}: {
  value: OfficialLocation;
  onChange: (next: OfficialLocation) => void;
}) {
  const { data: regions, isLoading } = useRegions();
  const all = useMemo(() => regions ?? [], [regions]);

  // /regions is already scoped to the caller, so an Admin whose area starts
  // at a Constituency simply has no State or District rows — the chain then
  // starts at their own level instead of showing two dead dropdowns.
  const levels = useMemo(() => LEVELS.filter((l) => all.some((r) => r.type === l.type)), [all]);

  const optionsFor = (index: number): RegionItem[] => {
    const level = levels[index];
    if (index === 0) return all.filter((r) => r.type === level.type);
    const parentId = value[levels[index - 1].key];
    return parentId ? all.filter((r) => r.type === level.type && r.parentId === parentId) : [];
  };

  // With one option at the top of the chain there is no choice to make —
  // pre-select it so an Admin isn't asked to confirm their own area.
  // officialLocationError() still insists on a District below it, so this
  // convenience can't be mistaken for a real targeting decision.
  const rootOptions = levels.length > 0 ? optionsFor(0) : [];
  const rootKey = levels[0]?.key;
  useEffect(() => {
    if (rootKey && rootOptions.length === 1 && !value[rootKey]) {
      onChange({ ...value, [rootKey]: rootOptions[0].id });
    }
  }, [rootKey, rootOptions, value, onChange]);

  // Everything below the level officialLocationError() insists on is a
  // narrowing, not a requirement — label it so, rather than leaving four
  // dropdowns that all look equally mandatory.
  const requiredIndex = Math.max(
    0,
    levels.findIndex((l) => l.type === "DISTRICT"),
  );

  // Narrowing a level clears everything under it: a station from a district
  // you just switched away from is not a location anyone meant to keep.
  const pick = (index: number, id: string) => {
    const next = { ...value, [levels[index].key]: id };
    for (const deeper of levels.slice(index + 1)) next[deeper.key] = "";
    onChange(next);
  };

  if (isLoading) return <p className="text-xs text-slate-500">Loading official areas…</p>;

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <div>
        <p className="text-sm font-medium text-slate-800">Official Location</p>
        <p className="text-xs text-slate-500">
          As published by the Election Commission. Go as deep as the task needs — stopping at a District covers the
          whole District, a Polling Station covers just that station.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {levels.map((level, index) => {
          const options = optionsFor(index);
          const disabled = index > 0 && options.length === 0;
          return (
            <div key={level.key}>
              <Label htmlFor={`eci-${level.key}`}>
                {level.label}
                {index > requiredIndex && <span className="font-normal text-slate-400"> — optional</span>}
              </Label>
              <select
                id={`eci-${level.key}`}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                value={value[level.key]}
                disabled={disabled}
                onChange={(e) => pick(index, e.target.value)}
              >
                <option value="">{disabled ? `Select a ${levels[index - 1].label} first` : level.placeholder}</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.number ? `${o.number} — ${o.name}` : o.name}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
