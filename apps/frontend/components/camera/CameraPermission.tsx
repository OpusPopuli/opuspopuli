"use client";

import type { CameraPermissionState } from "@/lib/hooks/useCamera";

interface CameraPermissionProps {
  state: CameraPermissionState;
  onRequestPermission: () => void;
}

export function CameraPermission({
  state,
  onRequestPermission,
}: CameraPermissionProps) {
  if (state === "granted") return null;

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center bg-black text-white">
      {state === "prompt" && (
        <>
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
              d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"
            />
          </svg>
          <h2 className="text-xl font-semibold mb-2">Camera Access Needed</h2>
          <p className="text-gray-400 mb-8 max-w-sm">
            To scan petitions, we need access to your camera. Your images are
            processed securely and never saved to your device.
          </p>
          <button
            onClick={onRequestPermission}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Enable Camera
          </button>
        </>
      )}

      {state === "denied" && (
        <>
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
          <h2 className="text-xl font-semibold mb-2">Camera Access Denied</h2>
          <p className="text-gray-400 mb-4 max-w-sm">
            Camera access was denied. To scan petitions:
          </p>
          <ol className="text-gray-400 text-left text-sm space-y-1 mb-6 max-w-sm">
            <li>1. Open your browser settings</li>
            <li>2. Find permissions for this site</li>
            <li>3. Enable camera access</li>
            <li>4. Refresh this page</li>
          </ol>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
          >
            Refresh Page
          </button>
        </>
      )}

      {state === "unsupported" && (
        <>
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
          <h2 className="text-xl font-semibold mb-2">Camera Not Supported</h2>
          <p className="text-gray-400 max-w-sm">
            Your browser doesn&apos;t support camera access. Try using Chrome,
            Safari, or Firefox on a mobile device.
          </p>
        </>
      )}
    </div>
  );
}
