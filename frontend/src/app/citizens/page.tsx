"use client";

import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCitizens, useRegisterCitizen } from "@/hooks/use-citizens";

export default function CitizensPage() {
  const { data: citizens, isLoading } = useCitizens();
  const registerCitizen = useRegisterCitizen();
  const [form, setForm] = useState({ name: "", phone: "", address: "" });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    registerCitizen.mutate(form, { onSuccess: () => setForm({ name: "", phone: "", address: "" }) });
  };

  return (
    <AppShell>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">Citizens</h1>

      <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Register Citizen</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
              {registerCitizen.isError && (
                <p className="text-xs text-red-600">{(registerCitizen.error as Error).message}</p>
              )}
              <Button type="submit" className="w-full" disabled={registerCitizen.isPending}>
                {registerCitizen.isPending ? "Registering..." : "Register"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Registered Citizens</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-2">Name</th>
                  <th className="px-5 py-2">Phone</th>
                  <th className="px-5 py-2">Address</th>
                  <th className="px-5 py-2">Registered</th>
                </tr>
              </thead>
              <tbody>
                {citizens?.map((citizen) => (
                  <tr key={citizen.id} className="border-b border-slate-50">
                    <td className="px-5 py-2">{citizen.name}</td>
                    <td className="px-5 py-2">{citizen.phone ?? "-"}</td>
                    <td className="px-5 py-2">{citizen.address ?? "-"}</td>
                    <td className="px-5 py-2">{new Date(citizen.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
                {!isLoading && citizens?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-slate-500">
                      No citizens registered yet.
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
