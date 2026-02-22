"use client";

import Link from "next/link";

export default function PetitionPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center text-white">
      <svg
        className="w-20 h-20 mb-6 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
        />
      </svg>
      <h1 className="text-2xl font-bold mb-3">Scan a Petition</h1>
      <p className="text-gray-400 mb-8 max-w-sm">
        Use your camera to capture petition pages. Images are processed securely
        and never stored on your device.
      </p>
      <Link
        href="/petition/capture"
        className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
      >
        Start Scanning
      </Link>
      <Link
        href="/petition/map"
        className="mt-4 px-8 py-3 border border-gray-600 hover:border-gray-400 text-gray-300 font-medium rounded-lg transition-colors"
      >
        View Map
      </Link>
      <Link
        href="/"
        className="mt-4 text-sm text-gray-400 hover:text-gray-300 transition-colors"
      >
        Back to Home
      </Link>
    </div>
  );
}
