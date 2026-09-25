"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { useRespondToCampaign } from "@/hooks/use-campaigns";
import { ApiError } from "@/lib/api-client";
import { CampaignAssignmentStatus } from "@/lib/shared-types";
import { formatDateTime } from "./campaign-ui";

/**
 * Where an Admin accepts or declines a campaign they were handed.
 *
 * Shown only to the Admin the campaign was assigned to — a Super Admin sees
 * nothing here, because creating a campaign and taking it on are different
 * acts and they already did the first one.
 *
 * While the answer is PENDING this is the loudest thing on the page, since
 * nothing else the Admin might try (filing tasks, allocating to Cadres) will
 * work until they answer.
 */
export function CampaignResponseBanner({
  campaignId,
  campaignName,
  assignment,
}: {
  campaignId: string;
  campaignName: string;
  assignment: {
    status: CampaignAssignmentStatus;
    respondedAt: string | null;
    responseNote: string | null;
  };
}) {
  const respond = useRespondToCampaign(campaignId);
  // null = no dialog open; otherwise which answer is being confirmed.
  const [confirming, setConfirming] = useState<"ACCEPTED" | "DECLINED" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (assignment.status === "ACCEPTED") {
    return (
      <Card className="mb-4 border-emerald-200 bg-emerald-50/60">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="text-sm font-medium text-emerald-800">You accepted this campaign</p>
            <p className="text-xs text-emerald-700">
              You can now create tasks under it and allocate them to your Cadres.
              {assignment.respondedAt && ` Accepted ${formatDateTime(assignment.respondedAt)}.`}
            </p>
          </div>
          <Badge tone="green">ACCEPTED</Badge>
        </CardContent>
      </Card>
    );
  }

  if (assignment.status === "DECLINED") {
    return (
      <Card className="mb-4 border-red-200 bg-red-50/60">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="text-sm font-medium text-red-800">You declined this campaign</p>
            <p className="text-xs text-red-700">
              {assignment.responseNote ? `Reason: ${assignment.responseNote}. ` : ""}
              You cannot assign work under it. Ask the Super Admin to reassign it if this was a mistake.
            </p>
          </div>
          <Badge tone="red">DECLINED</Badge>
        </CardContent>
      </Card>
    );
  }

  const submit = (status: "ACCEPTED" | "DECLINED") => {
    setError(null);
    if (status === "DECLINED" && !note.trim()) {
      setError("Give a reason so the Super Admin knows why.");
      return;
    }
    respond.mutate(
      { status, note: note.trim() || undefined },
      {
        onSuccess: () => setConfirming(null),
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : "Could not record your answer"),
      },
    );
  };

  return (
    <Card className="mb-4 border-amber-200 bg-amber-50/60">
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-amber-900">
              You&apos;ve been assigned &quot;{campaignName}&quot;
            </p>
            <p className="text-xs text-amber-800">
              Accept it to create tasks under it and allocate them to your Cadres. Until you answer, you
              can look at the campaign but not assign any of its work.
            </p>
          </div>
          <Badge tone="amber">AWAITING YOUR RESPONSE</Badge>
        </div>

        {confirming === null ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setConfirming("ACCEPTED")}>Accept Campaign</Button>
            <Button variant="danger" onClick={() => setConfirming("DECLINED")}>
              Decline
            </Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-md border border-amber-200 bg-white p-3">
            <Label htmlFor="response-note">
              {confirming === "DECLINED" ? "Reason for declining" : "Note — optional"}
            </Label>
            <Textarea
              id="response-note"
              rows={2}
              autoFocus
              placeholder={
                confirming === "DECLINED"
                  ? "e.g. No Cadres free this month"
                  : "Anything the Super Admin should know"
              }
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {/* The Super Admin is notified with this text — a decline they
                can't understand is a campaign that stalls with no explanation. */}
            <p className="text-xs text-slate-400">This is sent to the Super Admin who assigned it.</p>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={respond.isPending}
                onClick={() => {
                  setConfirming(null);
                  setNote("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={confirming === "DECLINED" ? "danger" : "primary"}
                disabled={respond.isPending}
                onClick={() => submit(confirming)}
              >
                {respond.isPending
                  ? "Saving…"
                  : confirming === "DECLINED"
                    ? "Confirm Decline"
                    : "Confirm Accept"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
