"use client";

import { InputHTMLAttributes, forwardRef, useState } from "react";
import clsx from "clsx";
import { EyeIcon, EyeOffIcon } from "../icons";

/**
 * A password field with a show/hide toggle.
 *
 * forwardRef and a full props passthrough so it drops into react-hook-form's
 * {...register("password")} exactly where a plain <Input> would — the toggle
 * only swaps the `type`, so the form never sees a different field.
 */
export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = useState(false);

    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          className={clsx(
            // pr-10 keeps the typed value clear of the toggle button.
            "w-full rounded-md border border-slate-300 px-3 py-2 pr-10 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500",
            className,
          )}
          {...props}
        />
        <button
          type="button"
          // tabIndex -1: Tab should go from the password straight to Sign in,
          // not detour through a control that only changes what's displayed.
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
        >
          {visible ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
