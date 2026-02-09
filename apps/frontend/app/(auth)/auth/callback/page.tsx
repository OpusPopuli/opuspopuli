"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

// Loading component for Suspense fallback
function CallbackLoading() {
  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8 text-center">
      <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center">
        <svg
          className="animate-spin h-10 w-10 text-[#222222]"
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
      </div>
      <h1 className="text-xl font-bold text-[#222222] mb-2">Loading...</h1>
      <p className="text-[#555555]">Please wait.</p>
    </div>
  );
}

// Main callback content component that uses useSearchParams
function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { verifyMagicLink, isLoading, error, supportsPasskeys } = useAuth();

  const [status, setStatus] = useState<"verifying" | "success" | "error">(
    "verifying",
  );
  const [isNewUser, setIsNewUser] = useState(false);

  // Guard against double execution (React StrictMode, fast refresh, etc.)
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    // Prevent double execution
    if (hasProcessedRef.current) {
      return;
    }
    hasProcessedRef.current = true;

    // Get params from URL (Supabase magic link format)
    const token = searchParams.get("token");
    const email = searchParams.get("email");
    const type = searchParams.get("type");

    // Check for Supabase hash params format (#access_token=...)
    const hash = globalThis.location.hash;
    let accessToken = null;

    if (hash) {
      const hashParams = new URLSearchParams(hash.substring(1));
      accessToken = hashParams.get("access_token");
    }

    // If we have access_token in hash, Supabase already verified
    if (accessToken) {
      // The user is already authenticated via Supabase
      // We need to sync with our backend
      setIsNewUser(type === "register");
      setStatus("success");
      return;
    }

    // If we have email and token, verify via our backend
    if (email && token) {
      // Use async IIFE for the verification call
      (async () => {
        try {
          await verifyMagicLink(email, token);
          setIsNewUser(type === "register");
          setStatus("success");
        } catch {
          // Reset the guard on error so user can retry if needed
          hasProcessedRef.current = false;
          setStatus("error");
        }
      })();
      return;
    }

    // No valid params found
    setStatus("error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Verifying state
  if (status === "verifying" || isLoading) {
    return (
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center">
          <svg
            className="animate-spin h-10 w-10 text-[#222222]"
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
        </div>
        <h1 className="text-xl font-bold text-[#222222] mb-2">
          Verifying your link...
        </h1>
        <p className="text-[#555555]">Please wait while we sign you in.</p>
      </div>
    );
  }

  // Error state
  if (status === "error" || error) {
    return (
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-red-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-[#222222] mb-2">
          Link expired or invalid
        </h1>
        <p className="text-[#555555] mb-6">
          {error ||
            "This magic link has expired or is invalid. Please request a new one."}
        </p>
        <div className="space-y-3">
          <Link
            href="/login"
            className="inline-block w-full py-3 px-6 bg-[#222222] text-white font-semibold rounded-lg hover:bg-[#333333] transition-colors"
          >
            Back to Sign in
          </Link>
        </div>
      </div>
    );
  }

  // Success state - show passkey prompt for new users
  if (isNewUser && supportsPasskeys) {
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
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-[#222222] mb-2">
          Welcome! Your account is ready
        </h1>
        <p className="text-[#555555] mb-6">
          Would you like to add a passkey for faster sign-in next time?
        </p>

        {/* Passkey benefits */}
        <div className="mb-6 p-4 bg-[#f0f9ff] rounded-lg text-left">
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
                  d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-[#0c4a6e]">
                Sign in with your fingerprint or face
              </p>
              <p className="text-xs text-[#0369a1] mt-1">
                Passkeys are more secure than passwords and work across all your
                devices.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <Link
            href="/register/add-passkey"
            className="inline-block w-full py-3 px-6 bg-[#222222] text-white font-semibold rounded-lg hover:bg-[#333333] transition-colors"
          >
            Add a Passkey
          </Link>
          <button
            type="button"
            onClick={() => router.push("/rag-demo")}
            className="inline-block w-full py-3 px-6 bg-white text-[#555555] font-semibold rounded-lg border border-[#DDDDDD] hover:bg-[#FFFFFF] transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  // Success state - redirect to app
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
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-[#222222] mb-2">
        You&apos;re signed in!
      </h1>
      <p className="text-[#555555] mb-6">Redirecting you to the app...</p>
      <button
        type="button"
        onClick={() => router.push("/rag-demo")}
        className="inline-block w-full py-3 px-6 bg-[#222222] text-white font-semibold rounded-lg hover:bg-[#333333] transition-colors"
      >
        Continue to App
      </button>
    </div>
  );
}

// Page component wrapped in Suspense for useSearchParams
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackLoading />}>
      <AuthCallbackContent />
    </Suspense>
  );
}
