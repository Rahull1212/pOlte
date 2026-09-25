import type { PollDashboard } from "@/hooks/use-polls";

/**
 * The "Poll Results Report" PDF, built from exactly what the poll dashboard
 * is showing — same numbers, same source (the captured button taps), so a
 * report handed to someone cannot disagree with the screen it came from.
 *
 * jsPDF is imported dynamically: it and autotable are ~400KB together, and
 * nobody pays for that until they actually press Download.
 *
 * No table here sets `columnStyles`. In jspdf-autotable v5 pinning widths by
 * numeric column index makes the table overflow the page; left alone,
 * autotable measures the content and fits every table correctly. Column
 * widths are controlled by truncating the text that goes in.
 */
export async function downloadPollReport(dashboard: PollDashboard): Promise<void> {
  // jsPDF v4 exports the constructor as a NAMED export — its `default` is a
  // namespace object, so destructuring `default` yields something that is not
  // a constructor and only fails when the button is pressed.
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  const { kpis, tally, respondents, timeline } = dashboard;

  // ---- Header -------------------------------------------------------------
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text("Poll Results Report", margin, y);
  y += 20;

  doc.setFontSize(12);
  doc.setTextColor(51, 65, 85);
  const question = doc.splitTextToSize(dashboard.question, pageWidth - margin * 2);
  doc.text(question, margin, y);
  y += question.length * 15 + 2;

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  const meta = [
    `Generated ${new Date().toLocaleString("en-IN")}`,
    dashboard.templateName ? `Template: ${dashboard.templateName}` : null,
    dashboard.taskId ? "Attached to a task" : "Standalone poll",
  ]
    .filter(Boolean)
    .join("  ·  ");
  doc.text(meta, margin, y);
  y += 8;

  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18;

  // ---- Headline numbers ---------------------------------------------------
  autoTable(doc, {
    startY: y,
    head: [["Participation", ""]],
    body: [
      ["Cadres it went to", String(kpis.totalRecipients)],
      ["Delivered", String(kpis.sent)],
      ["Failed to send", String(kpis.failed)],
      ["Answered", `${kpis.answered}  (${kpis.responseRatePct}%)`],
      ["No response", String(kpis.noResponse)],
    ],
    theme: "grid",
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 10 },
    bodyStyles: { fontSize: 9, textColor: [51, 65, 85] },
    margin: { left: margin, right: margin },
  });
  y = afterTable(doc, y) + 18;

  // ---- Did they respond at all? -------------------------------------------
  // Drawn against everyone the poll reached, so "answered" is read next to
  // the silence rather than on its own.
  y = drawBarChart(doc, {
    title: "Who responded",
    x: margin,
    y,
    width: pageWidth - margin * 2,
    total: kpis.sent,
    totalCaption: `of ${kpis.sent} delivered`,
    bars: [
      { label: "Responded", value: kpis.answered, color: [16, 185, 129] },
      { label: "No response", value: kpis.noResponse, color: [148, 163, 184] },
      ...(kpis.failed > 0 ? [{ label: "Failed to send", value: kpis.failed, color: [239, 68, 68] as RGB }] : []),
    ],
  });
  y += 16;

  // ---- The answers --------------------------------------------------------
  const totalVotes = tally.reduce((sum, t) => sum + t.votes, 0);

  // One bar per answer — the "how many pressed Yes, how many No" picture.
  if (tally.length > 0) {
    y = drawBarChart(doc, {
      title: "How they answered",
      x: margin,
      y,
      width: pageWidth - margin * 2,
      total: totalVotes,
      totalCaption: totalVotes === 1 ? "1 answer" : `${totalVotes} answers`,
      bars: tally.map((t, i) => ({ label: t.option, value: t.votes, color: colorFor(t.option, i) })),
    });
    y += 16;
  }
  autoTable(doc, {
    startY: y,
    head: [["Answer", "Votes", "Share of answers"]],
    body:
      tally.length > 0
        ? tally.map((t) => [truncate(t.option, 46), String(t.votes), share(t.votes, totalVotes)])
        : [["No answer options recorded", "—", "—"]],
    theme: "grid",
    headStyles: { fillColor: [16, 185, 129], textColor: 255, fontSize: 10 },
    bodyStyles: { fontSize: 9, textColor: [51, 65, 85] },
    margin: { left: margin, right: margin },
  });
  y = afterTable(doc, y) + 18;

  // ---- Who answered what --------------------------------------------------
  if (respondents.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Cadre", "Area", "Delivery", "Answer", "Answered at"]],
      body: respondents.map((r) => [
        truncate(r.cadreName, 22),
        truncate(r.area, 26),
        humanise(r.status),
        answerOf(r, dashboard.options),
        r.answeredAt ? formatWhen(r.answeredAt) : "—",
      ]),
      theme: "striped",
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8, textColor: [51, 65, 85] },
      margin: { left: margin, right: margin },
    });
    y = afterTable(doc, y) + 18;
  }

  // ---- Activity -----------------------------------------------------------
  if (timeline.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["When", "Event", "Cadre", "Detail"]],
      // Capped: the full history of a large poll would bury the results it is
      // meant to support.
      body: timeline.slice(0, 40).map((e) => [
        formatWhen(e.at),
        e.type === "ANSWERED" ? "Answered" : "Sent",
        truncate(e.cadreName, 22),
        truncate(e.detail ?? "—", 26),
      ]),
      theme: "grid",
      headStyles: { fillColor: [100, 116, 139], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8, textColor: [51, 65, 85] },
      margin: { left: margin, right: margin },
    });
  }

  // ---- Page numbers -------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${i} of ${pages}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 20, {
      align: "right",
    });
  }

  doc.save(`${slug(dashboard.question)}-poll-report.pdf`);
}

