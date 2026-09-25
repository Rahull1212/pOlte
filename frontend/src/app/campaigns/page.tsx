"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CampaignCard } from "@/components/campaign-card";
import { Button } from "@/components/ui/button";
import { useCampaigns } from "@/hooks/use-campaigns";
import { useCurrentUser } from "@/hooks/use-auth";
import { useSearchQuery, matchesQuery } from "@/hooks/use-search-query";
import { useUiStore } from "@/store/ui-store";

const STATUS_OPTIONS = ["ACTIVE", "UPCOMING", "COMPLETED", "DRAFT", "CANCELLED"];

// useSearchParams() opts a page out of static generation unless it's inside
// a Suspense boundary — `next build` fails without this wrapper (dev mode
// doesn't enforce it, which is why this only ever showed up in a real build).
export default function CampaignsPage() {
  return (
    <Suspense fallback={null}>
      <CampaignsPageContent />
    </Suspense>
  );
}

function CampaignsPageContent() {
  const { data: user } = useCurrentUser();
  const { campaignFilter, setCampaignFilter } = useUiStore();
  const searchParams = useSearchParams();
  const appliedUrlFilter = useRef(false);

  // A KPI tile like /campaigns?status=ACTIVE should pre-apply that filter
  // once, without fighting the user if they change it afterwards via the
  // tabs below (which only touch the zustand store, not the URL).
  useEffect(() => {
    if (appliedUrlFilter.current) return;
    const status = searchParams.get("status");
    if (status) setCampaignFilter({ status });
    appliedUrlFilter.current = true;
  }, [searchParams, setCampaignFilter]);

  const { data: campaigns, isLoading } = useCampaigns(campaignFilter);
  // Same hook every other section uses, so the header box behaves
  // identically here and everywhere else.
  const searchQuery = useSearchQuery();
  const visibleCampaigns = (campaigns ?? []).filter((c) =>
    matchesQuery(searchQuery, c.name, c.description),
  );

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">
          Campaigns{searchQuery && <span className="font-normal text-slate-400"> — search: &quot;{searchQuery}&quot;</span>}
        </h1>
        {/* Only a Super Admin creates campaigns. An Admin's part is to
            accept the ones handed to them and allocate the work to their
            Cadres, so the button isn't offered to them at all. */}
        {user?.role === "SUPER_ADMIN" && (
          <Link href="/campaigns/new">
            <Button>+ New Campaign</Button>
          </Link>
        )}
      </div>

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setCampaignFilter({})}
          className={`rounded-full px-3 py-1 text-xs ${!campaignFilter.status ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          All
        </button>
        {STATUS_OPTIONS.map((status) => (
          <button
            key={status}
            onClick={() => setCampaignFilter({ ...campaignFilter, status })}
            className={`rounded-full px-3 py-1 text-xs ${campaignFilter.status === status ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {status}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading...</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {visibleCampaigns.map((campaign) => (
          <CampaignCard key={campaign.id} campaign={campaign} />
        ))}
        {searchQuery && visibleCampaigns.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-slate-500">
            No campaigns match &quot;{searchQuery}&quot;.
          </p>
        )}
      </div>
    </AppShell>
  );
}
