"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useForgotPassword, useResetPassword } from "@/hooks/use-password-reset";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const forgotPassword = useForgotPassword();
  const resetPassword = useResetPassword();

  const [phone, setPhone] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const onRequestCode = (e: React.FormEvent) => {
    e.preventDefault();
    forgotPassword.mutate({ phone }, { onSuccess: () => setCodeSent(true) });
  };

  const onReset = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (newPassword !== confirmPassword) {
      setFormError("New password and confirmation don't match");
      return;
    }
    resetPassword.mutate(
      { phone, code, newPassword },
      { onSuccess: () => router.push("/login?reset=1") },
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">{codeSent ? "Reset your password" : "Forgot password"}</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            {codeSent
              ? `Enter the code sent via WhatsApp to ${phone} and choose a new password.`
              : "Enter your phone number and we'll send a verification code via WhatsApp."}
          </p>
        </CardHeader>
        <CardContent>
          {!codeSent ? (
            <form onSubmit={onRequestCode} className="space-y-4">
              <div>
                <Label htmlFor="phone">Phone number</Label>
                <Input id="phone" required value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              {forgotPassword.isError && (
                <p className="text-xs text-red-600">{(forgotPassword.error as Error).message}</p>
              )}
              <Button type="submit" className="w-full" disabled={forgotPassword.isPending}>
                {forgotPassword.isPending ? "Sending..." : "Send code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={onReset} className="space-y-4">
              <div>
                <Label htmlFor="code">Verification code</Label>
                <Input id="code" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              {(formError || resetPassword.isError) && (
                <p className="text-xs text-red-600">{formError ?? (resetPassword.error as Error)?.message}</p>
              )}
              <Button type="submit" className="w-full" disabled={resetPassword.isPending}>
                {resetPassword.isPending ? "Resetting..." : "Reset password"}
              </Button>
              <button
                type="button"
                onClick={() => setCodeSent(false)}
                className="w-full text-center text-xs text-slate-500 hover:underline"
              >
                Use a different phone number
              </button>
            </form>
          )}
          <p className="mt-4 text-center text-xs text-slate-500">
            <Link href="/login" className="text-brand-600 hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
