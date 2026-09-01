"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useUploadBulkExcel } from "@/hooks/use-bulk-messages";

export default function NewBulkCampaignPage() {
  const router = useRouter();
  const upload = useUploadBulkExcel();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{
    campaignId: string;
    totalContacts: number;
    validCount: number;
    invalidCount: number;
    duplicateCount: number;
  } | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    upload.mutate({ file, name: name || undefined }, { onSuccess: (res) => setResult(res) });
  };

  if (result) {
    return (
      <AppShell>
        <Card className="mx-auto max-w-lg">
          <CardContent className="py-8 text-center">
            <p className="text-lg font-semibold text-slate-900">File validated</p>
            <div className="mx-auto mt-4 grid max-w-sm grid-cols-2 gap-3 text-left">
              <div className="rounded-md border border-slate-200 px-3 py-2">
                <p className="text-xs uppercase text-slate-400">Total Contacts</p>
                <p className="text-lg font-semibold text-slate-900">{result.totalContacts}</p>
              </div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                <p className="text-xs uppercase text-emerald-600">Valid</p>
                <p className="text-lg font-semibold text-emerald-700">{result.validCount}</p>
              </div>
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-xs uppercase text-red-600">Invalid</p>
                <p className="text-lg font-semibold text-red-700">{result.invalidCount}</p>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs uppercase text-amber-600">Duplicate</p>
                <p className="text-lg font-semibold text-amber-700">{result.duplicateCount}</p>
              </div>
            </div>
            <div className="mt-6 flex justify-center gap-2">
              <Button onClick={() => router.push(`/bulk-messages/${result.campaignId}`)}>
                Select Recipients →
              </Button>
              <Button variant="secondary" onClick={() => router.push("/bulk-messages")}>
                Back to Campaigns
              </Button>
            </div>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">New Bulk WhatsApp Campaign</h1>

      <form onSubmit={onSubmit} className="mx-auto max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>Upload Contact List</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Campaign Name — optional</Label>
              <Input
                id="name"
                placeholder="e.g. Diwali Greetings"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="file">Excel File (.xlsx or .xls)</Label>
              <input
                id="file"
                type="file"
                required
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
              />
              <p className="mt-2 text-xs text-slate-500">
                Expected columns: Phone Number (required), Name, District, Constituency, Mandal, Booth.
              </p>
            </div>

            {upload.isError && <p className="text-xs text-red-600">{(upload.error as Error).message}</p>}

            <Button type="submit" className="w-full" disabled={!file || upload.isPending}>
              {upload.isPending ? "Uploading & validating..." : "Upload & Validate"}
            </Button>
          </CardContent>
        </Card>
      </form>
    </AppShell>
  );
}
