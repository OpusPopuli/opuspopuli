"use client";

import type {
  GeolocationPermissionState,
  GeolocationError,
} from "@/lib/hooks/useGeolocation";

interface LocationPromptProps {
  permissionState: GeolocationPermissionState;
  isLoading: boolean;
  error: GeolocationError | null;
  onAllow: () => void;
  onSkip: () => void;
}

export function LocationPrompt({
  permissionState,
  isLoading,
  error,
  onAllow,
  onSkip,
}: LocationPromptProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center bg-black text-white">
        <svg
          className="w-8 h-8 mb-4 text-white animate-spin"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
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
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <p className="text-gray-300">Getting your location...</p>
      </div>
    );
  }

  // Error state
  if (error && error.type !== "permission") {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center bg-black text-white">
        <svg
          className="w-16 h-16 mb-6 text-yellow-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
        <h2 className="text-xl font-semibold mb-2">Location Unavailable</h2>
        <p className="text-gray-400 mb-8 max-w-sm">{error.message}</p>
        <button
          onClick={onSkip}
          className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
        >
          Continue Without Location
        </button>
      </div>
    );
  }

  // Denied state
  if (permissionState === "denied" || (error && error.type === "permission")) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center bg-black text-white">
        <svg
          className="w-16 h-16 mb-6 text-red-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
          />
        </svg>
        <h2 className="text-xl font-semibold mb-2">Location Access Denied</h2>
        <p className="text-gray-400 mb-8 max-w-sm">
          Location access was denied. You can continue without sharing your
          location.
        </p>
        <button
          onClick={onSkip}
          className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
        >
          Continue Without Location
        </button>
      </div>
    );
  }

  // Prompt state (default)
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center bg-black text-white">
      <svg
        className="w-16 h-16 mb-6 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
        />
      </svg>
      <h2 className="text-xl font-semibold mb-2">Add Scan Location?</h2>
      <p className="text-gray-400 mb-8 max-w-sm">
        Adding your location helps track where petitions are being circulated.
        Your exact position is never stored — we round to roughly a city block
        (~100m) for privacy.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={onAllow}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
        >
          Share Location
        </button>
        <button
          onClick={onSkip}
          className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
