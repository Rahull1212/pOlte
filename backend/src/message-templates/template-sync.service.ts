import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface SyncedTemplate {
  name: string;
  language: string;
  body?: string;
  status?: string;
  variables?: number;
  buttons?: string[];
  category?: string;
}

export interface SyncResult {
  ok: boolean;
  source: string | null;
  imported: number;
  // Shown verbatim to the Super Admin — this is the whole value of the
  // button when nothing can be fetched, so it must say what was tried and
  // what to do next, never just "sync failed".
  message: string;
}

// /v1/templates is the real one, confirmed against the live API on
// 2026-09-10 — it answers with
//   { success: true, data: { templates: [ { name, language, category,
//     status, variables, headerFormat, quickReplies, createdAt } ] } }
// It is NOT in the published API doc, and it returned 401 UNAUTHORIZED
// earlier the same day before starting to work, so treat a 401 from it as
// "try again / ask Fyxo", not as proof the route is missing. The remaining
// paths are fallbacks in case it moves; FYXO_TEMPLATES_PATH overrides all of
// them if Fyxo ever names a different one.
const FYXO_CANDIDATE_PATHS = ["/v1/templates", "/v1/message_templates", "/v1/message-templates", "/v1/whatsapp/templates"];

/**
 * "Sync templates" — pulls the list of approved WhatsApp templates from
 * whichever provider can actually supply it, so an Admin's template is picked
 * from a list instead of typed from memory (a typo'd name is invisible until
 * a real send fails).
 *
 * Two sources, tried in order:
 *   1. Fyxo Connect's /v1/templates — the normal path, since Fyxo is what
 *      actually sends the messages.
 *   2. Meta WhatsApp Cloud API — GET /{waba_id}/message_templates, used only
 *      if Fyxo returns nothing. Needs WHATSAPP_WABA_ID and
 *      WHATSAPP_ACCESS_TOKEN; templates live in Meta regardless of which BSP
 *      delivers them, so the names it returns are the same names Fyxo sends
 *      with.
 */
@Injectable()
export class TemplateSyncService {
  private readonly logger = new Logger(TemplateSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.availableTemplate.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] });
  }

  async sync(): Promise<SyncResult> {
    const fyxo = await this.fromFyxo();
    if (fyxo) return this.store(fyxo, "Fyxo Connect");

    const meta = await this.fromMeta();
    if (meta) return this.store(meta, "Meta WhatsApp");

    return {
      ok: false,
      source: null,
      imported: 0,
      message: this.explainNoSource(),
    };
  }

  private async store(templates: SyncedTemplate[], source: string): Promise<SyncResult> {
    // Replace wholesale: a template deleted at the provider must disappear
    // here too, and merging would leave it behind as a pickable ghost.
    await this.prisma.$transaction([
      this.prisma.availableTemplate.deleteMany({ where: { source } }),
      this.prisma.availableTemplate.createMany({
        data: templates.map((t) => ({
          name: t.name,
          language: t.language,
          body: t.body ?? null,
          status: t.status ?? null,
          variables: t.variables ?? null,
          buttons: t.buttons ?? [],
          category: t.category ?? null,
          source,
        })),
        skipDuplicates: true,
      }),
    ]);
    this.logger.log(`Synced ${templates.length} template(s) from ${source}`);
    return {
      ok: true,
      source,
      imported: templates.length,
      message: `Fetched ${templates.length} template${templates.length === 1 ? "" : "s"} from ${source}.`,
    };
  }

  private async fromFyxo(): Promise<SyncedTemplate[] | null> {
    const key = process.env.FYXO_API_KEY;
    if (!key) return null;
    const base = (process.env.FYXO_BASE_URL ?? "https://api.connect.fyxo.ai/api").replace(/\/$/, "");
    const paths = process.env.FYXO_TEMPLATES_PATH ? [process.env.FYXO_TEMPLATES_PATH] : FYXO_CANDIDATE_PATHS;

    for (const path of paths) {
      try {
        const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${key}` } });
        if (!res.ok) continue;
        const parsed = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown } | null;
        const rows = asArray(parsed?.data ?? parsed);
        if (!rows) continue;
        const templates = rows.map(readFyxoTemplate).filter((t): t is SyncedTemplate => t !== null);
        if (templates.length > 0) {
          this.logger.log(`Fyxo templates found at ${path}`);
          return templates;
        }
      } catch (err) {
        this.logger.warn(`Fyxo template probe ${path} threw: ${(err as Error).message}`);
      }
    }
    return null;
  }

  private async fromMeta(): Promise<SyncedTemplate[] | null> {
    const wabaId = process.env.WHATSAPP_WABA_ID;
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!wabaId || !token) return null;

    const version = process.env.WHATSAPP_API_VERSION ?? "v20.0";
    try {
      const res = await fetch(
        `https://graph.facebook.com/${version}/${wabaId}/message_templates?fields=name,language,status,components&limit=200`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const parsed = (await res.json().catch(() => null)) as
        | { data?: unknown[]; error?: { message?: string } }
        | null;
      if (!res.ok || !parsed?.data) {
        this.logger.error(`Meta template fetch failed: ${parsed?.error?.message ?? res.status}`);
        return null;
      }
      return parsed.data.map(readMetaTemplate).filter((t): t is SyncedTemplate => t !== null);
    } catch (err) {
      this.logger.error(`Meta template fetch threw: ${(err as Error).message}`);
      return null;
    }
  }

  private explainNoSource(): string {
    if (!process.env.FYXO_API_KEY) {
      return "No WhatsApp provider is configured, so there's nothing to sync from. Set FYXO_API_KEY, or Meta's WHATSAPP_WABA_ID and WHATSAPP_ACCESS_TOKEN.";
    }
    if (!process.env.WHATSAPP_WABA_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
      return (
        "Fyxo returned no templates. Check that the API key is still valid and that templates exist in your Fyxo account. " +
        "You can also sync from Meta instead by setting WHATSAPP_WABA_ID and WHATSAPP_ACCESS_TOKEN, " +
        "or set FYXO_TEMPLATES_PATH if Fyxo has moved the endpoint. Template names can always be typed in by hand below."
      );
    }
    return "Couldn't fetch templates from Fyxo or Meta. Check the server log for the exact error from each.";
  }
}

