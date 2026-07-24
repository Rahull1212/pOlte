"use client";

import { AppShell } from "@/components/app-shell";
import { useCurrentUser } from "@/hooks/use-auth";
import { SuperAdminDashboard } from "@/components/dashboards/super-admin-dashboard";
import { AdminDashboard } from "@/components/dashboards/admin-dashboard";
import { CadreDashboard } from "@/components/dashboards/cadre-dashboard";

export default function DashboardPage() {
  const { data: user, isLoading } = useCurrentUser();

  return (
    <AppShell>
      {isLoading && <p className="text-sm text-slate-500">Loading...</p>}
      {user?.role === "SUPER_ADMIN" && <SuperAdminDashboard />}
      {user?.role === "ADMIN" && <AdminDashboard />}
      {user?.role === "CADRE" && <CadreDashboard />}
    </AppShell>
  );
}
