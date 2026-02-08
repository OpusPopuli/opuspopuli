"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

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
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8 text-center">
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
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-[#222222] mb-2">
          Create an account
        </h1>
        <p className="text-[#555555]">Get started with your free account</p>
      </div>

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

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Email */}
        <div>
          <label
            htmlFor="email"
            className="block text-xs font-semibold text-[#555555] uppercase tracking-wider mb-2"
          >
            Email Address
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 bg-[#FFFFFF] border border-[#DDDDDD] rounded-lg
                     text-[#222222] placeholder-[#888888]
                     focus:outline-none focus:ring-2 focus:ring-[#222222] focus:border-transparent
                     transition-all duration-200"
            placeholder="you@example.com"
            required
            autoComplete="email"
            autoFocus
          />
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!isEmailValid || isLoading}
          className="w-full py-3 px-4 bg-[#222222] text-white font-semibold rounded-lg
                   hover:bg-[#333333] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#222222]
                   disabled:opacity-50 disabled:cursor-not-allowed
                   transition-all duration-200 flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <span className="inline-flex items-center gap-2">
              <svg
                className="animate-spin h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Sending verification link...
            </span>
          ) : (
            <>
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
            </>
          )}
        </button>

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

      {/* Divider */}
      <div className="my-8 flex items-center">
        <div className="flex-1 border-t border-[#DDDDDD]" />
        <span className="px-4 text-sm text-[#555555]">or</span>
        <div className="flex-1 border-t border-[#DDDDDD]" />
      </div>

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
    </div>
  );
}
