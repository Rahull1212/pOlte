"use client";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/use-auth";

export default function ContactSupportPage() {
  const { data: user } = useCurrentUser();

  return (
    <AppShell>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">Contact Support</h1>
      <div className="max-w-xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>In-app issues (bugs, access requests)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-600">
            <p>
              {user?.role === "SUPER_ADMIN"
                ? "As Super Admin, technical issues are reported to your platform administrator/deployment team."
                : "Reach out to your Admin, or your organization's Super Admin, for account access issues (password resets for others, area/role changes)."}
            </p>
            <p>
              For anything you can't resolve within the app, contact whoever manages your PoliOS deployment —
              this instance doesn't yet have a dedicated support inbox configured.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Your own account</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-600">
            <p>
              For your own password, use <span className="font-medium text-slate-800">Profile → Security →
              Change password</span> — no need to contact anyone.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
