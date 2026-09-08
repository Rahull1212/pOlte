"use client";

import { AppShell } from "@/components/app-shell";

const FYXO_APP_URL = "https://app.connect.fyxo.ai";

// A straight embed of Fyxo Connect's own WhatsApp Business dashboard — not a
// PoliOS-built feature. PoliOS has no single-sign-on into Fyxo (the
// documented API is a server-to-server messaging API, not an
// embeddable-widget/SSO contract, and there's no "list conversations"/
// "list messages" endpoint to build a native inbox against), so the frame
// shows Fyxo's own login screen: sign in there with your Fyxo Connect
// account, same as a separate tab. It's embedded so you don't have to leave
// PoliOS to work the conversation inbox.
//
// Layout: this page opts into AppShell's fullBleed <main> (flex column,
// no padding/max-width, overflow-hidden) so the workspace below gets the
// *entire* real remaining viewport height via flexbox (flex-1 + min-h-0),
// not a guessed vh fraction — that mismatch was exactly what left a large
// blank gap under a shorter, fixed-height iframe before. The iframe itself
// is width:100%/height:100%/border:none inside that flex-1 container, so
// its own internal scrolling is the only thing that ever scrolls — this
// page and the PoliOS shell around it never do.
export default function FyxoConnectPage() {
  return (
    <AppShell fullBleed>
      <div className="flex h-full min-h-0 flex-1 flex-col gap-3 p-4 sm:p-6">
        <div className="flex shrink-0 items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Fyxo Connect</h1>
            <p className="text-xs text-slate-500">WhatsApp Business communication workspace</p>
          </div>
          <a
            href={FYXO_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            Open in a new tab ↗
          </a>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <iframe src={FYXO_APP_URL} title="Fyxo Connect" className="h-full w-full border-0" allow="clipboard-write" />
        </div>
      </div>
    </AppShell>
  );
}
