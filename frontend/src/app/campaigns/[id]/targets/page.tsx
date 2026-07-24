"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AllocationTree } from "@/components/allocation-tree";
import { useAllocationTree } from "@/hooks/use-allocations";
import { useCampaign } from "@/hooks/use-campaigns";

export default function CampaignTargetsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: campaign } = useCampaign(id);
  const { data: tree } = useAllocationTree(id);

  const rootTarget = campaign?.totalTarget ?? 0;
  const allocatedTarget = tree?.reduce((sum, node) => sum + node.target, 0) ?? 0;

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Target Distribution</h1>
      <p className="mb-6 text-sm text-slate-500">
        {campaign?.name} — Total {rootTarget.toLocaleString()} · Allocated {allocatedTarget.toLocaleString()} ·
        Unallocated {(rootTarget - allocatedTarget).toLocaleString()}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>State → District → Mandal → Booth</CardTitle>
        </CardHeader>
        <CardContent>
          <AllocationTree nodes={tree ?? []} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
