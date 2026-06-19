"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { api, ApiResponseError } from "@/lib/api/client";
import { ADMIN_TOKEN_COOKIE } from "@/lib/auth/cookies";
import { ShieldCheck } from "lucide-react";

const schema = z.object({
  // Accepts an email address or a username (e.g. "mkabwe").
  email: z.string().min(1, "Email or username is required"),
  password: z.string().min(1, "Password is required"),
});
type FormData = z.infer<typeof schema>;

interface LoginResponse {
  // Full token issued when MFA is not required
  token?: string;
  // Partial token issued when MFA is required (limits capabilities until MFA is confirmed)
  mfa_required?: boolean;
  mfa_partial_token?: string;
}

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") ?? "/dashboard";
  const reason = params.get("reason");

  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function onSubmit(data: FormData) {
    setServerError(null);
    try {
      const res = await api.post<LoginResponse>("/api/admin/auth/login", data);

      if (res.mfa_required && res.mfa_partial_token) {
        // Store the partial token in a short-lived cookie, then go to MFA
        document.cookie = `admin_mfa_partial=${encodeURIComponent(
          res.mfa_partial_token
        )}; path=/; max-age=300; SameSite=Lax`;
        router.push(`/mfa?redirect=${encodeURIComponent(redirect)}`);
        return;
      }

      // MFA not required” persist the full token. The cookie is intentionally
      // non-HttpOnly: the API client reads it from document.cookie to attach the
      // Bearer header, and middleware/getAdminSession read it server-side.
      if (res.token) {
        const secure = window.location.protocol === "https:" ? "; Secure" : "";
        document.cookie = `${ADMIN_TOKEN_COOKIE}=${encodeURIComponent(
          res.token
        )}; path=/; max-age=${60 * 60 * 8}; SameSite=Lax${secure}`;
      }
      router.push(redirect);
    } catch (err) {
      if (err instanceof ApiResponseError) {
        setServerError(err.error.message);
      } else {
        setServerError("An unexpected error occurred.");
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo / wordmark */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-teal-600">
            <ShieldCheck className="size-5 text-white" />
          </div>
          <h1 className="text-base font-medium text-slate-900 dark:text-slate-100">
            SSM Admin
          </h1>
        </div>

        {/* Reason banners */}
        {reason === "idle" && (
          <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-700 text-center">
            You were signed out due to inactivity.
          </p>
        )}
        {reason === "expired" && (
          <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-700 text-center">
            Your session expired. Please sign in again.
          </p>
        )}

        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="email"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Email or username
            </label>
            <input
              id="email"
              type="text"
              autoComplete="username"
              {...register("email")}
              className={cn(
                "h-9 w-full rounded-lg border px-3 text-sm",
                "border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100",
                "focus:outline-none focus:ring-2 focus:ring-teal-500",
                errors.email && "border-red-400"
              )}
            />
            {errors.email && (
              <p className="text-xs text-red-500">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="password"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register("password")}
              className={cn(
                "h-9 w-full rounded-lg border px-3 text-sm",
                "border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100",
                "focus:outline-none focus:ring-2 focus:ring-teal-500",
                errors.password && "border-red-400"
              )}
            />
            {errors.password && (
              <p className="text-xs text-red-500">{errors.password.message}</p>
            )}
          </div>

          {serverError && (
            <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
              {serverError}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="text-center text-xs text-slate-400">
          Admin access only. This portal is not for customers or providers.
        </p>
      </div>
    </div>
  );
}
