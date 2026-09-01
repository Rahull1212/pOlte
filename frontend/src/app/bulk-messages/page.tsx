"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/use-auth";
import { useBulkCampaigns } from "@/hooks/use-bulk-messages";
import { BulkCampaignStatus } from "@/lib/shared-types";

const statusTone: Record<BulkCampaignStatus, "slate" | "blue" | "green" | "red"> = {
  DRAFT: "slate",
  SENDING: "blue",
  SENT: "green",
  FAILED: "red",
};

const statusLabel: Record<BulkCampaignStatus, string> = {
  DRAFT: "Draft",
  SENDING: "Sending",
  SENT: "Sent",
  FAILED: "Failed",
};

export default function BulkMessagesPage() {
  const { data: user } = useCurrentUser();
  const { data: campaigns, isLoading } = useBulkCampaigns();

  if (user && user.role !== "SUPER_ADMIN") {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Only Super Admins can access Bulk WhatsApp Messaging.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Bulk WhatsApp Messaging</h1>
          <p className="mt-1 text-sm text-slate-500">
            Upload a contact list, select recipients, and send via Fyxo Connect.
          </p>
        </div>
        <Link href="/bulk-messages/new">
          <Button>+ New Campaign</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Campaigns <span className="font-normal text-slate-400">({campaigns?.length ?? 0})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-2">Name</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2">Contacts</th>
                <th className="px-5 py-2">Valid / Invalid / Duplicate</th>
                <th className="px-5 py-2">Created</th>
                <th className="px-5 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns?.map((c) => (
                <tr key={c.id} className="border-b border-slate-50">
                  <td className="px-5 py-2 font-medium text-slate-800">{c.name}</td>
                  <td className="px-5 py-2">
                    <Badge tone={statusTone[c.status]}>{statusLabel[c.status]}</Badge>
                  </td>
                  <td className="px-5 py-2 text-slate-600">{c.totalContacts}</td>
                  <td className="px-5 py-2 text-slate-600">
                    {c.validCount} / {c.invalidCount} / {c.duplicateCount}
                  </td>
                  <td className="px-5 py-2 text-slate-500">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-2 text-right">
                    <Link href={`/bulk-messages/${c.id}`}>
                      <Button variant="secondary">{c.status === "DRAFT" ? "Continue Setup" : "View Dashboard"}</Button>
                    </Link>
                  </td>
                </tr>
              ))}
              {!isLoading && campaigns?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                    No campaigns yet. Upload an Excel file to get started.
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
