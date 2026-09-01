"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import clsx from "clsx";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  useBulkCampaign,
  useBulkRecipients,
  useBulkFilterOptions,
  useUpdateBulkSelection,
  useComposeBulkMessage,
  useSendBulkCampaign,
  useBulkDashboard,
  BulkCampaign,
  BulkRecipient,
} from "@/hooks/use-bulk-messages";
import { BulkRecipientStatus } from "@/lib/shared-types";

const recipientStatusTone: Record<BulkRecipientStatus, "slate" | "blue" | "green" | "red" | "amber"> = {
  PENDING: "slate",
  SENT: "blue",
  DELIVERED: "green",
  READ: "green",
  FAILED: "red",
  OPTED_OUT: "amber",
};

const recipientStatusLabel: Record<BulkRecipientStatus, string> = {
  PENDING: "Pending",
  SENT: "Sent",
  DELIVERED: "Delivered",
  READ: "Read",
  FAILED: "Failed",
  OPTED_OUT: "Opted Out",
};

function personalize(template: string, name?: string | null) {
  return template.replace(/\{\{\s*name\s*\}\}/gi, name?.trim() || "there");
}

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone ?? "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function FyxoBanner({ note }: { note: string }) {
  return (
    <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <span className="font-medium">Fyxo Connect is not configured yet.</span> {note}
    </div>
  );
}

export default function BulkCampaignPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: campaign, isLoading } = useBulkCampaign(id);

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Loading…</p>
      </AppShell>
    );
  }
  if (!campaign) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Campaign not found.</p>
      </AppShell>
    );
  }

  if (campaign.status !== "DRAFT") {
    return <CampaignDashboard campaignId={id} />;
  }
  return <CampaignWizard campaignId={id} campaign={campaign} />;
}

