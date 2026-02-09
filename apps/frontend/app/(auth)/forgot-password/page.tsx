"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@apollo/client/react";
import { FORGOT_PASSWORD, ForgotPasswordData } from "@/lib/graphql/auth";
import {
  AuthCard,
  AuthHeader,
  AuthErrorAlert,
  AuthInput,
  AuthSubmitButton,
} from "@/components/auth/AuthUI";

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
      <AuthCard className="text-center">
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
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <AuthHeader
        title="Reset your password"
        subtitle="Enter your email and we'll send you a reset code"
      />

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
        />

        <AuthSubmitButton
          disabled={email.length === 0}
          loading={loading}
          loadingText="Sending..."
        >
          Send reset code
        </AuthSubmitButton>
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
    </AuthCard>
  );
}
