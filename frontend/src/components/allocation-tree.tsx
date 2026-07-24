"use client";

import { useState } from "react";
import { AllocationNode } from "@/hooks/use-allocations";
import { Badge } from "./ui/badge";

function AllocationRow({ node, depth }: { node: AllocationNode; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const achievementPct = node.target > 0 ? Math.round((node.achievedCount / node.target) * 100) : 0;

  return (
    <div>
      <div
        className="flex items-center justify-between border-b border-slate-100 py-2 text-sm"
        style={{ paddingLeft: depth * 20 }}
      >
        <div className="flex items-center gap-2">
          {hasChildren ? (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="w-4 text-slate-400 hover:text-slate-700"
              aria-label="toggle"
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-4" />
          )}
          <span className="font-medium text-slate-800">{node.region.name}</span>
          <Badge tone="slate">{node.region.type}</Badge>
          <span className="text-xs text-slate-500">Owner: {node.ownerUser.name}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span>
            Target {node.achievedCount.toLocaleString()} / {node.target.toLocaleString()} ({achievementPct}%)
          </span>
          <span>Budget ₹{Number(node.allocatedBudget).toLocaleString()}</span>
          <span>Remaining ₹{node.remainingBudget.toLocaleString()}</span>
        </div>
      </div>
      {expanded && node.children.map((child) => <AllocationRow key={child.id} node={child} depth={depth + 1} />)}
    </div>
  );
}

export function AllocationTree({ nodes }: { nodes: AllocationNode[] }) {
  if (nodes.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">No targets allocated yet.</p>;
  }
  return (
    <div>
      {nodes.map((node) => (
        <AllocationRow key={node.id} node={node} depth={0} />
      ))}
    </div>
  );
}
