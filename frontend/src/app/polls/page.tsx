"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/use-auth";
import { usePollList } from "@/hooks/use-polls";
import { useSearchQuery, matchesQuery } from "@/hooks/use-search-query";

// useSearchQuery() reads useSearchParams(), which needs a Suspense boundary
// or `next build` refuses to prerender the page.
export default function PollsPage() {
  return (
    <Suspense fallback={null}>
      <PollsPageContent />
    </Suspense>
  );
}

function PollsPageContent() {
  const { data: user } = useCurrentUser();
  const { data: polls, isLoading } = usePollList();
  const query = useSearchQuery();
  const visiblePolls = useMemo(
    () => (polls ?? []).filter((p) => matchesQuery(query, p.question, p.createdByName)),
    [polls, query],
  );

  if (user && user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Only Super Admins and Admins can view Polls.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">
          Polls
          {query && <span className="font-normal text-slate-400"> — search: &quot;{query}&quot;</span>}
        </h1>
        {/* Both roles write polls. A Super Admin can target any area; an
            Admin's poll reaches only their own Cadres, which the API enforces
            per region rather than trusting this button to be hidden. */}
        {(user?.role === "SUPER_ADMIN" || user?.role === "ADMIN") && (
          <Link href="/polls/new">
            <Button>+ Create Poll</Button>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            All Polls <span className="font-normal text-slate-400">({visiblePolls.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-2">Question</th>
                <th className="px-5 py-2">Options</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2">Responses</th>
                <th className="px-5 py-2">Created By</th>
                <th className="px-5 py-2">Created</th>
                <th className="px-5 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visiblePolls.map((p) => (
                <tr key={p.id} className="border-b border-slate-50">
                  <td className="px-5 py-2 font-medium text-slate-800">{p.question}</td>
                  <td className="px-5 py-2 text-slate-600">{p.options.join(", ")}</td>
                  <td className="px-5 py-2">
                    <Badge tone={p.awaitingAllocation ? "amber" : "green"}>
                      {p.awaitingAllocation ? "Awaiting Allocation" : "Sent"}
                    </Badge>
                  </td>
                  <td className="px-5 py-2 text-slate-600">
                    {p.awaitingAllocation ? "—" : `${p.answeredCount}/${p.recipientCount}`}
                  </td>
                  <td className="px-5 py-2 text-slate-600">{p.createdByName}</td>
                  <td className="px-5 py-2 text-slate-500">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-2 text-right">
                    <Link href={p.awaitingAllocation ? `/polls/${p.id}` : `/polls/${p.id}/dashboard`}>
                      <Button variant="secondary">{p.awaitingAllocation ? "Allocate" : "📊 View Dashboard"}</Button>
                    </Link>
                  </td>
                </tr>
              ))}
              {!isLoading && visiblePolls.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                    {query ? `No polls match "${query}".` : "No polls created yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
