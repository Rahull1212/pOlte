"use client";

import { useEffect, useId, useRef, useState } from "react";
import { TemplateButtonReplyDto } from "@/lib/shared-types";

/**
 * A Mermaid flowchart of what a template actually does: the message that
 * goes out, the buttons on it, and what each button replies with.
 *
 * The configuration is spread across a template name, a variable mapping
 * and a per-button action list — three things that individually say nothing
 * about what a Cadre experiences. Drawn as one flow, "they tap this, they
 * get that" is legible at a glance and a wrong action becomes obvious
 * before anyone sends it.
 *
 * Rendered client-side only: Mermaid needs a DOM, and importing it at
 * module scope would drag ~500KB into the server bundle.
 */
const ACTION_SUMMARY: Record<string, string> = {
  TASK_DETAILS: "Task details",
  ADMIN_CONTACT: "Admin's contact",
  CUSTOM_TEXT: "Custom message",
  NONE: "No reply",
};

/** Mermaid node text can't carry quotes or newlines — they break the parse. */
function escape(text: string): string {
  return (
    text
      // Named before the braces are stripped, or "Hi {{1}}" would preview as
      // "Hi 1" and read as the literal number. PoliOS sends exactly one
      // variable, the Cadre's name.
      .replace(/\{\{\s*1\s*\}\}/g, "(Cadre name)")
      .replace(/\{\{\s*(\d+)\s*\}\}/g, "(variable $1)")
      .replace(/["`]/g, "'")
      .replace(/[\r\n]+/g, " ")
      .replace(/[<>|{}]/g, "")
      .trim()
  );
}

function truncate(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function buildTemplateFlow(
  templateName: string,
  buttons: TemplateButtonReplyDto[],
  bodyPreview?: string,
): string {
  // classDef before any `class` that uses it — Mermaid resolves these in
  // order and a forward reference is silently dropped.
  const lines = ["flowchart TD", "  classDef muted fill:#f1f5f9,stroke:#cbd5e1,color:#64748b"];
  const sent = truncate(escape(bodyPreview?.trim() || `Template: ${templateName}`), 60);
  lines.push(`  A["📤 PoliOS sends<br/>${sent}"]`);
  lines.push(`  A --> B["📱 Cadre receives it on WhatsApp"]`);

  if (buttons.length === 0) {
    lines.push(`  B --> Z["No buttons on this template"]`);
    return lines.join("\n");
  }

  buttons.forEach((button, i) => {
    const id = `T${i}`;
    const replyId = `R${i}`;
    lines.push(`  B --> ${id}["👆 Taps '${escape(button.label)}'"]`);

    const parts: string[] = [];
    if (button.action !== "NONE") parts.push(ACTION_SUMMARY[button.action] ?? button.action);
    if (button.text?.trim()) parts.push(truncate(escape(button.text), 50));

    if (parts.length === 0) {
      // Nothing configured: the Fyxo flow answers, not PoliOS. Saying so is
      // the whole point — a silent button looks broken otherwise.
      lines.push(`  ${id} --> ${replyId}["↩️ Left to the Fyxo flow"]`);
      lines.push(`  class ${replyId} muted`);
    } else {
      lines.push(`  ${id} --> ${replyId}["💬 ${escape(parts.join(" + "))}"]`);
    }
  });

  return lines.join("\n");
}

export function TemplateFlowDiagram({
  templateName,
  buttons,
  bodyPreview,
}: {
  templateName: string;
  buttons: TemplateButtonReplyDto[];
  bodyPreview?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Mermaid ids must be unique per render or a second diagram on the page
  // overwrites the first.
  const id = useId().replace(/:/g, "");
  const source = buildTemplateFlow(templateName, buttons, bodyPreview);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          securityLevel: "strict",
          themeVariables: {
            primaryColor: "#eff6ff",
            primaryBorderColor: "#93c5fd",
            primaryTextColor: "#1e293b",
            lineColor: "#94a3b8",
            fontSize: "13px",
          },
        });
        const { svg } = await mermaid.render(`flow-${id}`, source);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (err) {
        // A diagram that won't parse must not take the form down with it —
        // the source is shown instead so it's still readable.
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not draw the diagram");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, id]);

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      {error ? (
        <>
          <p className="mb-2 text-xs text-amber-600">Couldn&apos;t draw the diagram — showing the source.</p>
          <pre className="overflow-x-auto text-xs text-slate-600">{source}</pre>
        </>
      ) : (
        <div ref={containerRef} className="overflow-x-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" />
      )}
    </div>
  );
}
