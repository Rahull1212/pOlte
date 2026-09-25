"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { useCurrentUser, ROLE_LABELS } from "@/hooks/use-auth";
import { useUpdateProfile, useChangePassword, useUploadProfilePicture } from "@/hooks/use-profile";
import { PhoneChangeCard } from "@/components/phone-change-card";
import { clearToken } from "@/lib/auth";
import { Gender } from "@/lib/shared-types";

const GENDER_LABELS: Record<Gender, string> = {
  MALE: "Male",
  FEMALE: "Female",
  OTHER: "Other",
  PREFER_NOT_TO_SAY: "Prefer not to say",
};

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export default function ProfilePage() {
  const { data: user } = useCurrentUser();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();
  const uploadPicture = useUploadProfilePicture();
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [info, setInfo] = useState({ name: "", email: "", gender: "" as Gender | "" });
  const [infoTouched, setInfoTouched] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordFormError, setPasswordFormError] = useState<string | null>(null);

  if (user && !infoTouched) {
    // Seed the edit form once the profile has loaded (avoids fighting the
    // user's in-progress edits every time the query refetches).
    setInfo({ name: user.name, email: user.email ?? "", gender: user.gender ?? "" });
    setInfoTouched(true);
  }

  const onSaveInfo = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile.mutate({
      name: info.name,
      email: info.email || undefined,
      gender: info.gender || undefined,
    });
  };

  const onChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFormError(null);
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordFormError("New password and confirmation don't match");
      return;
    }
    changePassword.mutate(
      { currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword },
      { onSuccess: () => setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" }) },
    );
  };

  const onPickPicture = () => fileInputRef.current?.click();

  const onPictureSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadPicture.mutate(file);
    e.target.value = "";
  };

  const logout = () => {
    clearToken();
    queryClient.clear();
    router.push("/login");
  };

  return (
    <AppShell>
      <h1 className="mb-6 text-lg font-semibold text-slate-900">My Profile</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-5 flex items-center gap-4">
              {user?.profilePicture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.profilePicture} alt={user.name} className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-lg font-semibold text-brand-700">
                  {user ? initials(user.name) : "?"}
                </span>
              )}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={onPictureSelected}
                />
                <Button type="button" variant="secondary" onClick={onPickPicture} disabled={uploadPicture.isPending}>
                  {uploadPicture.isPending ? "Uploading..." : "Change photo"}
                </Button>
                {uploadPicture.isError && (
                  <p className="mt-1 text-xs text-red-600">{(uploadPicture.error as Error).message}</p>
                )}
              </div>
            </div>

            <form onSubmit={onSaveInfo} className="space-y-3">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" required value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={info.email}
                  onChange={(e) => setInfo({ ...info, email: e.target.value })}
                />
              </div>
              <PhoneChangeCard currentPhone={user?.phone ?? ""} />
              <div>
                <Label htmlFor="gender">Gender</Label>
                <select
                  id="gender"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={info.gender}
                  onChange={(e) => setInfo({ ...info, gender: e.target.value as Gender })}
                >
                  <option value="">Prefer not to say</option>
                  {Gender.map((g) => (
                    <option key={g} value={g}>
                      {GENDER_LABELS[g]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Role</Label>
                  <Input value={user ? ROLE_LABELS[user.role] : ""} disabled className="bg-slate-50 text-slate-500" />
                </div>
                <div>
                  <Label>Area</Label>
                  <Input
                    value={user?.region ? `${user.region.name} (${user.region.type})` : ""}
                    disabled
                    className="bg-slate-50 text-slate-500"
                  />
                </div>
              </div>
              {updateProfile.isError && (
                <p className="text-xs text-red-600">{(updateProfile.error as Error).message}</p>
              )}
              {updateProfile.isSuccess && <p className="text-xs text-emerald-600">Saved.</p>}
              <Button type="submit" disabled={updateProfile.isPending}>
                {updateProfile.isPending ? "Saving..." : "Save changes"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Security</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={onChangePassword} className="space-y-3">
                <div>
                  <Label htmlFor="currentPassword">Current password</Label>
                  <PasswordInput
                    id="currentPassword"
                    required
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="newPassword">New password</Label>
                  <PasswordInput
                    id="newPassword"
                    required
                    minLength={6}
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="confirmPassword">Confirm new password</Label>
                  <PasswordInput
                    id="confirmPassword"
                    required
                    minLength={6}
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  />
                </div>
                {(passwordFormError || changePassword.isError) && (
                  <p className="text-xs text-red-600">
                    {passwordFormError ?? (changePassword.error as Error)?.message}
                  </p>
                )}
                {changePassword.isSuccess && <p className="text-xs text-emerald-600">Password updated.</p>}
                <Button type="submit" disabled={changePassword.isPending}>
                  {changePassword.isPending ? "Updating..." : "Change password"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Support</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <Link href="/support/help" className="block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Help Center
              </Link>
              <Link
                href="/support/contact"
                className="block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Contact Support
              </Link>
              <Link
                href="/support/privacy"
                className="block rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Privacy Policy
              </Link>
              <button
                onClick={logout}
                className="block w-full rounded-md px-2 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                Logout
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
