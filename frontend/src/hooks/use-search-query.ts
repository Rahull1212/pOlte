"use client";

import { useSearchParams } from "next/navigation";

/**
 * The header search box's current query for this page, lowercased and
 * trimmed, or "" when nothing is being searched.
 *
 * Every list page reads it the same way so the box behaves identically
 * everywhere — type, press Enter, the list filters. Pages that had their
 * own in-page search box (Tasks, Message Log) seed that box from this so
 * the two controls can't disagree about what's being filtered.
 *
 * NOTE: any component calling this must sit inside a <Suspense> boundary,
 * because useSearchParams() opts a page out of static generation otherwise
 * and `next build` fails. Every page here already has that wrapper.
 */
export function useSearchQuery(): string {
  const searchParams = useSearchParams();
  return searchParams.get("q")?.toLowerCase().trim() ?? "";
}

/** True when `haystack` contains the query; empty queries match everything. */
export function matchesQuery(query: string, ...haystack: (string | null | undefined)[]): boolean {
  if (!query) return true;
  return haystack.some((value) => value?.toLowerCase().includes(query));
}
