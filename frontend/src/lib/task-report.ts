import type { TaskDashboard } from "@/hooks/use-tasks";

/**
 * Builds the "Task Performance Report" PDF from exactly what the Task
 * Dashboard is showing — same numbers, same source (the Message Log), so a
 * report handed to someone cannot disagree with the screen it came from.
 *
 * jsPDF is imported dynamically: it and autotable are ~400KB together, and
 * nobody pays for that until they actually press Download.
 *
 * No table here sets `columnStyles`. In jspdf-autotable v5 pinning widths by
 * numeric column index makes the table overflow the page (measured: 215pt
 * past the right edge on a two-column table whose widths summed to 300 of
 * 515 available). Left alone, autotable measures the content and fits every
 * table correctly — so the column widths are controlled by truncating the
 * text that goes in, not by declaring widths.
 */
export async function downloadTaskReport(dashboard: TaskDashboard): Promise<void> {
  // jsPDF v4 exports the constructor as a NAMED export — its `default` is a
  // namespace object, so destructuring `default` here silently yields
  // something that is not a constructor and only fails when you press the
  // button. autotable's default IS the function.
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  const { kpis, cadres, communication, dailyProgress } = dashboard;

  // ---- Header -------------------------------------------------------------
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text("Task Performance Report", margin, y);
  y += 20;

  doc.setFontSize(12);
  doc.setTextColor(51, 65, 85);
  doc.text(truncate(dashboard.name, 70), margin, y);
  y += 16;

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated ${new Date().toLocaleString("en-IN")}  ·  PoliOS`, margin, y);
  y += 8;

  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18;

  // ---- Headline numbers ---------------------------------------------------
  const completionPct = kpis.totalAssigned > 0 ? Math.round((kpis.completed / kpis.totalAssigned) * 100) : 0;
  const responseRatePct = kpis.totalAssigned > 0 ? Math.round((kpis.responded / kpis.totalAssigned) * 100) : 0;

  autoTable(doc, {
    startY: y,
    head: [["Overall performance", ""]],
    body: [
      ["Cadres assigned", String(kpis.totalAssigned)],
      ["Completed", `${kpis.completed}  (${completionPct}%)`],
      ["In progress", String(kpis.inProgress)],
      ["Pending", String(kpis.pending)],
      ["Overdue", String(kpis.overdue)],
      ["Average progress", `${kpis.avgProgressPct}%`],
      ["Responded", `${kpis.responded}  (${responseRatePct}%)`],
      ["No response", String(kpis.noResponse)],
      ...(kpis.cancelled > 0 ? [["Removed from task", String(kpis.cancelled)]] : []),
    ],
    theme: "grid",
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 10 },
    bodyStyles: { fontSize: 9, textColor: [51, 65, 85] },
    margin: { left: margin, right: margin },
  });
  y = afterTable(doc, y) + 18;

  // ---- WhatsApp delivery --------------------------------------------------
  // Two tables rather than one, because the two count different things and
  // merging them into a single column would invite exactly the misreading
  // this split exists to prevent.
  autoTable(doc, {
    startY: y,
    head: [["WhatsApp delivery — by cadre", "Count", "Of assigned"]],
    body: [
      ["Sent", String(kpis.whatsappSent), share(kpis.whatsappSent, kpis.totalAssigned)],
      ["Delivered", String(kpis.whatsappDelivered), share(kpis.whatsappDelivered, kpis.totalAssigned)],
      ["Read", String(kpis.whatsappRead), share(kpis.whatsappRead, kpis.totalAssigned)],
      ["Failed", String(kpis.whatsappFailed), share(kpis.whatsappFailed, kpis.totalAssigned)],
    ],
    theme: "grid",
    headStyles: { fillColor: [16, 185, 129], textColor: 255, fontSize: 10 },
    bodyStyles: { fontSize: 9, textColor: [51, 65, 85] },
    margin: { left: margin, right: margin },
  });
  y = afterTable(doc, y) + 14;

  autoTable(doc, {
    startY: y,
    head: [["WhatsApp delivery — by message", "Count", "Rate"]],
    body: [
      ["Messages sent (incl. retries)", String(communication.total), "—"],
      ["Delivered", String(communication.delivered), `${communication.deliveryRatePct}%`],
      ["Read", String(communication.read), `${communication.readRatePct}%`],
      ["Failed", String(communication.failed), `${communication.failureRatePct}%`],
    ],
    theme: "grid",
    headStyles: { fillColor: [100, 116, 139], textColor: 255, fontSize: 10 },
    bodyStyles: { fontSize: 9, textColor: [51, 65, 85] },
    margin: { left: margin, right: margin },
  });
  y = afterTable(doc, y) + 6;

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  // splitTextToSize wraps to the usable width; a single long string would
  // otherwise run straight off the right edge with no warning at all.
  const note = doc.splitTextToSize(
    "Delivered includes Read, and Sent includes both — they are stages of one message, not separate groups.",
    pageWidth - margin * 2,
  );
  doc.text(note, margin, y);
  y += note.length * 11 + 12;

  // ---- Per-cadre breakdown ------------------------------------------------
  if (cadres.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Cadre", "Area", "Status", "Progress", "WhatsApp", "Responded"]],
      body: cadres.map((c) => [
        truncate(c.name, 20),
        truncate(c.area, 24),
        humanise(c.status),
        `${c.progressPct}%`,
        humanise(c.whatsappStatus),
        // An unset acknowledgment means the same thing as AWAITING here:
        // nothing has come back from that Cadre.
        !c.acknowledgment || c.acknowledgment === "AWAITING" ? "No" : humanise(c.acknowledgment),
      ]),
      theme: "striped",
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8, textColor: [51, 65, 85] },
      margin: { left: margin, right: margin },
    });
    y = afterTable(doc, y) + 18;
  }

  // ---- Daily progress -----------------------------------------------------
  if (dailyProgress.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Date", "Updates submitted", "Avg completion"]],
      body: dailyProgress.map((d) => [d.date, String(d.updatesSubmitted), `${d.avgCompletionPct}%`]),
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

  doc.save(`${slug(dashboard.name)}-performance-report.pdf`);
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

// Tolerates a missing value rather than throwing: one unexpected row must
// not take down the whole report the user just asked to download.
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
      .slice(0, 60) || "task"
  );
}