function CampaignWizard({ campaignId, campaign }: { campaignId: string; campaign: BulkCampaign }) {
  const [step, setStep] = useState<"recipients" | "compose" | "preview">("recipients");

  const steps: { key: typeof step; label: string }[] = [
    { key: "recipients", label: "1. Recipients" },
    { key: "compose", label: "2. Message" },
    { key: "preview", label: "3. Preview & Send" },
  ];

  return (
    <AppShell>
      <div className="mb-6">
        <Link href="/bulk-messages" className="text-xs text-brand-600 hover:underline">
          ← Back to Campaigns
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-slate-900">{campaign.name}</h1>
      </div>

      <div className="mb-6 flex gap-2">
        {steps.map((s) => (
          <button
            key={s.key}
            onClick={() => setStep(s.key)}
            className={clsx(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              step === s.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {step === "recipients" && <RecipientsStep campaignId={campaignId} onNext={() => setStep("compose")} />}
      {step === "compose" && (
        <ComposeStep campaignId={campaignId} campaign={campaign} onNext={() => setStep("preview")} />
      )}
      {step === "preview" && <PreviewSendStep campaignId={campaignId} campaign={campaign} />}
    </AppShell>
  );
}

function RecipientsStep({ campaignId, onNext }: { campaignId: string; onNext: () => void }) {
  const { data: recipients } = useBulkRecipients(campaignId);
  const { data: filterOptions } = useBulkFilterOptions(campaignId);
  const updateSelection = useUpdateBulkSelection(campaignId);

  const [district, setDistrict] = useState("");
  const [constituency, setConstituency] = useState("");
  const [mandal, setMandal] = useState("");
  const [booth, setBooth] = useState("");
  const [search, setSearch] = useState("");
  const [showCount, setShowCount] = useState(100);

  const options = filterOptions ?? [];
  const distinct = (values: (string | null)[]) => Array.from(new Set(values.filter((v): v is string => Boolean(v))));

  const districts = useMemo(() => distinct(options.map((f) => f.districtName)), [options]);
  const constituencies = useMemo(
    () => distinct(options.filter((f) => !district || f.districtName === district).map((f) => f.constituencyName)),
    [options, district],
  );
  const mandals = useMemo(
    () =>
      distinct(
        options
          .filter((f) => (!district || f.districtName === district) && (!constituency || f.constituencyName === constituency))
          .map((f) => f.mandalName),
      ),
    [options, district, constituency],
  );
  const booths = useMemo(
    () =>
      distinct(
        options
          .filter(
            (f) =>
              (!district || f.districtName === district) &&
              (!constituency || f.constituencyName === constituency) &&
              (!mandal || f.mandalName === mandal),
          )
          .map((f) => f.boothName),
      ),
    [options, district, constituency, mandal],
  );

  const filtered = useMemo(() => {
    return (recipients ?? []).filter((r) => {
      if (district && r.districtName !== district) return false;
      if (constituency && r.constituencyName !== constituency) return false;
      if (mandal && r.mandalName !== mandal) return false;
      if (booth && r.boothName !== booth) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(r.name?.toLowerCase().includes(q) || r.phone.includes(q))) return false;
      }
      return true;
    });
  }, [recipients, district, constituency, mandal, booth, search]);

  const selectedCount = (recipients ?? []).filter((r) => r.selected).length;
  const eligibleCount = (recipients ?? []).filter((r) => r.isValidPhone && !r.isDuplicate).length;
  const invalidCount = (recipients ?? []).filter((r) => !r.isValidPhone).length;
  const duplicateCount = (recipients ?? []).filter((r) => r.isValidPhone && r.isDuplicate).length;

  const applyFilterSelection = (selected: boolean) => {
    updateSelection.mutate({
      selected,
      filter: {
        district: district || undefined,
        constituency: constituency || undefined,
        mandal: mandal || undefined,
        booth: booth || undefined,
      },
    });
  };

  const toggleOne = (r: BulkRecipient) => {
    if (!r.isValidPhone || r.isDuplicate) return;
    updateSelection.mutate({ selected: !r.selected, recipientIds: [r.id] });
  };

  const hasFilter = Boolean(district || constituency || mandal || booth);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Selected" value={selectedCount} tone="text-brand-700" />
        <Kpi label="Eligible" value={eligibleCount} />
        <Kpi label="Invalid" value={invalidCount} tone="text-red-600" />
        <Kpi label="Duplicate" value={duplicateCount} tone="text-amber-600" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter by Area</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={district}
              onChange={(e) => {
                setDistrict(e.target.value);
                setConstituency("");
                setMandal("");
                setBooth("");
              }}
            >
              <option value="">All Districts</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={constituency}
              onChange={(e) => {
                setConstituency(e.target.value);
                setMandal("");
                setBooth("");
              }}
            >
              <option value="">All Constituencies</option>
              {constituencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={mandal}
              onChange={(e) => {
                setMandal(e.target.value);
                setBooth("");
              }}
            >
              <option value="">All Mandals</option>
              {mandals.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={booth}
              onChange={(e) => setBooth(e.target.value)}
            >
              <option value="">All Booths</option>
              {booths.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => updateSelection.mutate({ selected: true })}>
              Select All ({eligibleCount})
            </Button>
            <Button variant="secondary" onClick={() => updateSelection.mutate({ selected: false })}>
              Deselect All
            </Button>
            {hasFilter && (
              <>
                <Button variant="secondary" onClick={() => applyFilterSelection(true)}>
                  Select Filtered ({filtered.length})
                </Button>
                <Button variant="secondary" onClick={() => applyFilterSelection(false)}>
                  Deselect Filtered
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>
            Contacts <span className="font-normal text-slate-400">({filtered.length})</span>
          </CardTitle>
          <Input
            placeholder="Search name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-2">Selected</th>
                <th className="px-5 py-2">Name</th>
                <th className="px-5 py-2">Phone</th>
                <th className="px-5 py-2">District</th>
                <th className="px-5 py-2">Mandal</th>
                <th className="px-5 py-2">Booth</th>
                <th className="px-5 py-2">Validity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, showCount).map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="px-5 py-2">
                    <input
                      type="checkbox"
                      checked={r.selected}
                      disabled={!r.isValidPhone || r.isDuplicate}
                      onChange={() => toggleOne(r)}
                    />
                  </td>
                  <td className="px-5 py-2 text-slate-800">{r.name || "—"}</td>
                  <td className="px-5 py-2 text-slate-600">{r.phone || r.rawPhone}</td>
                  <td className="px-5 py-2 text-slate-600">{r.districtName || "—"}</td>
                  <td className="px-5 py-2 text-slate-600">{r.mandalName || "—"}</td>
                  <td className="px-5 py-2 text-slate-600">{r.boothName || "—"}</td>
                  <td className="px-5 py-2">
                    {!r.isValidPhone ? (
                      <Badge tone="red">Invalid</Badge>
                    ) : r.isDuplicate ? (
                      <Badge tone="amber">Duplicate</Badge>
                    ) : (
                      <Badge tone="green">Valid</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-slate-400">
                    No contacts match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {filtered.length > showCount && (
            <div className="border-t border-slate-100 px-5 py-3 text-center">
              <button
                className="text-sm text-brand-600 hover:underline"
                onClick={() => setShowCount((c) => c + 200)}
              >
                Show more ({filtered.length - showCount} remaining)
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={selectedCount === 0}>
          Continue to Message ({selectedCount} selected) →
        </Button>
      </div>
    </div>
  );
}

function ComposeStep({
  campaignId,
  campaign,
  onNext,
}: {
  campaignId: string;
  campaign: BulkCampaign;
  onNext: () => void;
}) {
  const compose = useComposeBulkMessage(campaignId);
  const { data: recipients } = useBulkRecipients(campaignId);
  const [text, setText] = useState(campaign.messageText ?? "");
  const [mediaUrl, setMediaUrl] = useState(campaign.mediaUrl ?? "");
  const [templateId, setTemplateId] = useState(campaign.templateId ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sampleName = recipients?.find((r) => r.selected)?.name;

  const insertToken = () => {
    const el = textareaRef.current;
    const token = "{{name}}";
    if (!el) {
      setText((t) => t + token);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + token + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  };

  const onSave = () => {
    compose.mutate(
      { messageText: text, mediaUrl: mediaUrl || undefined, templateId: templateId || undefined },
      { onSuccess: onNext },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compose Message</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label htmlFor="messageText">Message</Label>
            <button type="button" onClick={insertToken} className="text-xs text-brand-600 hover:underline">
              Insert {"{{name}}"}
            </button>
          </div>
          <Textarea
            id="messageText"
            ref={textareaRef}
            rows={6}
            maxLength={4096}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Hi {{name}}, ..."
          />
          <p className="mt-1 text-right text-xs text-slate-400">{text.length} / 4096</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="mediaUrl">Media URL — optional</Label>
            <Input id="mediaUrl" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <Label htmlFor="templateId">Fyxo Connect Template ID — optional</Label>
            <Input
              id="templateId"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              placeholder="Only if Fyxo Connect requires a template"
            />
          </div>
        </div>

        {text && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium uppercase text-slate-400">Preview{sampleName ? ` (as ${sampleName})` : ""}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{personalize(text, sampleName)}</p>
          </div>
        )}

        {compose.isError && <p className="text-xs text-red-600">{(compose.error as Error).message}</p>}

        <Button onClick={onSave} disabled={!text.trim() || compose.isPending}>
          {compose.isPending ? "Saving..." : "Save & Continue →"}
        </Button>
      </CardContent>
    </Card>
  );
}

function PreviewSendStep({ campaignId, campaign }: { campaignId: string; campaign: BulkCampaign }) {
  const router = useRouter();
  const { data: recipients } = useBulkRecipients(campaignId);
  const send = useSendBulkCampaign(campaignId);

  const selected = (recipients ?? []).filter((r) => r.selected);

  const onSend = () => {
    if (!window.confirm(`Send this message to ${selected.length} recipient(s) now? This cannot be undone.`)) return;
    send.mutate(undefined, { onSuccess: () => router.push(`/bulk-messages/${campaignId}`) });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview & Send</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!campaign.fyxoConfigured && (
          <FyxoBanner note="Sending will be simulated — recipients are marked Sent and logged on the backend, but no real WhatsApp message goes out until Fyxo Connect credentials are configured." />
        )}

        <div>
          <p className="text-xs font-medium uppercase text-slate-400">Recipients</p>
          <p className="text-sm text-slate-700">{selected.length} selected</p>
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase text-slate-400">
            Message preview{selected[0]?.name ? ` (as ${selected[0].name})` : ""}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
            {personalize(campaign.messageText ?? "", selected[0]?.name)}
          </p>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium uppercase text-slate-400">Sample recipients</p>
          <ul className="max-h-40 overflow-y-auto rounded-md border border-slate-200 text-sm">
            {selected.slice(0, 10).map((r) => (
              <li key={r.id} className="border-b border-slate-50 px-3 py-1.5 last:border-0">
                {r.name || "—"} · {r.phone}
              </li>
            ))}
          </ul>
          {selected.length > 10 && <p className="mt-1 text-xs text-slate-400">and {selected.length - 10} more…</p>}
        </div>

        {send.isError && <p className="text-xs text-red-600">{(send.error as Error).message}</p>}

        <Button
          onClick={onSend}
          disabled={selected.length === 0 || !campaign.messageText || send.isPending}
          className="w-full"
        >
          {send.isPending ? "Sending…" : `Confirm & Send to ${selected.length}`}
        </Button>
      </CardContent>
    </Card>
  );
}

function CampaignDashboard({ campaignId }: { campaignId: string }) {
  const { data, isLoading, refetch, isFetching } = useBulkDashboard(campaignId);

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Loading…</p>
      </AppShell>
    );
  }
  if (!data) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Campaign not found.</p>
      </AppShell>
    );
  }

  const { campaign, kpis, recipients } = data;

  const deliveryDetail = (r: BulkRecipient) => {
    switch (r.status) {
      case "FAILED":
        return r.failedReason || "Failed";
      case "DELIVERED":
        return `Delivered${r.deliveredAt ? ` at ${new Date(r.deliveredAt).toLocaleTimeString()}` : ""}`;
      case "READ":
        return `Read${r.readAt ? ` at ${new Date(r.readAt).toLocaleTimeString()}` : ""}`;
      case "SENT":
        return "Awaiting delivery confirmation";
      case "OPTED_OUT":
        return "Recipient opted out";
      default:
        return "Not sent yet";
    }
  };

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/bulk-messages" className="text-xs text-brand-600 hover:underline">
            ← Back to Campaigns
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">{campaign.name} — Campaign Dashboard</h1>
        </div>
        <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {!campaign.fyxoConfigured && (
        <FyxoBanner note="This campaign was sent in simulated mode — recipients were marked Sent and logged on the backend, but no real WhatsApp messages went out. Delivered/Read counts will stay at zero until Fyxo Connect is configured and its status webhook is wired up." />
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Kpi label="Total Recipients" value={kpis.totalRecipients} />
        <Kpi label="Sent" value={kpis.sent} tone="text-blue-600" />
        <Kpi label="Delivered" value={kpis.delivered} tone="text-emerald-600" />
        <Kpi label="Read" value={kpis.read} tone="text-emerald-600" />
        <Kpi label="Failed" value={kpis.failed} tone="text-red-600" />
        <Kpi label="Pending" value={kpis.pending} />
        <Kpi label="Invalid Numbers" value={kpis.invalidNumbers} tone="text-red-600" />
        <Kpi label="Opted Out" value={kpis.optedOut} tone="text-amber-600" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recipient Status</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-2">Name</th>
                <th className="px-5 py-2">Phone</th>
                <th className="px-5 py-2">District</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2">Sent Time</th>
                <th className="px-5 py-2">Delivery Status</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="px-5 py-2 text-slate-800">{r.name || "—"}</td>
                  <td className="px-5 py-2 text-slate-600">{r.phone || r.rawPhone}</td>
                  <td className="px-5 py-2 text-slate-600">{r.districtName || "—"}</td>
                  <td className="px-5 py-2">
                    <Badge tone={recipientStatusTone[r.status]}>{recipientStatusLabel[r.status]}</Badge>
                  </td>
                  <td className="px-5 py-2 text-slate-500">{r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}</td>
                  <td className="px-5 py-2 text-slate-500">{deliveryDetail(r)}</td>
                </tr>
              ))}
              {recipients.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-slate-400">
                    No recipients.
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
