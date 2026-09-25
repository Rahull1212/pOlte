"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { clearToken } from "@/lib/auth";
import { useCurrentUser, ROLE_LABELS } from "@/hooks/use-auth";
import { searchTargetFor } from "@/lib/search-targets";
import { NotificationsBell } from "./notifications-bell";
import {
  HomeIcon,
  MegaphoneIcon,
  CalendarIcon,
  UsersIcon,
  MapPinIcon,
  GrievanceIcon,
  ChartIcon,
  ChatBubbleIcon,
  PollIcon,
  PlugIcon,
  SheetIcon,
  SearchIcon,
  ChevronDownIcon,
  LogoutIcon,
  UserCircleIcon,
} from "./icons";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface AppShellProps {
  children: React.ReactNode;
  // Opt out of <main>'s centered max-w-7xl/padding box for a page that needs
  // to fill the exact remaining viewport height itself (e.g. an embedded
  // workspace with its own internal scrolling) rather than growing to fit
  // whatever content it holds. Every other page keeps the default box.
  fullBleed?: boolean;
}

export function AppShell({ children, fullBleed = false }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const [profileOpen, setProfileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: HomeIcon },
    { href: "/campaigns", label: "Campaigns", icon: MegaphoneIcon },
    { href: "/events", label: "Events", icon: CalendarIcon },
    { href: "/grievances", label: "Grievances", icon: GrievanceIcon },
    ...(user?.role === "SUPER_ADMIN" || user?.role === "ADMIN"
      ? [{ href: "/tasks", label: "Tasks", icon: ChartIcon }]
      : []),
    ...(user?.role === "SUPER_ADMIN" || user?.role === "ADMIN"
      ? [{ href: "/polls", label: "Polls", icon: PollIcon }]
      : []),
    ...(user?.role === "SUPER_ADMIN" || user?.role === "ADMIN"
      ? [{ href: "/users", label: user.role === "SUPER_ADMIN" ? "Admins" : "Cadres", icon: UsersIcon }]
      : []),
    ...(user?.role === "SUPER_ADMIN" || user?.role === "ADMIN"
      ? [{ href: "/areas", label: "Areas", icon: MapPinIcon }]
      : []),
    ...(user?.role === "SUPER_ADMIN"
      ? [{ href: "/bulk-messages", label: "Bulk Messages", icon: ChatBubbleIcon }]
      : []),
    // Admins see their own sends here, Super Admins see everyone's — the
    // scoping is applied server-side.
    ...(user?.role === "SUPER_ADMIN" || user?.role === "ADMIN"
      ? [{ href: "/message-log", label: "Message Log", icon: SheetIcon }]
      : []),
    ...(user?.role === "SUPER_ADMIN" || user?.role === "ADMIN"
      ? [{ href: "/fyxo-connect", label: "Fyxo Connect", icon: PlugIcon }]
      : []),
    // Super Admin only — deliberately. An Admin CAN change their own
    // template, but they do it on the task-create form, where the choice
    // actually matters; a whole module of their own would be one page
    // holding a single dropdown.
    ...(user?.role === "SUPER_ADMIN"
      ? [{ href: "/message-templates", label: "WhatsApp Templates", icon: ChatBubbleIcon }]
      : []),
  ];

  const isActive = (href: string) => pathname === href || (href !== "/dashboard" && pathname?.startsWith(href));

  // The search box belongs to whichever section you're in — it used to be
  // wired to campaigns everywhere, so on Tasks it offered to search
  // campaigns and then navigated away from the page you were on.
  const searchTarget = searchTargetFor(pathname);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTarget) return;
    const query = search.trim();
    router.push(query ? `${searchTarget.route}?q=${encodeURIComponent(query)}` : searchTarget.route);
  };

  // Moving between sections clears whatever was typed for the previous one:
  // a leftover "Road Repair" sitting in the box on the Campaigns tab reads
  // as an applied filter that isn't actually applied.
  useEffect(() => {
    setSearch("");
  }, [searchTarget?.route]);

  const logout = () => {
    clearToken();
    queryClient.clear();
    router.push("/login");
  };

  return (
    <div
      className={
        fullBleed
          // Non-fullBleed pages want min-h-screen — content can legitimately
          // run longer than one screen and the whole document scrolls, which
          // is normal and fine. fullBleed pages must never exceed the
          // viewport at all: min-h-screen only sets a *floor*, not a
          // ceiling, so if anything inside (see the min-h-0 note below) ever
          // grows even slightly past 100vh, this root would happily grow
          // with it — producing a real, scrollable document whose sticky
          // aside/header stay pinned at their normal position while
          // everything below that point renders as blank page background.
          // h-screen + overflow-hidden makes that structurally impossible.
          ? "flex h-screen overflow-hidden bg-slate-50"
          : "flex min-h-screen bg-slate-50"
      }
    >
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            P
          </span>
          <span className="text-sm font-bold text-slate-900">PoliOS</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive(item.href)
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-100 px-5 py-4 text-xs text-slate-400">PoliOS v0.1</div>
      </aside>

      {/*
        min-h-0 here is the actual root-cause fix: as a flex item in the
        outer row, this column's default min-height is "auto", which means
        flexbox refuses to shrink it below its content's own automatic
        minimum size — and that computation can walk all the way down
        through <main>'s flex-1 chain to whatever's inside (an iframe,
        here), letting the *column* grow taller than the viewport even
        though every box in the chain below it is correctly told to fill
        (not exceed) 100%. min-h-0 overrides that default so "flex-1 fills
        exactly the available space" actually holds all the way down.
      */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3">
          {searchTarget ? (
            <form onSubmit={onSearch} className="max-w-sm flex-1">
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                <SearchIcon className="h-4 w-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${searchTarget.noun}...`}
                  aria-label={`Search ${searchTarget.noun}`}
                  className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                />
              </div>
            </form>
          ) : (
            // Keeps the notifications bell and profile menu where they are
            // on every other page, instead of sliding them left.
            <div className="flex-1" />
          )}

          <div className="flex items-center gap-2">
            <NotificationsBell />

            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen((v) => !v)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
              >
                {user?.profilePicture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.profilePicture}
                    alt={user.name}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                    {user ? initials(user.name) : "?"}
                  </span>
                )}
                <span className="hidden text-left text-sm sm:block">
                  <span className="block font-medium text-slate-800">{user?.name}</span>
                  <span className="block text-xs text-slate-400">{user ? ROLE_LABELS[user.role] : ""}</span>
                </span>
                <ChevronDownIcon className="h-4 w-4 text-slate-400" />
              </button>

              {profileOpen && (
                <div className="absolute right-0 z-20 mt-2 w-48 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  <div className="border-b border-slate-100 px-4 py-2">
                    <p className="text-sm font-medium text-slate-800">{user?.name}</p>
                    <p className="text-xs text-slate-400">{user ? ROLE_LABELS[user.role] : ""}</p>
                  </div>
                  <Link
                    href="/profile"
                    onClick={() => setProfileOpen(false)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <UserCircleIcon className="h-4 w-4" />
                    Profile
                  </Link>
                  <button
                    onClick={logout}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    <LogoutIcon className="h-4 w-4" />
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main
          className={
            fullBleed
              // A plain block <main> with flex-1 stretches to fill the
              // remaining viewport height (the sidebar's h-screen forces
              // stretch alignment down the tree) but doesn't pass that
              // height on to its children by default — that's what left a
              // tall, empty gap under a shorter-than-viewport child before.
              // flex + min-h-0 here makes <main> a real flex container so a
              // flex-1 child can actually claim 100% of that space, and
              // overflow-hidden keeps the page itself from ever scrolling.
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "mx-auto w-full max-w-7xl flex-1 px-6 py-6"
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}
