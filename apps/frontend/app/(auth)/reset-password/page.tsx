"use client";

import { useState, FormEvent, useMemo } from "react";
import Link from "next/link";
import { useMutation } from "@apollo/client/react";
import {
  CONFIRM_FORGOT_PASSWORD,
  ConfirmForgotPasswordData,
} from "@/lib/graphql/auth";
import {
  AuthCard,
  AuthHeader,
  AuthErrorAlert,
  AuthInput,
  AuthSubmitButton,
} from "@/components/auth/AuthUI";

interface PasswordStrength {
  score: number;
  label: string;
  color: string;
  requirements: {
    met: boolean;
    text: string;
  }[];
}

function checkPasswordStrength(password: string): PasswordStrength {
  const requirements = [
    { met: password.length >= 8, text: "At least 8 characters" },
    { met: /[a-z]/.test(password), text: "One lowercase letter" },
    { met: /[A-Z]/.test(password), text: "One uppercase letter" },
    { met: /\d/.test(password), text: "One number" },
    {
      met: /[$&+,:;=?@#|'<>.^*()%!-]/.test(password),
      text: "One special character",
    },
  ];

  const score = requirements.filter((r) => r.met).length;

  let label = "Weak";
  let color = "#ef4444";

  if (score >= 5) {
    label = "Strong";
    color = "#22c55e";
  } else if (score >= 3) {
    label = "Medium";
    color = "#f59e0b";
  }

  return { score, label, color, requirements };
}

function getStoredEmail(): string {
  if (globalThis.window !== undefined) {
    return globalThis.sessionStorage.getItem("reset_email") || "";
  }
  return "";
}

export default function ResetPasswordPage() {
  const [email, setEmail] = useState(getStoredEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [confirmForgotPasswordMutation, { loading }] =
    useMutation<ConfirmForgotPasswordData>(CONFIRM_FORGOT_PASSWORD);

  const passwordStrength = useMemo(
    () => checkPasswordStrength(password),
    [password],
  );

  const passwordsMatch = password === confirmPassword;
  const isFormValid =
    email.length > 0 &&
    code.length > 0 &&
    passwordStrength.score >= 5 &&
    passwordsMatch;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const { data } = await confirmForgotPasswordMutation({
        variables: {
          confirmForgotPasswordDto: {
            email,
            confirmationCode: code,
            newPassword: password,
          },
        },
      });

      if (data?.confirmForgotPassword) {
        setSuccess(true);
        sessionStorage.removeItem("reset_email");
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to reset password. Please try again.";
      setError(message);
    }
  };

  if (success) {
    return (
      <AuthCard className="text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-green-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-[#222222] mb-2">
          Password reset successful
        </h1>
        <p className="text-[#555555] mb-6">
          Your password has been updated. You can now sign in with your new
          password.
        </p>
        <Link
          href="/login"
          className="inline-block py-3 px-6 bg-[#222222] text-white font-semibold rounded-lg hover:bg-[#333333] transition-colors"
        >
          Sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <AuthHeader
        title="Create new password"
        subtitle="Enter the code from your email and your new password"
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

        <AuthInput
          id="code"
          label="Reset Code"
          value={code}
          onChange={setCode}
          placeholder="Enter code"
          required
          autoComplete="one-time-code"
          className="font-mono tracking-widest text-center text-lg"
        />

        {/* New Password */}
        <div>
          <label
            htmlFor="password"
            className="block text-xs font-semibold text-[#555555] uppercase tracking-wider mb-2"
          >
            New Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-[#FFFFFF] border border-[#DDDDDD] rounded-lg
                       text-[#222222] placeholder-[#888888]
                       focus:outline-none focus:ring-2 focus:ring-[#222222] focus:border-transparent
                       transition-all duration-200 pr-12"
              placeholder="Create a strong password"
              required
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555555] hover:text-[#222222] transition-colors"
            >
              {showPassword ? (
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
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  />
                </svg>
              ) : (
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
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              )}
            </button>
          </div>

          {/* Password Strength Indicator */}
          {password.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[#555555]">
                  Password strength
                </span>
                <span
                  className="text-xs font-semibold"
                  style={{ color: passwordStrength.color }}
                >
                  {passwordStrength.label}
                </span>
              </div>
              <div className="h-1.5 bg-[#DDDDDD] rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${(passwordStrength.score / 5) * 100}%`,
                    backgroundColor: passwordStrength.color,
                  }}
                />
              </div>
              <ul className="mt-3 space-y-1">
                {passwordStrength.requirements.map((req) => (
                  <li
                    key={req.text}
                    className={`text-xs flex items-center gap-2 ${
                      req.met ? "text-green-600" : "text-[#888888]"
                    }`}
                  >
                    {req.met ? (
                      <svg
                        className="w-3.5 h-3.5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-3.5 h-3.5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <circle cx="10" cy="10" r="3" />
                      </svg>
                    )}
                    {req.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-xs font-semibold text-[#555555] uppercase tracking-wider mb-2"
          >
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={`w-full px-4 py-3 bg-[#FFFFFF] border rounded-lg
                     text-[#222222] placeholder-[#888888]
                     focus:outline-none focus:ring-2 focus:ring-[#222222] focus:border-transparent
                     transition-all duration-200
                     ${
                       confirmPassword.length > 0 && !passwordsMatch
                         ? "border-red-300"
                         : "border-[#DDDDDD]"
                     }`}
            placeholder="Confirm your new password"
            required
            autoComplete="new-password"
          />
          {confirmPassword.length > 0 && !passwordsMatch && (
            <p className="mt-1.5 text-xs text-red-600">
              Passwords do not match
            </p>
          )}
        </div>

        <AuthSubmitButton
          disabled={!isFormValid}
          loading={loading}
          loadingText="Resetting..."
        >
          Reset password
        </AuthSubmitButton>
      </form>

      {/* Back Links */}
      <div className="mt-8 text-center space-y-2">
        <p className="text-[#555555]">
          Need a new code?{" "}
          <Link
            href="/forgot-password"
            className="text-[#222222] font-semibold hover:underline"
          >
            Request again
          </Link>
        </p>
        <p className="text-[#555555]">
          Remember your password?{" "}
          <Link
            href="/login"
            className="text-[#222222] font-semibold hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}
