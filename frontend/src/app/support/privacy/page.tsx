import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function PrivacyPolicyPage() {
  return (
    <AppShell>
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-900">Privacy Policy</h1>
        <Badge tone="amber">Draft — pending legal review</Badge>
      </div>

      <div className="max-w-2xl space-y-4">
        <Card>
          <CardContent className="space-y-4 py-5 text-sm text-slate-600">
            <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
              This is a working draft describing what PoliOS actually collects and stores, generated to give
              your organization a starting point — it has not been reviewed by a lawyer and should not be
              treated as a final, legally binding policy (including under India's Digital Personal Data
              Protection Act, 2023) until it has been.
            </p>

            <div>
              <h2 className="mb-1 font-semibold text-slate-800">Data we collect</h2>
              <ul className="list-disc space-y-1 pl-5">
                <li>Account data for Admins/Cadres: name, phone number, email, gender, profile picture, role, and area.</li>
                <li>Citizen records registered by Cadres: name, phone number, address, and area.</li>
                <li>Grievances submitted on citizens' behalf, including any photos attached.</li>
                <li>Task progress updates, which may include GPS coordinates, photos, and videos submitted by Cadres.</li>
                <li>Expense records, including uploaded bill images.</li>
                <li>WhatsApp messages, when the WhatsApp integration is enabled for your organization.</li>
                <li>Basic usage/audit logs (who did what, when) for accountability within the organization.</li>
              </ul>
            </div>

            <div>
              <h2 className="mb-1 font-semibold text-slate-800">How it's used</h2>
              <p>
                Solely to operate campaign activities: assigning and tracking work, managing citizen grievances,
                coordinating events, and generating reports/analytics for your organization's own leadership.
                Data is not sold or shared with third parties outside your organization.
              </p>
            </div>

            <div>
              <h2 className="mb-1 font-semibold text-slate-800">Who can see it</h2>
              <p>
                Visibility follows the organization's region hierarchy — an Admin sees data for their own area
                and everything beneath it; a Super Admin sees everything; a Cadre sees their own work.
              </p>
            </div>

            <div>
              <h2 className="mb-1 font-semibold text-slate-800">Data retention &amp; deletion</h2>
              <p>
                This deployment does not yet have an automated retention/deletion policy — data persists until
                manually removed by a Super Admin. Organizations should define a retention period appropriate
                to their legal obligations.
              </p>
            </div>

            <div>
              <h2 className="mb-1 font-semibold text-slate-800">Contact</h2>
              <p>Questions about this policy should go to your organization's Super Admin or platform administrator.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
