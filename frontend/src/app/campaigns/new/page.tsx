"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createCampaignSchema, CreateCampaignDto } from "@/lib/shared-types";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCreateCampaign } from "@/hooks/use-campaigns";

export default function NewCampaignPage() {
  const router = useRouter();
  const createCampaign = useCreateCampaign();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateCampaignDto>({
    resolver: zodResolver(createCampaignSchema),
    defaultValues: { priority: "MEDIUM", requiredDocuments: [] },
  });

  const onSubmit = handleSubmit((dto) => {
    createCampaign.mutate(dto, {
      onSuccess: (campaign: any) => router.push(`/campaigns/${campaign.id}`),
    });
  });

  return (
    <AppShell>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">Create Campaign</h1>
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>Campaign details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">Campaign name</Label>
              <Input id="name" placeholder="Membership Drive 2026" {...register("name")} />
              {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Input id="description" placeholder="Collect new membership forms across the state" {...register("description")} />
              {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="objective">Objective</Label>
                <Input id="objective" {...register("objective")} />
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <Input id="category" placeholder="Membership" {...register("category")} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="startDate">Start date</Label>
                <Input id="startDate" type="date" {...register("startDate")} />
                {errors.startDate && <p className="mt-1 text-xs text-red-600">{errors.startDate.message}</p>}
              </div>
              <div>
                <Label htmlFor="endDate">End date</Label>
                <Input id="endDate" type="date" {...register("endDate")} />
                {errors.endDate && <p className="mt-1 text-xs text-red-600">{errors.endDate.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="priority">Priority</Label>
                <select id="priority" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" {...register("priority")}>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>
              <div>
                <Label htmlFor="expectedVolunteers">Expected volunteers</Label>
                <Input id="expectedVolunteers" type="number" {...register("expectedVolunteers", { valueAsNumber: true })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="totalTarget">Total target (forms/visits/etc.)</Label>
                <Input id="totalTarget" type="number" placeholder="50000" {...register("totalTarget", { valueAsNumber: true })} />
                {errors.totalTarget && <p className="mt-1 text-xs text-red-600">{errors.totalTarget.message}</p>}
              </div>
              <div>
                <Label htmlFor="totalBudget">Total budget (₹)</Label>
                <Input id="totalBudget" type="number" placeholder="2500000" {...register("totalBudget", { valueAsNumber: true })} />
                {errors.totalBudget && <p className="mt-1 text-xs text-red-600">{errors.totalBudget.message}</p>}
              </div>
            </div>

            {createCampaign.isError && (
              <p className="text-xs text-red-600">{(createCampaign.error as Error).message}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" disabled={createCampaign.isPending}>
                {createCampaign.isPending ? "Creating..." : "Create Campaign"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
