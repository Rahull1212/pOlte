import { EventItem } from "@/hooks/use-events";
import { Badge } from "./ui/badge";

export function UpcomingEvents({ events }: { events?: EventItem[] }) {
  const upcoming = (events ?? [])
    .filter((e) => new Date(e.startAt).getTime() >= Date.now() - 86_400_000)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, 5);

  if (upcoming.length === 0) {
    return <p className="py-4 text-center text-sm text-slate-400">No upcoming events.</p>;
  }

  return (
    <ul className="space-y-3">
      {upcoming.map((event) => {
        const date = new Date(event.startAt);
        const isToday = date.toDateString() === new Date().toDateString();
        return (
          <li key={event.id} className="flex items-start justify-between gap-2 text-sm">
            <div>
              <p className="font-medium text-slate-800">{event.name}</p>
              <p className="text-xs text-slate-500">
                {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                {date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </p>
            </div>
            {isToday && <Badge tone="amber">Today</Badge>}
          </li>
        );
      })}
    </ul>
  );
}
