"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { useEngagementSummary, EngagementFilters, ButtonBreakdown } from "@/hooks/use-engagement";

/**
 * Which button each Cadre pressed.
 *
 * A KPI per button, and under each one the people who chose it — so
 * "Are you interested? Yes / No" answers both "how many said yes" and
 * "which of my Cadres said yes", which is the part a name-less count can
 * never give you.
 *
 * Counted per person, not per tap: someone who presses Yes twice is one
 * person who said yes.
 */
export function ButtonResponsesCard({ filters, title = "Who pressed which button" }: { filters: EngagementFilters; title?: string }) {
  const { data, isLoading } = useEngagementSummary(filters);
  const [open, setOpen] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-sm text-slate-500">Loading responses…</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  // Buttons nobody pressed are still shown — "No: 0" is a real answer, and
  // hiding it reads as though the option was never offered. But if NOTHING
  // has been pressed at all, the list of zeros says less than one sentence.
  const anyPressed = data.byButton.some((b) => b.count > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <span className="text-xs text-slate-400">
          {data.responded} of {data.totalSent} responded · {data.responseRatePct}%
        </span>
      </CardHeader>
      <CardContent>
        {!anyPressed ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Nobody has pressed a button yet.
            {data.totalSent > 0 && ` ${data.notResponded} of ${data.totalSent} recipients haven't responded.`}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {data.byButton.map((button) => (
                <ButtonTile
                  key={button.label}
                  button={button}
                  total={data.responded}
                  isOpen={open === button.label}
                  onToggle={() => setOpen(open === button.label ? null : button.label)}
                />
              ))}
            </div>

            {/* The names behind whichever tile is open. */}
            {open && <Pressers button={data.byButton.find((b) => b.label === open)} />}

            <p className="mt-3 text-xs text-slate-400">
              Tap a button above to see who chose it. Counted per person, so pressing twice counts once.
              {data.otherResponses > 0 && ` ${data.otherResponses} replied with a message instead of a button.`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ButtonTile({
  button,
  total,
  isOpen,
  onToggle,
}: {
  button: ButtonBreakdown;
  total: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const share = total > 0 ? Math.round((button.count / total) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={button.count === 0}
      className={`rounded-lg border px-4 py-3 text-left transition ${
        isOpen
          ? "border-brand-400 bg-brand-50"
          : button.count > 0
            ? "border-slate-200 hover:border-brand-300 hover:bg-slate-50"
            : "border-slate-200 opacity-60"
      }`}
    >
      <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">{button.label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{button.count}</p>
      <p className="text-xs text-slate-400">{button.count > 0 ? `${share}% of responders` : "nobody"}</p>
    </button>
  );
}

function Pressers({ button }: { button?: ButtonBreakdown }) {
  if (!button || button.cadres.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-slate-200">
      <div className="border-b border-slate-100 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        Pressed &ldquo;{button.label}&rdquo;
      </div>
      <ul className="divide-y divide-slate-50">
        {button.cadres.map((c, i) => (
          <li key={`${c.cadreId ?? c.cadrePhone}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{c.cadreName}</p>
              <p className="truncate text-xs text-slate-400">
                {c.cadrePhone}
                {c.taskName ? ` · ${c.taskName}` : ""}
              </p>
            </div>
            <Badge tone="slate">
              {new Date(c.at).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
