"use client";

import { useState } from "react";
import { Input, Label } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { useRequestPhoneChange, useConfirmPhoneChange } from "@/hooks/use-profile";

export function PhoneChangeCard({ currentPhone }: { currentPhone: string }) {
  const requestChange = useRequestPhoneChange();
  const confirmChange = useConfirmPhoneChange();
  const [editing, setEditing] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");

  const reset = () => {
    setEditing(false);
    setNewPhone("");
    setCurrentPassword("");
    setCodeSent(false);
    setCode("");
    requestChange.reset();
    confirmChange.reset();
  };

  const onRequest = (e: React.FormEvent) => {
    e.preventDefault();
    requestChange.mutate({ newPhone, currentPassword }, { onSuccess: () => setCodeSent(true) });
  };

  const onConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    confirmChange.mutate({ newPhone, code }, { onSuccess: () => reset() });
  };

  if (!editing) {
    return (
      <div>
        <Label htmlFor="phone">Phone</Label>
        <div className="flex items-center gap-2">
          <Input id="phone" value={currentPhone} disabled className="bg-slate-50 text-slate-500" />
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Change
          </Button>
        </div>
        <p className="mt-1 text-xs text-slate-400">Phone number is your login ID.</p>
      </div>
    );
  }

  if (!codeSent) {
    return (
      <div className="rounded-md border border-slate-200 p-3">
        <p className="mb-2 text-sm font-medium text-slate-800">Change phone number</p>
        <form onSubmit={onRequest} className="space-y-2">
          <div>
            <Label htmlFor="newPhone">New phone number</Label>
            <Input id="newPhone" required value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="currentPasswordForPhone">Current password</Label>
            <PasswordInput
              id="currentPasswordForPhone"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          {requestChange.isError && (
            <p className="text-xs text-red-600">{(requestChange.error as Error).message}</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={requestChange.isPending}>
              {requestChange.isPending ? "Sending..." : "Send code"}
            </Button>
            <Button type="button" variant="secondary" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-brand-100 bg-brand-50 p-3">
      <p className="mb-2 text-sm font-medium text-slate-800">Enter the code sent (via WhatsApp) to {newPhone}</p>
      <form onSubmit={onConfirm} className="space-y-2">
        <div>
          <Label htmlFor="phoneChangeCode">Verification code</Label>
          <Input id="phoneChangeCode" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        {confirmChange.isError && (
          <p className="text-xs text-red-600">{(confirmChange.error as Error).message}</p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={confirmChange.isPending}>
            {confirmChange.isPending ? "Confirming..." : "Confirm"}
          </Button>
          <Button type="button" variant="secondary" onClick={reset}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