function asArray(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  // Providers commonly wrap a list as { data: [...] } or { templates: [...] }.
  if (value && typeof value === "object") {
    for (const key of ["templates", "data", "items", "results"]) {
      const inner = (value as Record<string, unknown>)[key];
      if (Array.isArray(inner)) return inner as Record<string, unknown>[];
    }
  }
  return null;
}

/**
 * Reads Fyxo's real /v1/templates row shape (name, language, category,
 * status, variables, headerFormat, quickReplies, createdAt), with the
 * alternative field names other BSPs use kept as fallbacks so a shape change
 * degrades rather than breaks.
 *
 * Note Fyxo does NOT return the body text — only its variable *count*. So a
 * synced template arrives with no copy to preview, and the Super Admin can
 * still type it in by hand if they want it shown in the sheet log.
 */
function readFyxoTemplate(row: Record<string, unknown>): SyncedTemplate | null {
  const name = typeof row.name === "string" ? row.name : typeof row.templateName === "string" ? row.templateName : null;
  if (!name) return null;
  const language =
    (typeof row.language === "string" && row.language) ||
    (typeof row.templateLanguage === "string" && row.templateLanguage) ||
    (typeof row.locale === "string" && row.locale) ||
    "en";
  const body = typeof row.body === "string" ? row.body : typeof row.text === "string" ? row.text : undefined;
  const status = typeof row.status === "string" ? row.status.toUpperCase() : undefined;
  const variables = typeof row.variables === "number" ? row.variables : undefined;
  const buttons = Array.isArray(row.quickReplies)
    ? row.quickReplies.filter((b): b is string => typeof b === "string")
    : undefined;
  const category = typeof row.category === "string" ? row.category : undefined;
  return { name, language, body, status, variables, buttons, category };
}

// Meta returns the body inside a components array; everything else (header,
// footer, buttons) is ignored because only the body carries the {{n}}
// variables this app fills in.
function readMetaTemplate(row: unknown): SyncedTemplate | null {
  const t = row as {
    name?: string;
    language?: string;
    status?: string;
    category?: string;
    components?: { type?: string; text?: string; buttons?: { text?: string }[] }[];
  };
  if (!t?.name) return null;
  const body = t.components?.find((c) => c.type?.toUpperCase() === "BODY")?.text;
  const buttons = t.components
    ?.find((c) => c.type?.toUpperCase() === "BUTTONS")
    ?.buttons?.map((b) => b.text)
    .filter((b): b is string => Boolean(b));
  // Meta gives the body text but not a variable count — derive it from the
  // highest {{n}} placeholder actually used.
  const variables = body ? Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))) : undefined;
  return { name: t.name, language: t.language ?? "en", body, status: t.status, category: t.category, buttons, variables };
}
