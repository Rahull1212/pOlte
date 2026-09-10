import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { PrismaService } from "../prisma/prisma.service";
import { decryptSecret, encryptSecret, SINGLETON_ID } from "./secrets";

// Two scopes, both the narrowest that will do the job:
//   spreadsheets      — read/write the sheet rows are appended to.
//   drive.metadata.readonly — list the user's spreadsheets by name so they
//                       can pick one, without granting any access to file
//                       *contents* across their Drive.
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
];

export interface SpreadsheetChoice {
  id: string;
  name: string;
  modifiedTime: string | null;
}

/**
 * "Connect Google Sheets" — the one-click path: the Super Admin signs in with
 * their own Google account and picks a sheet from a list, with no key files,
 * no sharing step and no .env editing.
 *
 * The one thing Google makes unavoidable is registering an OAuth *app* once
 * (Client ID + secret). That's an application identity, not a user
 * credential, so it's set once per install — in the app or via
 * GOOGLE_OAUTH_CLIENT_ID/_SECRET — and never again. Everything after that is
 * the sign-in button.
 *
 * Only the refresh token is stored (encrypted). Access tokens are minted from
 * it on demand by googleapis and deliberately never persisted — they expire
 * in an hour and storing them would just be one more secret to leak.
 */
@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  // Pending `state` nonces, so a callback can be tied back to a sign-in this
  // server actually started (CSRF protection Google requires us to do).
  // In-memory: a state is valid for one redirect within minutes, so there's
  // nothing worth persisting across a restart.
  private pendingStates = new Map<string, { userId: string; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** The OAuth app identity: stored in-app if present, else from .env. */
  async appCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
    const row = await this.prisma.googleOAuthConnection.findUnique({ where: { id: SINGLETON_ID } });
    if (row?.clientId && row.clientSecret) {
      return { clientId: row.clientId, clientSecret: decryptSecret(row.clientSecret) };
    }
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (clientId && clientSecret) return { clientId, clientSecret };
    return null;
  }

  async saveAppCredentials(clientId: string, clientSecret: string) {
    const data = { clientId: clientId.trim(), clientSecret: encryptSecret(clientSecret.trim()) };
    await this.prisma.googleOAuthConnection.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...data },
      update: data,
    });
    this.logger.log("Google OAuth app credentials saved");
  }

  /**
   * The exact redirect URI Google must be told about. Derived from the API's
   * own address rather than configured separately, because a mismatch here is
   * the single most common OAuth setup failure — one value, shown in the UI
   * to copy into Google Cloud, and used verbatim in both calls below.
   */
  redirectUri(): string {
    const base = process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
    return `${base.replace(/\/$/, "")}/api/google-sheets/oauth/callback`;
  }

  /** Where to send the Super Admin's browser to sign in. */
  async authUrl(userId: string): Promise<string> {
    const app = await this.appCredentials();
    if (!app) {
      throw new BadRequestException(
        "Google sign-in isn't set up yet — add the Google OAuth Client ID and secret first.",
      );
    }

    const state = randomUUID();
    this.pendingStates.set(state, { userId, at: Date.now() });
    this.sweepStates();

    return this.oauthClient(app).generateAuthUrl({
      // offline + consent is what actually returns a refresh token; without
      // both, Google hands back only a one-hour access token on repeat
      // sign-ins and the connection silently dies an hour later.
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
      state,
      include_granted_scopes: true,
    });
  }

  /** Exchanges the callback code for a refresh token and stores it. */
  async handleCallback(code: string, state: string): Promise<{ email: string | null }> {
    const pending = this.pendingStates.get(state);
    if (!pending) {
      throw new BadRequestException("That sign-in link has expired. Start again from the Google Sheet page.");
    }
    this.pendingStates.delete(state);

    const app = await this.appCredentials();
    if (!app) throw new BadRequestException("Google sign-in isn't set up.");

    const client = this.oauthClient(app);
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new BadRequestException(
        "Google didn't return a refresh token. Remove PoliOS at myaccount.google.com/permissions and connect again.",
      );
    }

    client.setCredentials(tokens);
    // Whose account this is, for display — from the id_token Google already
    // returned, so it costs no extra call.
    let email: string | null = null;
    try {
      const info = await client.getTokenInfo(tokens.access_token!);
      email = info.email ?? null;
    } catch {
      // Non-fatal: the connection works, we just can't label it.
    }

    await this.prisma.googleOAuthConnection.update({
      where: { id: SINGLETON_ID },
      data: {
        refreshToken: encryptSecret(tokens.refresh_token),
        accountEmail: email,
        connectedById: pending.userId,
        connectedAt: new Date(),
      },
    });
    this.logger.log(`Google account connected: ${email ?? "(unknown address)"}`);
    return { email };
  }

  /** An authenticated client, or null when nobody has signed in. */
  async client(): Promise<OAuth2Client | null> {
    const [row, app] = await Promise.all([
      this.prisma.googleOAuthConnection.findUnique({ where: { id: SINGLETON_ID } }),
      this.appCredentials(),
    ]);
    if (!row?.refreshToken || !app) return null;

    const client = this.oauthClient(app);
    // googleapis mints and refreshes access tokens from this automatically.
    client.setCredentials({ refresh_token: decryptSecret(row.refreshToken) });
    return client;
  }

  async connectedAccount(): Promise<{ email: string | null; connectedAt: Date | null; connectedByName: string | null } | null> {
    const row = await this.prisma.googleOAuthConnection.findUnique({
      where: { id: SINGLETON_ID },
      include: { connectedBy: { select: { name: true } } },
    });
    if (!row?.refreshToken) return null;
    return {
      email: row.accountEmail,
      connectedAt: row.connectedAt,
      connectedByName: row.connectedBy?.name ?? null,
    };
  }

  /** The Super Admin's spreadsheets, most recently edited first, to pick from. */
  async listSpreadsheets(): Promise<SpreadsheetChoice[]> {
    const auth = await this.client();
    if (!auth) throw new BadRequestException("Connect a Google account first.");

    try {
      const drive = google.drive({ version: "v3", auth });
      const res = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        fields: "files(id,name,modifiedTime)",
        orderBy: "modifiedTime desc",
        pageSize: 100,
      });
      return (res.data.files ?? [])
        .filter((f): f is { id: string; name: string; modifiedTime?: string } => Boolean(f.id && f.name))
        .map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime ?? null }));
    } catch (err) {
      throw new BadRequestException(describeOAuthError(err));
    }
  }

  /** Signs the Google account out, leaving the OAuth app registration in place. */
  async disconnectAccount() {
    await this.prisma.googleOAuthConnection.updateMany({
      where: { id: SINGLETON_ID },
      data: { refreshToken: null, accountEmail: null, connectedById: null, connectedAt: null },
    });
    this.logger.log("Google account disconnected");
  }

  private oauthClient(app: { clientId: string; clientSecret: string }): OAuth2Client {
    return new google.auth.OAuth2(app.clientId, app.clientSecret, this.redirectUri());
  }

  // A state that never came back is dead weight; drop anything older than
  // 15 minutes so a long-running server doesn't accumulate them.
  private sweepStates() {
    const cutoff = Date.now() - 15 * 60_000;
    for (const [key, value] of this.pendingStates) {
      if (value.at < cutoff) this.pendingStates.delete(key);
    }
  }
}

function describeOAuthError(err: unknown): string {
  const raw = (err as Error).message ?? String(err);
  if (/invalid_grant/i.test(raw)) {
    return "Google has revoked this connection (the password changed, or access was withdrawn). Connect the Google account again.";
  }
  if (/API has not been used|is disabled|SERVICE_DISABLED/i.test(raw)) {
    return "The Google Drive API isn't switched on for this OAuth app's Cloud project. Enable it in Google Cloud → APIs & Services → Library, then try again.";
  }
  return raw;
}
