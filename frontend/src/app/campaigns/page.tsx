"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CampaignCard } from "@/components/campaign-card";
import { Button } from "@/components/ui/button";
import { useCampaigns } from "@/hooks/use-campaigns";
import { useUiStore } from "@/store/ui-store";

const STATUS_OPTIONS = ["ACTIVE", "UPCOMING", "COMPLETED", "DRAFT", "CANCELLED"];

export default function CampaignsPage() {
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
  const searchQuery = searchParams.get("q")?.toLowerCase().trim();
  const visibleCampaigns = searchQuery
    ? campaigns?.filter((c) => c.name.toLowerCase().includes(searchQuery))
    : campaigns;

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">
          Campaigns{searchQuery && <span className="font-normal text-slate-400"> — search: &quot;{searchQuery}&quot;</span>}
        </h1>
        <Link href="/campaigns/new">
          <Button>+ New Campaign</Button>
        </Link>
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
        {visibleCampaigns?.map((campaign) => (
          <CampaignCard key={campaign.id} campaign={campaign} />
        ))}
        {searchQuery && visibleCampaigns?.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-slate-500">
            No campaigns match &quot;{searchQuery}&quot;.
          </p>
        )}
      </div>
    </AppShell>
  );
}
