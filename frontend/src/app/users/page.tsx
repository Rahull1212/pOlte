"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RegionSelect } from "@/components/region-select";
import { useCurrentUser, ROLE_LABELS } from "@/hooks/use-auth";
import { useManagedUsers, useCreateManagedUser, useDeactivateUser } from "@/hooks/use-users";

export default function UsersPage() {
  const { data: currentUser } = useCurrentUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  // A Super Admin can look at either bucket; an Admin only ever manages
  // Cadres, so the URL param is ignored for them.
  const requestedRole = searchParams.get("role") === "CADRE" ? "CADRE" : "ADMIN";
  const targetRole = currentUser?.role === "SUPER_ADMIN" ? requestedRole : "CADRE";

  const { data: users, isLoading } = useManagedUsers(targetRole);
  const createUser = useCreateManagedUser();
  const deactivate = useDeactivateUser();
  const [form, setForm] = useState({ name: "", phone: "", password: "Password@123", regionId: "" });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createUser.mutate(
      { ...form, role: targetRole },
      { onSuccess: () => setForm({ name: "", phone: "", password: "Password@123", regionId: "" }) },
    );
  };

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">
          {targetRole === "ADMIN" ? "Manage Admins" : "Manage Cadres"}
        </h1>
        {currentUser?.role === "SUPER_ADMIN" && (
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/users")}
              className={`rounded-full px-3 py-1 text-xs ${
                targetRole === "ADMIN" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              Admins
            </button>
            <button
              onClick={() => router.push("/users?role=CADRE")}
              className={`rounded-full px-3 py-1 text-xs ${
                targetRole === "CADRE" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              Cadres
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Add {ROLE_LABELS[targetRole]}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="regionId">Area</Label>
                <RegionSelect value={form.regionId} onChange={(regionId) => setForm({ ...form, regionId })} />
              </div>
              <div>
                <Label htmlFor="password">Temporary password</Label>
                <Input
                  id="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              {createUser.isError && <p className="text-xs text-red-600">{(createUser.error as Error).message}</p>}
              <Button type="submit" className="w-full" disabled={createUser.isPending}>
                {createUser.isPending ? "Creating..." : `Create ${ROLE_LABELS[targetRole]}`}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>
              {ROLE_LABELS[targetRole]}s{" "}
              <span className="font-normal text-slate-400">({users?.length ?? 0})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-2">Name</th>
                  <th className="px-5 py-2">Phone</th>
                  <th className="px-5 py-2">Area</th>
                  <th className="px-5 py-2">Joined</th>
                  <th className="px-5 py-2">Status</th>
                  <th className="px-5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users?.map((u) => (
                  <tr key={u.id} className="border-b border-slate-50">
                    <td className="px-5 py-2 font-medium text-slate-800">{u.name}</td>
                    <td className="px-5 py-2">{u.phone}</td>
                    <td className="px-5 py-2">
                      {u.region ? `${u.region.name} (${u.region.type})` : "—"}
                    </td>
                    <td className="px-5 py-2 text-slate-500">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-2">
                      <Badge tone={u.isActive ? "green" : "slate"}>{u.isActive ? "Active" : "Inactive"}</Badge>
                    </td>
                    <td className="px-5 py-2 text-right">
                      {u.isActive && (
                        <Button variant="danger" onClick={() => deactivate.mutate(u.id)}>
                          Deactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!isLoading && users?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                      None yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
