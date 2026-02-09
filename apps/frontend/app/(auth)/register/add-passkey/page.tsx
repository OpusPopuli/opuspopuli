"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function AddPasskeyPage() {
  const router = useRouter();
  const {
    registerPasskey,
    user,
    isLoading,
    error,
    clearError,
    supportsPasskeys,
  } = useAuth();

  const [friendlyName, setFriendlyName] = useState("");
  const [success, setSuccess] = useState(false);

  const handleAddPasskey = async () => {
    if (!user?.email) {
      return;
    }

    clearError();
    const result = await registerPasskey(user.email, friendlyName || undefined);

    if (result) {
      setSuccess(true);
    }
  };

  // Check if passkeys are supported
  if (!supportsPasskeys) {
    return (
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8 text-center">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-amber-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-[#222222] mb-2">
          Passkeys not supported
        </h1>
        <p className="text-[#555555] mb-6">
          Your browser or device doesn&apos;t support passkeys yet. You can
          still use magic links to sign in.
        </p>
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

  // Success state
  if (success) {
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
          Passkey added!
        </h1>
        <p className="text-[#555555] mb-6">
          You can now sign in instantly with your fingerprint, face, or device
          PIN.
        </p>
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

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="w-16 h-16 mx-auto mb-4 bg-[#f0f9ff] rounded-full flex items-center justify-center">
          <svg
            className="w-8 h-8 text-[#0ea5e9]"
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
        <h1 className="text-2xl font-bold text-[#222222] mb-2">
          Add a Passkey
        </h1>
        <p className="text-[#555555]">
          Set up faster, more secure sign-in for your account
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Benefits */}
      <div className="mb-6 space-y-3">
        <div className="flex items-start gap-3 p-3 bg-[#FFFFFF] rounded-lg">
          <svg
            className="w-5 h-5 text-[#22c55e] mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-[#222222]">More secure</p>
            <p className="text-xs text-[#555555]">
              Passkeys can&apos;t be phished or leaked in data breaches
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 bg-[#FFFFFF] rounded-lg">
          <svg
            className="w-5 h-5 text-[#22c55e] mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-[#222222]">
              Instant sign-in
            </p>
            <p className="text-xs text-[#555555]">
              Use your fingerprint, face, or device PIN
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 bg-[#FFFFFF] rounded-lg">
          <svg
            className="w-5 h-5 text-[#22c55e] mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-[#222222]">
              Works across devices
            </p>
            <p className="text-xs text-[#555555]">
              Synced passkeys work on all your Apple, Google, or Microsoft
              devices
            </p>
          </div>
        </div>
      </div>

      {/* Optional friendly name */}
      <div className="mb-6">
        <label
          htmlFor="friendlyName"
          className="block text-xs font-semibold text-[#555555] uppercase tracking-wider mb-2"
        >
          Passkey Name (Optional)
        </label>
        <input
          id="friendlyName"
          type="text"
          value={friendlyName}
          onChange={(e) => setFriendlyName(e.target.value)}
          className="w-full px-4 py-3 bg-[#FFFFFF] border border-[#DDDDDD] rounded-lg
                   text-[#222222] placeholder-[#888888]
                   focus:outline-none focus:ring-2 focus:ring-[#222222] focus:border-transparent
                   transition-all duration-200"
          placeholder="e.g., MacBook Pro, iPhone"
        />
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={handleAddPasskey}
          disabled={isLoading}
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
              Creating passkey...
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
                  d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"
                />
              </svg>
              Create Passkey
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => router.push("/rag-demo")}
          className="w-full py-3 px-6 bg-white text-[#555555] font-semibold rounded-lg border border-[#DDDDDD] hover:bg-[#FFFFFF] transition-colors"
        >
          Skip for now
        </button>
      </div>

      <p className="mt-6 text-xs text-[#888888] text-center">
        You can add more passkeys later in your account settings.
      </p>
    </div>
  );
}
