"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@apollo/client/react";
import { FORGOT_PASSWORD, ForgotPasswordData } from "@/lib/graphql/auth";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [forgotPasswordMutation, { loading }] =
    useMutation<ForgotPasswordData>(FORGOT_PASSWORD);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const { data } = await forgotPasswordMutation({
        variables: { email },
      });

      if (data?.forgotPassword) {
        setSuccess(true);
        // Store email for reset page
        sessionStorage.setItem("reset_email", email);
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to send reset email. Please try again.";
      setError(message);
    }
  };

  if (success) {
    return (
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8 text-center">
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-blue-600"
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
        <p className="text-[#555555] mb-6">
          We&apos;ve sent a password reset code to{" "}
          <span className="font-medium text-[#222222]">{email}</span>
        </p>
        <button
          onClick={() => router.push("/reset-password")}
          className="inline-block py-3 px-6 bg-[#222222] text-white font-semibold rounded-lg hover:bg-[#333333] transition-colors"
        >
          Enter reset code
        </button>
        <p className="mt-4 text-sm text-[#555555]">
          Didn&apos;t receive the email?{" "}
          <button
            onClick={() => setSuccess(false)}
            className="text-[#222222] font-medium hover:underline"
          >
            Try again
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-[#222222] mb-2">
          Reset your password
        </h1>
        <p className="text-[#555555]">
          Enter your email and we&apos;ll send you a reset code
        </p>
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
          />
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={email.length === 0 || loading}
          className="w-full py-3 px-4 bg-[#222222] text-white font-semibold rounded-lg
                   hover:bg-[#333333] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#222222]
                   disabled:opacity-50 disabled:cursor-not-allowed
                   transition-all duration-200"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <LoadingSpinner />
              Sending...
            </span>
          ) : (
            "Send reset code"
          )}
        </button>
      </form>

      {/* Back to Login Link */}
      <p className="mt-8 text-center text-[#555555]">
        Remember your password?{" "}
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
