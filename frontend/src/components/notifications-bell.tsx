"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BellIcon } from "./icons";
import { useNotifications, useMarkNotificationRead, AppNotification } from "@/hooks/use-notifications";

// Where each relatedEntityType's own detail page lives. Task/Event/Campaign
// detail routes accept the id directly; Grievance and ExpenseRequest have
// no per-record detail page yet, so those just land you on the list.
function resolveNotificationLink(n: AppNotification): string | null {
  if (!n.relatedEntityId) return null;
  switch (n.relatedEntityType) {
    case "Task":
      return `/tasks/${n.relatedEntityId}`;
    case "Event":
      return `/events/${n.relatedEntityId}`;
    case "Campaign":
      return `/campaigns/${n.relatedEntityId}`;
    case "Grievance":
      return "/grievances";
    default:
      return null;
  }
}

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { data: notifications } = useNotifications();
  const markRead = useMarkNotificationRead();
  const unreadCount = notifications?.filter((n) => !n.isRead).length ?? 0;

  const onNotificationClick = (n: AppNotification) => {
    if (!n.isRead) markRead.mutate(n.id);
    const link = resolveNotificationLink(n);
    if (link) {
      setOpen(false);
      router.push(link);
    }
  };

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Notifications"
      >
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
            Notifications
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications?.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-slate-400">You&apos;re all caught up.</p>
            )}
            {notifications?.map((n) => (
              <button
                key={n.id}
                onClick={() => onNotificationClick(n)}
                className={`block w-full border-b border-slate-50 px-4 py-3 text-left text-sm hover:bg-slate-50 ${
                  n.isRead ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-slate-800">{n.title}</p>
                  {!n.isRead && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{n.message}</p>
                <p className="mt-1 text-[11px] text-slate-400">{timeAgo(n.createdAt)}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
