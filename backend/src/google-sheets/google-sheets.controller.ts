import { Body, Controller, Delete, Get, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import {
  connectSheetSchema,
  ConnectSheetDto,
  saveGoogleCredentialsSchema,
  SaveGoogleCredentialsDto,
  saveGoogleOAuthAppSchema,
  SaveGoogleOAuthAppDto,
  selectSpreadsheetSchema,
  SelectSpreadsheetDto,
} from "../shared-types";
import { GoogleSheetsService } from "./google-sheets.service";
import { GoogleOAuthService } from "./google-oauth.service";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

// Super Admin only, throughout: which sheet the whole campaign's message log
// goes to is an app-wide setting, not something a single Admin should be able
// to repoint (or read the location of) for everyone else.
@Controller("google-sheets")
@UseGuards(RolesGuard)
@Roles("SUPER_ADMIN")
export class GoogleSheetsController {
  constructor(
    private readonly googleSheets: GoogleSheetsService,
    private readonly oauth: GoogleOAuthService,
  ) {}

  @Get("status")
  getStatus() {
    return this.googleSheets.getStatus();
  }

  // ---- One-click path: sign in with Google, then pick a sheet ----

  // Returns the URL rather than redirecting, because the browser reaches this
  // through fetch() with a bearer token — it can't follow a redirect to
  // Google and keep the session. The page navigates to the returned URL.
  @Get("oauth/url")
  async authUrl(@CurrentUser() user: AuthenticatedUser) {
    return { url: await this.oauth.authUrl(user.id) };
  }

  /**
   * Where Google sends the browser back to. Public by necessity: it's a
   * top-level navigation from Google's servers, carrying no PoliOS session.
   * The `state` nonce is what proves this callback belongs to a sign-in this
   * server started (see GoogleOAuthService.handleCallback) — that check is
   * the authentication here, not the JWT guard.
   */
  // @Roles() with no roles overrides the class-level SUPER_ADMIN requirement
  // for this one handler — RolesGuard reads the handler's metadata first, and
  // an empty list means "no role required". Without it the guard would reject
  // the callback for having no request.user, which @Public() guarantees.
  @Public()
  @Roles()
  @Get("oauth/callback")
  async callback(@Query("code") code: string, @Query("state") state: string, @Query("error") error: string, @Res() res: Response) {
    const appUrl = (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",")[0].trim();
    const back = (params: string) => res.redirect(`${appUrl}/google-sheet?${params}`);

    if (error) return back(`google=denied`);
    if (!code || !state) return back(`google=error&message=${encodeURIComponent("Google sent an incomplete response")}`);

    try {
      await this.oauth.handleCallback(code, state);
      return back("google=connected");
    } catch (err) {
      return back(`google=error&message=${encodeURIComponent((err as Error).message)}`);
    }
  }

  /** The signed-in account's spreadsheets, for the picker. */
  @Get("spreadsheets")
  listSpreadsheets() {
    return this.oauth.listSpreadsheets();
  }

  @Post("select")
  select(
    @Body(new ZodValidationPipe(selectSpreadsheetSchema)) dto: SelectSpreadsheetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.googleSheets.selectSpreadsheet(dto.spreadsheetId, dto.tabName, user.id);
  }

  @Delete("oauth/account")
  async disconnectAccount() {
    await this.oauth.disconnectAccount();
    return this.googleSheets.getStatus();
  }

  // The one-time OAuth app registration (Client ID + secret from Google
  // Cloud). Set once per install; after this it's just the sign-in button.
  @Post("oauth/app")
  async saveOAuthApp(@Body(new ZodValidationPipe(saveGoogleOAuthAppSchema)) dto: SaveGoogleOAuthAppDto) {
    await this.oauth.saveAppCredentials(dto.clientId, dto.clientSecret);
    return this.googleSheets.getStatus();
  }

  // ---- Sheet connection ----

  @Post("connect")
  connect(
    @Body(new ZodValidationPipe(connectSheetSchema)) dto: ConnectSheetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.googleSheets.connect(dto, user.id);
  }

  @Delete("connection")
  disconnect() {
    return this.googleSheets.disconnect();
  }

  @Post("test-row")
  sendTestRow(@CurrentUser() user: AuthenticatedUser) {
    return this.googleSheets.sendTestRow(user.name);
  }

  // ---- Service-account fallback (robot account instead of signing in) ----

  @Post("credentials")
  saveCredentials(
    @Body(new ZodValidationPipe(saveGoogleCredentialsSchema)) dto: SaveGoogleCredentialsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.googleSheets.saveServiceAccount(dto.serviceAccountJson, user.id);
  }

  @Delete("credentials")
  clearCredentials() {
    return this.googleSheets.clearServiceAccount();
  }
}
