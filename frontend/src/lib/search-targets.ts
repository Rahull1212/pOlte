/**
 * What the header search box searches, per section.
 *
 * The box used to be hardcoded to campaigns — placeholder and destination
 * both — so on every other tab it offered to search something the page
 * wasn't showing. Each section now declares its own target here, and the
 * header reads the current one off the pathname.
 *
 * A section listed here must read `?q=` on its page and filter by it;
 * anything not listed simply gets no search box.
 */
export interface SearchTarget {
  /** Route the query is pushed to — always the section's list page. */
  route: string;
  /** Fills the placeholder: "Search {noun}...". */
  noun: string;
  /** Shown under the page heading when a query is active. */
  hint: string;
}

const SEARCH_TARGETS: SearchTarget[] = [
  { route: "/campaigns", noun: "campaigns", hint: "name" },
  { route: "/tasks", noun: "tasks", hint: "task name" },
  { route: "/events", noun: "events", hint: "name or location" },
  { route: "/grievances", noun: "grievances", hint: "category, description or area" },
  { route: "/users", noun: "people", hint: "name or phone" },
  { route: "/areas", noun: "areas", hint: "area name or number" },
  { route: "/polls", noun: "polls", hint: "question" },
];

// Message Log is deliberately absent: it has its own Search field with
// Apply/Clear that filters server-side, so a header box there would be a
// second control doing the same job with different mechanics.

/**
 * The target for a pathname, or null where search doesn't apply.
 *
 * Matched on the section prefix so a detail page (/campaigns/abc) keeps its
 * section's search rather than losing the box mid-navigation. Sub-routes
 * that are forms rather than lists (/tasks/new) still resolve to their
 * section list, which is where a search result should land anyway.
 */
export function searchTargetFor(pathname: string | null): SearchTarget | null {
  if (!pathname) return null;
  return (
    SEARCH_TARGETS.find((t) => pathname === t.route || pathname.startsWith(`${t.route}/`)) ?? null
  );
}
