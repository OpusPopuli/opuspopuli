"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import {
  AuthCard,
  AuthHeader,
  AuthErrorAlert,
  AuthInput,
  AuthSubmitButton,
  AuthDivider,
} from "@/components/auth/AuthUI";

export default function RegisterPage() {
  const { registerWithMagicLink, isLoading, error, clearError, magicLinkSent } =
    useAuth();

  const [email, setEmail] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    await registerWithMagicLink(
      email,
      `${globalThis.location.origin}/auth/callback?type=register`,
    );
  };

  const isEmailValid = email.length > 0 && email.includes("@");

  // Success state - email sent
  if (magicLinkSent) {
    return (
      <AuthCard className="text-center">
        <div className="w-16 h-16 bg-[#f0fdf4] rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-[#22c55e]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-[#222222] mb-2">
          Check your email
        </h1>
        <p className="text-[#555555] mb-2">
          We&apos;ve sent a verification link to
        </p>
        <p className="font-medium text-[#222222] mb-4">{email}</p>
        <p className="text-[#555555] text-sm mb-6">
          Click the link in your email to complete your registration.
          <br />
          The link expires in 2 hours.
        </p>
        <div className="space-y-3">
          <Link
            href="/login"
            className="inline-block w-full py-3 px-6 bg-[#222222] text-white font-semibold rounded-lg hover:bg-[#333333] transition-colors"
          >
            Back to Sign in
          </Link>
          <button
            type="button"
            onClick={() => globalThis.location.reload()}
            className="inline-block w-full py-3 px-6 bg-white text-[#222222] font-semibold rounded-lg border border-[#DDDDDD] hover:bg-[#FFFFFF] transition-colors"
          >
            Use a different email
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <AuthHeader
        title="Create an account"
        subtitle="Get started with your free account"
      />

      {/* Benefits */}
      <div className="mb-6 p-4 bg-[#f0f9ff] rounded-lg">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-[#0ea5e9] rounded-full flex items-center justify-center flex-shrink-0">
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-[#0c4a6e]">
              No password required
            </p>
            <p className="text-xs text-[#0369a1] mt-1">
              We&apos;ll send you a secure link to verify your email and set up
              your account. After that, you can use passkeys for instant
              sign-in.
            </p>
          </div>
        </div>
      </div>

      <AuthErrorAlert error={error} />

      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthInput
          id="email"
          label="Email Address"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          required
          autoComplete="email"
          autoFocus
        />

        <AuthSubmitButton
          disabled={!isEmailValid}
          loading={isLoading}
          loadingText="Sending verification link..."
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
          Continue with Email
        </AuthSubmitButton>

        {/* Terms */}
        <p className="text-xs text-[#555555] text-center">
          By creating an account, you agree to our{" "}
          <Link
            href="/terms"
            className="text-[#222222] underline hover:no-underline"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy"
            className="text-[#222222] underline hover:no-underline"
          >
            Privacy Policy
          </Link>
        </p>
      </form>

      <AuthDivider />

      {/* Login Link */}
      <p className="text-center text-[#555555]">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-[#222222] font-semibold hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
