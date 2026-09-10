"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  useSheetStatus,
  useDisconnectSheet,
  useSendSheetTestRow,
  useStartGoogleSignIn,
  useSpreadsheetChoices,
  useSelectSpreadsheet,
  useDisconnectGoogleAccount,
  useSaveGoogleOAuthApp,
  SheetStatus,
} from "@/hooks/use-google-sheets";

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : "Something went wrong";
}

/**
 * Shown only until the OAuth app is registered — the single unavoidable
 * one-time step, because Google will not let any application ask for
 * sign-in without being registered first. After this the page is just the
 * Connect button.
 */
function OAuthSetupCard({ status }: { status: SheetStatus }) {
  const save = useSaveGoogleOAuthApp();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [copied, setCopied] = useState(false);

  return (
    <Card className="border-amber-200">
      <CardHeader>
        <CardTitle>One-time setup</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          Google requires an app to be registered before it can offer a &quot;Sign in with Google&quot; button. This
          takes a couple of minutes and is never needed again.
        </p>
        <ol className="space-y-2 text-sm text-slate-600">
          <li>
            <span className="font-medium text-slate-800">1.</span> Open{" "}
            <a
              className="text-brand-600 hover:underline"
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Cloud → Credentials
            </a>{" "}
            and enable the <strong>Google Sheets API</strong> and <strong>Google Drive API</strong> for your project.
          </li>
          <li>
            <span className="font-medium text-slate-800">2.</span> <strong>Create Credentials → OAuth client ID →
            Web application</strong>.
          </li>
          <li>
            <span className="font-medium text-slate-800">3.</span> Under <strong>Authorised redirect URIs</strong>,
            add exactly this:
            <div className="mt-1 flex items-center gap-2">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
                {status.oauthRedirectUri}
              </code>
              <button
                type="button"
                className="text-xs font-medium text-brand-600 hover:underline"
                onClick={() => {
                  navigator.clipboard?.writeText(status.oauthRedirectUri).then(
                    () => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    },
                    () => setCopied(false),
                  );
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </li>
          <li>
            <span className="font-medium text-slate-800">4.</span> Paste the Client ID and secret it gives you below.
          </li>
        </ol>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="client-id">Client ID</Label>
            <Input
              id="client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="123456789-abc.apps.googleusercontent.com"
            />
          </div>
          <div>
            <Label htmlFor="client-secret">Client secret</Label>
            <Input
              id="client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="GOCSPX-..."
            />
          </div>
        </div>

        {errorMessage(save.error) && <p className="text-sm text-red-600">{errorMessage(save.error)}</p>}

        <div className="flex justify-end">
          <Button
            onClick={() => save.mutate({ clientId: clientId.trim(), clientSecret: clientSecret.trim() })}
            disabled={save.isPending || !clientId.trim() || !clientSecret.trim()}
          >
            {save.isPending ? "Saving…" : "Save and continue"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** The picker: the signed-in account's own spreadsheets, newest first. */
function SheetPicker({ connectedEmail }: { connectedEmail: string | null }) {
  const { data: sheets, isLoading, error } = useSpreadsheetChoices(true);
  const select = useSelectSpreadsheet();
  const signOut = useDisconnectGoogleAccount();
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Choose a sheet</CardTitle>
        <Badge tone="green">Signed in{connectedEmail ? ` as ${connectedEmail}` : ""}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-slate-500">Loading your sheets…</p>}
        {errorMessage(error) && <p className="text-sm text-red-600">{errorMessage(error)}</p>}

        {sheets?.length === 0 && (
          <p className="text-sm text-slate-500">
            No spreadsheets found in this Google account. Create one in Google Sheets, then reload this page.
          </p>
        )}

        {sheets && sheets.length > 0 && (
          <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {sheets.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setChosen(s.id)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                  chosen === s.id ? "bg-brand-50 text-brand-800" : "hover:bg-slate-50"
                }`}
              >
                <span className="truncate">{s.name}</span>
                <span className="ml-3 shrink-0 text-xs text-slate-400">
                  {s.modifiedTime ? new Date(s.modifiedTime).toLocaleDateString() : ""}
                </span>
              </button>
            ))}
          </div>
        )}

        {errorMessage(select.error) && <p className="text-sm text-red-600">{errorMessage(select.error)}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
            {signOut.isPending ? "Signing out…" : "Sign out"}
          </Button>
          <Button
            onClick={() => chosen && select.mutate({ spreadsheetId: chosen })}
            disabled={!chosen || select.isPending}
          >
            {select.isPending ? "Connecting…" : "Use this sheet"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Super Admin's Google Sheet connection. Every task message that goes out to
 * a Cadre (assignment, retry, completion check) is appended as a row, so the
 * campaign has a live record outside PoliOS without anyone exporting
 * anything.
 *
 * The flow is deliberately one button: sign in with Google, pick a sheet.
 * The service-account path still exists in the API for deploys that prefer a
 * robot account, but it isn't offered here — it needs a key file and a manual
 * sharing step, which is exactly the friction this page removes.
 */
function GoogleSheetContent() {
  const { data: status, isLoading } = useSheetStatus();
  const signIn = useStartGoogleSignIn();
  const disconnect = useDisconnectSheet();
  const testRow = useSendSheetTestRow();
  const params = useSearchParams();

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const connection = status?.connection ?? null;
  const signedIn = status?.credentialsSource === "google";
  // Feedback from Google's redirect back into the app.
  const googleResult = params.get("google");

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-slate-900">Google Sheet</h1>
        <p className="mt-1 text-sm text-slate-500">
          Connect a Google Sheet and every task message sent to a Cadre is logged there as a row — Cadre name and
          number, the message, which task it was, the Admin who assigned it, delivery status, and time. Admins keep
          assigning tasks exactly as they do now; the sheet fills itself.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          <span className="font-medium text-slate-700">Tabs:</span> tasks you create go to the main tab (with the
          allocating Admin named in each row). A task an Admin creates themselves goes to a tab named after that
          Admin, created automatically the first time they send one.
        </p>
      </div>

      {googleResult === "denied" && (
        <p className="mb-4 text-sm text-amber-700">Google sign-in was cancelled.</p>
      )}
      {googleResult === "error" && (
        <p className="mb-4 text-sm text-red-600">{params.get("message") ?? "Google sign-in failed."}</p>
      )}

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {/* Connected and logging — the steady state. */}
      {status && connection && (
        <Card className="mb-4">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>{connection.spreadsheetTitle}</CardTitle>
            {connection.lastError ? <Badge tone="red">Sync error</Badge> : <Badge tone="green">Connected</Badge>}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs font-medium uppercase text-slate-400">Tab</p>
                <p className="text-slate-700">{connection.tabName}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-slate-400">Google account</p>
                <p className="truncate text-slate-700">{status.serviceAccountEmail ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-slate-400">Connected</p>
                <p className="text-slate-700">{new Date(connection.connectedAt).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-slate-400">Last row written</p>
                <p className="text-slate-700">
                  {connection.lastAppendAt ? new Date(connection.lastAppendAt).toLocaleString() : "No rows yet"}
                </p>
              </div>
            </div>

            {connection.lastError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <p className="font-medium">Last write failed</p>
                <p className="mt-0.5">{connection.lastError}</p>
                {connection.lastErrorAt && (
                  <p className="mt-1 text-xs text-red-500">{new Date(connection.lastErrorAt).toLocaleString()}</p>
                )}
              </div>
            )}

            {testRow.data && !testRow.data.success && (
              <p className="text-sm text-red-600">Test row failed: {testRow.data.error}</p>
            )}
            {testRow.data?.success && (
              <p className="text-sm text-emerald-700">Test row written — open the sheet to see it.</p>
            )}
            {errorMessage(testRow.error) && <p className="text-sm text-red-600">{errorMessage(testRow.error)}</p>}

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <a href={connection.spreadsheetUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary">Open sheet ↗</Button>
              </a>
              <Button variant="secondary" onClick={() => testRow.mutate()} disabled={testRow.isPending}>
                {testRow.isPending ? "Writing…" : "Send test row"}
              </Button>
              <Button variant="danger" onClick={() => setConfirmDisconnect(true)}>
                Disconnect
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Signed in, no sheet chosen yet. */}
      {status && !connection && signedIn && <SheetPicker connectedEmail={status.serviceAccountEmail} />}

      {/* Not signed in: the button — or, the first time only, the setup it needs. */}
      {status && !connection && !signedIn && status.oauthReady && (
        <Card>
          <CardContent className="space-y-4 py-8 text-center">
            <p className="text-sm text-slate-600">
              Sign in with the Google account that owns the sheet you want the log in.
            </p>
            {errorMessage(signIn.error) && <p className="text-sm text-red-600">{errorMessage(signIn.error)}</p>}
            <Button onClick={() => signIn.mutate()} disabled={signIn.isPending}>
              {signIn.isPending ? "Opening Google…" : "Connect Google Sheets"}
            </Button>
          </CardContent>
        </Card>
      )}

      {status && !connection && !signedIn && !status.oauthReady && <OAuthSetupCard status={status} />}

      {confirmDisconnect && (
        <ConfirmDialog
          title="Disconnect this sheet?"
          message="New task messages will stop being logged to it. Rows already in the sheet stay exactly as they are, and you can reconnect at any time."
          confirmLabel="Disconnect"
          destructive
          isPending={disconnect.isPending}
          error={errorMessage(disconnect.error)}
          onConfirm={() => disconnect.mutate(undefined, { onSuccess: () => setConfirmDisconnect(false) })}
          onCancel={() => setConfirmDisconnect(false)}
        />
      )}
    </AppShell>
  );
}

// useSearchParams (for Google's ?google=connected redirect) needs a Suspense
// boundary or `next build` fails on this route — same wrapper pattern as the
// other pages that read query params.
export default function GoogleSheetPage() {
  return (
    <Suspense fallback={null}>
      <GoogleSheetContent />
    </Suspense>
  );
}
