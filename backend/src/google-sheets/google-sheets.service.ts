import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { google, sheets_v4 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { PrismaService } from "../prisma/prisma.service";
import { GoogleOAuthService } from "./google-oauth.service";
import { decryptSecret, encryptSecret, SINGLETON_ID } from "./secrets";

export interface TaskMessageRow {
  // The Cadre the message went to.
  name: string;
  phone: string;
  message: string;
  // The task this message is about. Worth its own column because the
  // approved WhatsApp template body never names the task ("Hi {{1}}, we have
  // assigned a task to you please check") — without this the sheet couldn't
  // tell two assignments apart.
  taskName?: string;
  // The Admin who allocated it — the person accountable for this send.
  assignedByName?: string;
  status: string;
  sentAt: Date;
  // Which tab to write to. Undefined/null means the connected default tab
  // (Super-Admin-created tasks); a name routes to that Admin's own tab,
  // created on first use — see resolveTaskTab() in TasksService.
  tab?: string | null;
}

export interface SheetConnectionStatus {
  // Whether a service-account credential exists at all — uploaded in-app or
  // set in .env. When false, connecting is impossible and the UI says which
  // step is missing rather than silently hiding the form.
  credentialsConfigured: boolean;
  // "google" = a Super Admin signed in with their own account (the one-click
  // path); "app"/"env" = a service account, which needs the sheet shared with
  // it by hand. The page renders a different flow for each.
  credentialsSource: "google" | "app" | "env" | null;
  // The signed-in account, or the service account's address — for a service
  // account this is the address the sheet must be shared with.
  serviceAccountEmail: string | null;
  // Whether the OAuth app itself is registered, i.e. whether the "Connect
  // Google Sheets" button can work at all.
  oauthReady: boolean;
  // The exact URI to whitelist in Google Cloud, shown during setup because a
  // mismatch is the most common reason sign-in fails.
  oauthRedirectUri: string;
  connection: {
    spreadsheetId: string;
    spreadsheetUrl: string;
    spreadsheetTitle: string;
    tabName: string;
    connectedByName: string | null;
    connectedAt: Date;
    lastAppendAt: Date | null;
    lastError: string | null;
    lastErrorAt: Date | null;
  } | null;
}

// See SheetConnection's schema comment: one sheet is live at a time, so the
// row is a singleton under this shared fixed id and re-connecting upserts it.
const SHEET_CONNECTION_ID = SINGLETON_ID;

const HEADER_ROW = ["Name", "Number", "Message", "Task", "Assigned By", "Status", "Sent At"];
// A:G — keep in step with HEADER_ROW.
const COLUMN_RANGE = "A:G";
const HEADER_RANGE = "A1:G1";

// Sheet lookups happen once per outbound message, and a single allocation
// can fan out to hundreds of Cadres — so the connection row is cached
// rather than re-read per send. Short TTL (not forever) so a connect done on
// another instance is picked up without a restart; connect/disconnect on
// *this* instance invalidate it immediately.
const CONNECTION_CACHE_TTL_MS = 30_000;

/**
 * Appends one row per outbound task-related WhatsApp message (assignment,
 * retry, completion check) to the Google Sheet a Super Admin connected from
 * the app — Name, Number, Message, Status, Sent At.
 *
 * Two separate pieces of configuration, both settable by a Super Admin in
 * the app so nothing here needs a .env edit or a redeploy:
 *   1. The service-account credential — uploaded as the JSON key file
 *      Google hands out (saveServiceAccount), stored encrypted. Falls back
 *      to GOOGLE_SHEETS_CLIENT_EMAIL/_PRIVATE_KEY if those are set, so a
 *      deploy that already configures it that way is unaffected.
 *   2. Which spreadsheet/tab to write to — a SheetConnection row, chosen by
 *      a Super Admin in the UI at any time (see connect()).
 * With either missing, every append is logged and reported as a simulated
 * success, the same "degrade to logging when unconfigured" pattern as
 * WhatsAppApiService/FyxoWhatsAppService/AiService, so the whole app stays
 * exercisable with no Google setup at all.
 */
@Injectable()
export class GoogleSheetsService {
  private readonly logger = new Logger(GoogleSheetsService.name);
  private cache: { row: SheetConnectionRow | null; at: number } | null = null;
  // "<spreadsheetId>:<tab>" entries this process has already confirmed exist
  // with a header row — so per-Admin tabs cost one extra Google call the
  // first time each is written to, and nothing thereafter.
  private ensuredTabs = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: GoogleOAuthService,
  ) {}

  /**
   * How to authenticate to Google, in preference order:
   *   1. The Super Admin's own signed-in Google account (OAuth) — the
   *      one-click path, and the only one that can list their sheets.
   *   2. A service account, uploaded or from .env — the robot-account
   *      fallback, which requires the sheet to be shared with it by hand.
   * `email` is only used for display and error messages ("share the sheet
   * with this address"), which is why it's optional for the OAuth path —
   * there's nothing to share there, the user already owns the file.
   */
  private async credentials(): Promise<{
    auth: OAuth2Client | ReturnType<typeof serviceAccountAuth>;
    email: string | null;
    source: "google" | "app" | "env";
  } | null> {
    const oauthClient = await this.oauth.client();
    if (oauthClient) {
      const account = await this.oauth.connectedAccount();
      return { auth: oauthClient, email: account?.email ?? null, source: "google" };
    }

    const row = await this.prisma.googleServiceAccount.findUnique({ where: { id: SHEET_CONNECTION_ID } });
    if (row) {
      return { auth: serviceAccountAuth(row.clientEmail, decryptSecret(row.privateKey)), email: row.clientEmail, source: "app" };
    }
    const email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const key = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
    // A private key can't hold real newlines in a single-line .env value, so
    // it's stored there with literal "\n" escapes — undo that here. (An
    // uploaded JSON key is parsed by JSON.parse, which already did it.)
    if (email && key) {
      return { auth: serviceAccountAuth(email, key.replace(/\\n/g, "\n")), email, source: "env" };
    }
    return null;
  }

  /**
   * Points the log at a spreadsheet the Super Admin picked from their own
   * Google Drive — the one-click path's equivalent of connect(), with no URL
   * to paste and no sharing step, since they already own the file.
   */
  async selectSpreadsheet(spreadsheetId: string, tabName: string | undefined, userId: string): Promise<SheetConnectionStatus> {
    const creds = await this.credentials();
    if (!creds) throw new BadRequestException("Connect a Google account first.");
    return this.finishConnect(creds, spreadsheetId, tabName, userId);
  }

  /**
   * Stores the JSON key file Google generates for a service account, so the
   * whole Google setup can be completed in the app. Validated before it's
   * saved — a wrong file (an OAuth client, say) is a common mix-up and would
   * otherwise only surface later as an authentication failure.
   */
  async saveServiceAccount(rawJson: string, userId: string): Promise<SheetConnectionStatus> {
    let parsed: { type?: string; client_email?: string; private_key?: string; project_id?: string };
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new BadRequestException("That isn't valid JSON. Paste the whole contents of the key file Google gave you.");
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new BadRequestException(
        parsed.type === "authorized_user" || "installed" in parsed
          ? "That looks like an OAuth client file, not a service-account key. In Google Cloud go to Credentials → Service Accounts → your account → Keys → Add Key → JSON."
          : "That file has no client_email/private_key. Use the JSON key downloaded from a service account.",
      );
    }
    if (!parsed.private_key.includes("BEGIN PRIVATE KEY")) {
      throw new BadRequestException("The private_key in that file looks truncated — paste the file exactly as downloaded.");
    }

    const data = {
      clientEmail: parsed.client_email,
      privateKey: encryptSecret(parsed.private_key),
      projectId: parsed.project_id ?? null,
      uploadedById: userId,
      uploadedAt: new Date(),
    };
    await this.prisma.googleServiceAccount.upsert({
      where: { id: SHEET_CONNECTION_ID },
      create: { id: SHEET_CONNECTION_ID, ...data },
      update: data,
    });
    // A new credential may see different sheets/tabs than the old one.
    this.ensuredTabs.clear();
    this.logger.log(`Google service account saved: ${parsed.client_email}`);
    return this.getStatus();
  }

  async clearServiceAccount(): Promise<SheetConnectionStatus> {
    await this.prisma.googleServiceAccount.deleteMany({ where: { id: SHEET_CONNECTION_ID } });
    this.ensuredTabs.clear();
    this.logger.log("Google service account removed — sheet logging falls back to .env, or simulates if unset");
    return this.getStatus();
  }

  async getStatus(): Promise<SheetConnectionStatus> {
    const [row, creds, oauthApp] = await Promise.all([
      this.prisma.sheetConnection.findUnique({
        where: { id: SHEET_CONNECTION_ID },
        include: { connectedBy: { select: { name: true } } },
      }),
      this.credentials(),
      this.oauth.appCredentials(),
    ]);
    return {
      credentialsConfigured: creds !== null,
      credentialsSource: creds?.source ?? null,
      serviceAccountEmail: creds?.email ?? null,
      oauthReady: oauthApp !== null,
      oauthRedirectUri: this.oauth.redirectUri(),
      connection: row
        ? {
            spreadsheetId: row.spreadsheetId,
            spreadsheetUrl: row.spreadsheetUrl,
            spreadsheetTitle: row.spreadsheetTitle,
            tabName: row.tabName,
            connectedByName: row.connectedBy?.name ?? null,
            connectedAt: row.connectedAt,
            lastAppendAt: row.lastAppendAt,
            lastError: row.lastError,
            lastErrorAt: row.lastErrorAt,
          }
        : null,
    };
  }

  /**
   * Points the message log at a spreadsheet. Everything is verified against
   * Google *before* the connection is saved — the sheet exists, the service
   * account can actually write to it, the tab exists (created if not), and
   * the header row is in place — so a saved connection is a working one, and
   * a mistake surfaces here as a fixable message instead of as silently
   * missing rows discovered days later.
   */
  async connect(input: { spreadsheetUrl: string; tabName?: string }, userId: string): Promise<SheetConnectionStatus> {
    const creds = await this.credentials();
    if (!creds) {
      throw new BadRequestException("Connect a Google account first.");
    }

    const spreadsheetId = parseSpreadsheetId(input.spreadsheetUrl);
    if (!spreadsheetId) {
      throw new BadRequestException(
        "That doesn't look like a Google Sheet link. Paste the full URL from your browser's address bar (https://docs.google.com/spreadsheets/d/...).",
      );
    }
    return this.finishConnect(creds, spreadsheetId, input.tabName, userId);
  }

  /** Shared tail of both connect paths: verify against Google, then save. */
  private async finishConnect(
    creds: NonNullable<Awaited<ReturnType<GoogleSheetsService["credentials"]>>>,
    spreadsheetId: string,
    requestedTab: string | undefined,
    userId: string,
  ): Promise<SheetConnectionStatus> {
    const tabName = requestedTab?.trim() || "Task Messages";

    const sheets = sheetsClient(creds.auth);
    const meta = await this.callGoogle(
      () => sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties" }),
      creds.email,
    );

    const title = meta.data.properties?.title ?? "Untitled spreadsheet";
    const existingTabs = (meta.data.sheets ?? []).map((s) => s.properties?.title).filter((t): t is string => Boolean(t));

    // Reuses the tab list just fetched, so connecting costs no extra
    // round-trip to discover what's already there.
    this.ensuredTabs.clear();
    await this.ensureTab(sheets, creds.email, spreadsheetId, tabName, existingTabs);

    const data = {
      spreadsheetId,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      spreadsheetTitle: title,
      tabName,
      connectedById: userId,
      connectedAt: new Date(),
      // A fresh connection starts with a clean health record — a stale error
      // from a previously connected sheet must not haunt this one.
      lastAppendAt: null,
      lastError: null,
      lastErrorAt: null,
    };
    await this.prisma.sheetConnection.upsert({
      where: { id: SHEET_CONNECTION_ID },
      create: { id: SHEET_CONNECTION_ID, ...data },
      update: data,
    });
    this.cache = null;

    this.logger.log(`Google Sheet connected: "${title}" (tab "${tabName}")`);
    return this.getStatus();
  }

  async disconnect(): Promise<SheetConnectionStatus> {
    await this.prisma.sheetConnection.deleteMany({ where: { id: SHEET_CONNECTION_ID } });
    this.cache = null;
    this.ensuredTabs.clear();
    this.logger.log("Google Sheet disconnected — task messages are no longer logged to a sheet");
    return this.getStatus();
  }

  async appendTaskMessageRow(row: TaskMessageRow): Promise<{ success: boolean; error?: string }> {
    const [connection, creds] = await Promise.all([this.connection(), this.credentials()]);
    // A task created by an Admin logs into that Admin's own tab; anything
    // else (Super-Admin-created tasks, non-task notifications) goes to the
    // connected default tab.
    const tab = row.tab ? sanitizeTabName(row.tab) : connection?.tabName ?? "Task Messages";

    if (!creds || !connection) {
      const why = !creds ? "no Google credentials" : "no sheet connected";
      this.logger.warn(
        `[Google Sheets ${why} — simulating] would append to "${tab}": ${row.name} | ${row.phone} | ${truncate(row.message, 60)} | ${row.taskName ?? "—"} | ${row.assignedByName ?? "—"} | ${row.status} | ${row.sentAt.toISOString()}`,
      );
      return { success: true };
    }

    try {
      const sheets = sheetsClient(creds.auth);
      await this.ensureTab(sheets, creds.email, connection.spreadsheetId, tab);
      await sheets.spreadsheets.values.append({
        spreadsheetId: connection.spreadsheetId,
        range: `${tab}!${COLUMN_RANGE}`,
        valueInputOption: "USER_ENTERED",
        // INSERT_ROWS, not the default OVERWRITE: OVERWRITE writes into the
        // first blank row it finds *below* the existing block, which can land
        // on top of unrelated content further down a sheet someone is also
        // using by hand.
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [
            [
              row.name,
              row.phone,
              row.message,
              row.taskName ?? "—",
              row.assignedByName ?? "—",
              row.status,
              row.sentAt.toLocaleString("en-IN"),
            ],
          ],
        },
      });
      await this.recordHealth(connection, null);
      return { success: true };
    } catch (err) {
      const message = describeGoogleError(err, creds.email);
      this.logger.error(`Google Sheets append failed: ${message}`);
      await this.recordHealth(connection, message);
      return { success: false, error: message };
    }
  }

  /** Writes one obviously-labelled row so a Super Admin can see the sync working. */
  async sendTestRow(byName: string): Promise<{ success: boolean; error?: string }> {
    if (!(await this.credentials()) || !(await this.connection())) {
      throw new BadRequestException("Connect a Google Sheet first.");
    }
    return this.appendTaskMessageRow({
      name: "Test row",
      phone: "—",
      message: "This is a test row from PoliOS. Real rows appear here whenever a task message goes out to a Cadre.",
      taskName: "Connection test",
      assignedByName: byName,
      status: "TEST",
      sentAt: new Date(),
    });
  }

  /**
   * Makes sure a tab exists and carries the header row, creating it if not —
   * this is what lets each Admin's tab appear the first time one of their
   * task messages goes out, with nobody setting it up by hand. Cached per
   * process (see ensuredTabs), so the cost is one extra Google call per tab
   * per restart, not per message.
   */
  private async ensureTab(
    sheets: sheets_v4.Sheets,
    // Null for a signed-in Google account: there's no address to tell the
    // user to share the sheet with, because they already own it.
    accountEmail: string | null,
    spreadsheetId: string,
    tab: string,
    knownTabs?: string[],
  ) {
    const key = `${spreadsheetId}:${tab}`;
    if (this.ensuredTabs.has(key)) return;

    const tabs =
      knownTabs ??
      (await this.callGoogle(
        () => sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" }),
        accountEmail,
      )).data.sheets
        ?.map((s) => s.properties?.title)
        .filter((t): t is string => Boolean(t)) ??
      [];

    if (!tabs.includes(tab)) {
      await this.callGoogle(
        () =>
          sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
          }),
        accountEmail,
      );
    }

    // Only write headers into a genuinely empty first row — never overwrite
    // an existing sheet's own header, which may be worded differently or
    // hold extra columns the campaign added themselves.
    const firstRow = await this.callGoogle(
      () => sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!${HEADER_RANGE}` }),
      accountEmail,
    );
    if (!firstRow.data.values?.[0]?.some((cell) => String(cell ?? "").trim() !== "")) {
      await this.callGoogle(
        () =>
          sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${tab}!${HEADER_RANGE}`,
            valueInputOption: "RAW",
            requestBody: { values: [HEADER_ROW] },
          }),
        accountEmail,
      );
    }

    this.ensuredTabs.add(key);
  }

  private async connection(): Promise<SheetConnectionRow | null> {
    if (this.cache && Date.now() - this.cache.at < CONNECTION_CACHE_TTL_MS) return this.cache.row;
    const row = await this.prisma.sheetConnection.findUnique({ where: { id: SHEET_CONNECTION_ID } });
    this.cache = { row, at: Date.now() };
    return row;
  }

  /**
   * Turns a raw googleapis rejection into something a Super Admin can act on
   * (the common failure by far is "you forgot to share the sheet"), and
   * rethrows it as a 400 so the connect endpoint doesn't surface a 500.
   */
  private async callGoogle<T>(fn: () => Promise<T>, accountEmail: string | null): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw new BadRequestException(describeGoogleError(err, accountEmail));
    }
  }

  /**
   * Persists sync health only when it actually changes — a new error, or the
   * first success after one. Appends otherwise leave this row untouched,
   * because writing lastAppendAt per message would mean one UPDATE (and one
   * row lock) per Cadre in an allocation of hundreds.
   */
  private async recordHealth(connection: SheetConnectionRow, error: string | null) {
    const unchanged = error === null ? connection.lastError === null : connection.lastError === error;
    if (unchanged && connection.lastAppendAt !== null) return;
    try {
      const updated = await this.prisma.sheetConnection.update({
        where: { id: SHEET_CONNECTION_ID },
        data:
          error === null
            ? { lastAppendAt: new Date(), lastError: null, lastErrorAt: null }
            : { lastError: error, lastErrorAt: new Date() },
      });
      this.cache = { row: updated, at: Date.now() };
    } catch {
      // The connection was deleted underneath us (disconnected mid-send) —
      // nothing to record, and definitely not worth failing the send over.
      this.cache = null;
    }
  }
}