/** What this person answered, preferring the label exactly as they tapped it. */
function answerOf(
  r: { answerLabel?: string | null; selectedOption: number | null },
  options: string[],
): string {
  if (r.answerLabel) return truncate(r.answerLabel, 24);
  if (r.selectedOption !== null) return truncate(options[r.selectedOption] ?? "—", 24);
  return "No answer";
}

/**
 * autotable records where it finished on the doc; falling back to the
 * previous y keeps the next table on the page rather than at the origin if
 * that ever comes back undefined.
 */
function afterTable(doc: unknown, fallback: number): number {
  const last = (doc as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
  return last?.finalY ?? fallback;
}

function share(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Tolerates a missing value rather than throwing: one unexpected row must not
// take down the whole report the user just asked to download.
function humanise(value: string | null | undefined): string {
  if (!value) return "—";
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "poll"
  );
}

type RGB = [number, number, number];

interface BarChartOptions {
  title: string;
  x: number;
  y: number;
  width: number;
  /** What the bars are a share OF — the denominator for each bar's length. */
  total: number;
  totalCaption: string;
  bars: { label: string; value: number; color: RGB }[];
}

/**
 * A horizontal bar chart drawn with jsPDF primitives.
 *
 * Horizontal rather than vertical so answer labels read normally however long
 * they are — a rotated or truncated label under a vertical column is the
 * usual reason these become unreadable. No charting library: rectangles and
 * text are all this needs, and pulling in a canvas-based chart package to
 * draw four boxes would cost hundreds of KB for nothing.
 *
 * Returns the y coordinate below the chart, so callers keep stacking.
 */
function drawBarChart(doc: JsPdfLike, options: BarChartOptions): number {
  const { title, x, width, total, totalCaption, bars } = options;
  let y = options.y;

  const labelWidth = 118;
  const valueWidth = 62;
  const trackWidth = Math.max(60, width - labelWidth - valueWidth);
  const rowHeight = 20;
  const barHeight = 11;

  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(title, x, y);

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(totalCaption, x + width, y, { align: "right" });
  y += 12;

  // Everything is drawn against `total`, never against the largest bar:
  // scaling to the biggest value would make a 1-vote winner fill the page and
  // read as unanimous.
  for (const bar of bars) {
    const safeTotal = total > 0 ? total : 1;
    const filled = Math.max(0, Math.min(1, bar.value / safeTotal));

    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(truncate(bar.label, 20), x, y + barHeight - 2);

    // The track, so a small bar is still legible as a small share of
    // something rather than as a stray mark.
    doc.setFillColor(241, 245, 249);
    doc.rect(x + labelWidth, y, trackWidth, barHeight, "F");

    if (filled > 0) {
      doc.setFillColor(bar.color[0], bar.color[1], bar.color[2]);
      // A non-zero value always gets a visible sliver; rounding it to nothing
      // would show "1 vote" as an empty row.
      doc.rect(x + labelWidth, y, Math.max(2, trackWidth * filled), barHeight, "F");
    }

    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `${bar.value}${total > 0 ? `  (${Math.round(filled * 100)}%)` : ""}`,
      x + labelWidth + trackWidth + 6,
      y + barHeight - 2,
    );

    y += rowHeight;
  }

  return y;
}

/**
 * Yes/no answers get the colours people already expect; anything else takes a
 * neutral palette colour by its position, so two options never share one.
 *
 * Keyed on position rather than a running counter: a counter that survives
 * between calls would give the same poll different colours on every download,
 * and two copies of one report should look identical.
 */
const NEUTRAL_PALETTE: RGB[] = [
  [37, 99, 235],
  [139, 92, 246],
  [234, 88, 12],
  [8, 145, 178],
];

function colorFor(label: string, index: number): RGB {
  const text = label.trim().toLowerCase();
  if (/^(yes|interested|accept|accepted|completed|done|agree)$/.test(text)) return [16, 185, 129];
  if (/^(no|not interested|decline|declined|reject|disagree)$/.test(text)) return [239, 68, 68];
  if (/^(maybe|need help|help|later|in progress)$/.test(text)) return [245, 158, 11];
  return NEUTRAL_PALETTE[index % NEUTRAL_PALETTE.length];
}

/** Only the jsPDF surface this file's drawing helpers actually touch. */
interface JsPdfLike {
  setFontSize(size: number): void;
  setTextColor(r: number, g: number, b: number): void;
  setFillColor(r: number, g: number, b: number): void;
  rect(x: number, y: number, w: number, h: number, style?: string): void;
  text(text: string, x: number, y: number, options?: { align?: string }): void;
}
