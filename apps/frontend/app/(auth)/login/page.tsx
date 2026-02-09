"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  AuthCard,
  AuthHeader,
  AuthErrorAlert,
  AuthInput,
  AuthSubmitButton,
  AuthDivider,
} from "@/components/auth/AuthUI";

type AuthMode = "passkey" | "magic-link" | "password";

export default function LoginPage() {
  const router = useRouter();
  const {
    login,
    loginWithPasskey,
    sendMagicLink,
    isLoading,
    error,
    clearError,
    supportsPasskeys,
    magicLinkSent,
  } = useAuth();

  // Default to passkey if supported, otherwise magic link
  const [authMode, setAuthMode] = useState<AuthMode>(
    supportsPasskeys ? "passkey" : "magic-link",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handlePasskeyLogin = async () => {
    clearError();
    try {
      await loginWithPasskey(email || undefined);
      router.push("/onboarding");
    } catch {
      // Error is handled in context
    }
  };

  const handleMagicLinkLogin = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    await sendMagicLink(email, `${globalThis.location.origin}/auth/callback`);
  };

  const handlePasswordLogin = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login({ email, password });
      router.push("/onboarding");
    } catch {
      // Error is handled in context
    }
  };

  const switchMode = (mode: AuthMode) => {
    clearError();
    setAuthMode(mode);
  };

  const isPasswordFormValid = email.length > 0 && password.length >= 8;
  const isEmailValid = email.length > 0 && email.includes("@");

  return (
    <AuthCard>
      <AuthHeader
        title="Welcome back"
        subtitle="Sign in to your account to continue"
      />

      <AuthErrorAlert error={error} />

      {/* Auth Mode Tabs */}
      <div className="flex mb-6 border-b border-[#DDDDDD]">
        {supportsPasskeys && (
          <button
            type="button"
            onClick={() => switchMode("passkey")}
            className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 -mb-px
              ${
                authMode === "passkey"
                  ? "text-[#222222] border-[#222222]"
                  : "text-[#555555] border-transparent hover:text-[#222222]"
              }`}
          >
            Passkey
          </button>
        )}
        <button
          type="button"
          onClick={() => switchMode("magic-link")}
          className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 -mb-px
            ${
              authMode === "magic-link"
                ? "text-[#222222] border-[#222222]"
                : "text-[#555555] border-transparent hover:text-[#222222]"
            }`}
        >
          Email Link
        </button>
        <button
          type="button"
          onClick={() => switchMode("password")}
          className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 -mb-px
            ${
              authMode === "password"
                ? "text-[#222222] border-[#222222]"
                : "text-[#555555] border-transparent hover:text-[#222222]"
            }`}
        >
          Password
        </button>
      </div>

      {/* Passkey Mode */}
      {authMode === "passkey" && (
        <div className="space-y-5">
          <div className="text-center py-4">
            <div className="w-16 h-16 mx-auto mb-4 bg-[#f0f9ff] rounded-full flex items-center justify-center">
              <svg
                className="w-8 h-8 text-[#0ea5e9]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"
                />
              </svg>
            </div>
            <p className="text-[#555555] text-sm mb-4">
              Sign in instantly with your fingerprint, face, or device PIN
            </p>
          </div>

          <AuthInput
            id="passkey-email"
            label="Email (Optional)"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email webauthn"
          />

          <AuthSubmitButton
            type="button"
            onClick={handlePasskeyLogin}
            loading={isLoading}
            loadingText="Authenticating..."
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"
              />
            </svg>
            Sign in with Passkey
          </AuthSubmitButton>
        </div>
      )}

      {/* Magic Link Mode */}
      {authMode === "magic-link" && (
        <div className="space-y-5">
          {magicLinkSent ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 bg-[#f0fdf4] rounded-full flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-[#22c55e]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-[#222222] mb-2">
                Check your email
              </h3>
              <p className="text-[#555555] text-sm">
                We sent a sign-in link to <strong>{email}</strong>
              </p>
              <p className="text-[#888888] text-xs mt-2">
                The link expires in 2 hours
              </p>
            </div>
          ) : (
            <form onSubmit={handleMagicLinkLogin} className="space-y-5">
              <div className="text-center py-2">
                <p className="text-[#555555] text-sm">
                  We&apos;ll send you a magic link to sign in instantly
                </p>
              </div>

              <AuthInput
                id="magic-email"
                label="Email Address"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />

              <AuthSubmitButton
                disabled={!isEmailValid}
                loading={isLoading}
                loadingText="Sending..."
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                Send Magic Link
              </AuthSubmitButton>
            </form>
          )}
        </div>
      )}

      {/* Password Mode */}
      {authMode === "password" && (
        <form onSubmit={handlePasswordLogin} className="space-y-5">
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

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-semibold text-[#555555] uppercase tracking-wider mb-2"
            >
              Password
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
                placeholder="Enter your password"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555555] hover:text-[#222222] transition-colors"
              >
                {showPassword ? (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
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
                    aria-hidden="true"
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
          </div>

          <div className="text-right">
            <Link
              href="/forgot-password"
              className="text-sm text-[#555555] hover:text-[#222222] transition-colors"
            >
              Forgot your password?
            </Link>
          </div>

          <AuthSubmitButton
            disabled={!isPasswordFormValid}
            loading={isLoading}
            loadingText="Signing in..."
          >
            Sign in
          </AuthSubmitButton>
        </form>
      )}

      <AuthDivider />

      {/* Register Link */}
      <p className="text-center text-[#555555]">
        Don&apos;t have an account?{" "}
        <Link
          href="/register"
          className="text-[#222222] font-semibold hover:underline"
        >
          Create one
        </Link>
      </p>
    </AuthCard>
  );
}