type SheetConnectionRow = {
  id: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  spreadsheetTitle: string;
  tabName: string;
  connectedById: string | null;
  connectedAt: Date;
  lastAppendAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
};

/**
 * Accepts what a user will realistically paste: the full browser URL, a
 * share link, or the bare id on its own.
 */
function parseSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(trimmed);
  if (fromUrl) return fromUrl[1];
  // A bare id — Google's are long and alphanumeric; the length floor keeps a
  // stray word from being accepted as an id and failing confusingly later.
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

function serviceAccountAuth(email: string, key: string) {
  return new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
}

// Works with either auth object — a signed-in user (OAuth2Client) or a
// service account (JWT) — since googleapis takes both interchangeably.
function sheetsClient(auth: OAuth2Client | ReturnType<typeof serviceAccountAuth>): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth });
}

/**
 * Google rejects tab names containing : \ / ? * [ ] and caps them at 100
 * characters — a person's name won't normally trip that, but a pasted or
 * mistyped one can, and a rejected tab name would fail every send for that
 * Admin. Two Admins with the identical name share a tab; the Assigned By
 * column still records who each row belongs to.
 */
function sanitizeTabName(raw: string): string {
  const cleaned = raw
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return cleaned || "Unnamed Admin";
}

function describeGoogleError(err: unknown, serviceAccountEmail: string | null): string {
  const status = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
  const raw = (err as Error).message ?? String(err);

  // Checked BEFORE the generic 403 below: Google reports a disabled Sheets
  // API as a 403 too, and reporting it as "you forgot to share the sheet"
  // would send the Super Admin off to fix something that isn't broken.
  if (/API has not been used|is disabled|SERVICE_DISABLED/i.test(raw)) {
    return "The Google Sheets API isn't switched on for this service account's Cloud project. Enable it at console.cloud.google.com → APIs & Services → Library → Google Sheets API, then try again.";
  }
  if (status === 403) {
    return serviceAccountEmail
      ? `PoliOS can't write to that sheet yet. Open it in Google Sheets, click Share, and add ${serviceAccountEmail} as an Editor, then try again.`
      : `PoliOS can't write to that sheet — it hasn't been shared with the service account.`;
  }
  if (status === 404) {
    return "No Google Sheet found for that link. Check that the link is right and the sheet hasn't been deleted.";
  }
  if (status === 400 && /Unable to parse range/i.test(raw)) {
    return "That tab name doesn't exist in the sheet. Check the tab name at the bottom of the spreadsheet.";
  }
  if (/invalid_grant|DECODER routines|PEM/i.test(raw)) {
    return "Google rejected the service-account key. Download a fresh JSON key for the service account and paste it again under 'Google access'.";
  }
  return raw;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}
