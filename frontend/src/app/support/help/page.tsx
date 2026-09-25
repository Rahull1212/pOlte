import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const FAQS: { question: string; answer: string }[] = [
  {
    question: "What do the three roles (Super Admin, Admin, Cadre) mean?",
    answer:
      "Super Admin has full organization-wide control. Admin manages one area of the region hierarchy (a district, constituency, or booth) and the Cadres within it. Cadre executes tasks and submits progress/expenses/citizen registrations on the ground — Cadres don't manage other users.",
  },
  {
    question: "How do I create a campaign and assign targets?",
    answer:
      "Only a Super Admin can create a campaign (Campaigns → + New Campaign). Once created, targets and budget are split down the region hierarchy: the Super Admin allocates to Districts, District Admins split further to Constituencies, and so on, down to individual Cadres as Tasks.",
  },
  {
    question: "Why can't I edit a region/area?",
    answer:
      "Only a Super Admin can add, rename, or delete Areas (Areas page in the sidebar). Deleting an area is blocked if it still has sub-areas or any users/citizens/grievances/events/allocations assigned to it — remove or reassign those first.",
  },
  {
    question: "How does WhatsApp check-in work for events?",
    answer:
      "Cadres can check themselves into an event either from the Events page in the app, or by replying through the WhatsApp bot flow if it's configured for your organization.",
  },
  {
    question: "Who can see grievances/citizens I register?",
    answer:
      "Everyone above you in the region hierarchy can see it: your Admin, their Admin, and the Super Admin — scoped to your area. People outside your region subtree cannot see it.",
  },
];

export default function HelpCenterPage() {
  return (
    <AppShell>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">Help Center</h1>
      <div className="max-w-2xl space-y-4">
        {FAQS.map((faq) => (
          <Card key={faq.question}>
            <CardHeader>
              <CardTitle>{faq.question}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600">{faq.answer}</p>
            </CardContent>
          </Card>
        ))}
        <p className="text-sm text-slate-500">
          Didn't find what you needed?{" "}
          <Link href="/support/contact" className="text-brand-600 hover:underline">
            Contact support
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}
