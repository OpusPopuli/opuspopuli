"use client";

import type { LightingLevel } from "@/lib/hooks/useLightingAnalysis";

interface LightingFeedbackProps {
  level: LightingLevel;
}

const FEEDBACK: Record<
  LightingLevel,
  { label: string; color: string; icon: string }
> = {
  dark: {
    label: "Move to a brighter area",
    color: "bg-yellow-600",
    icon: "M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z",
  },
  good: {
    label: "Good lighting",
    color: "bg-green-600",
    icon: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  bright: {
    label: "Too bright — find shade",
    color: "bg-orange-600",
    icon: "M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z",
  },
};

export function LightingFeedback({ level }: LightingFeedbackProps) {
  const feedback = FEEDBACK[level];

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
      <div
        className={`${feedback.color} text-white px-3 py-1.5 rounded-full flex items-center gap-2 text-sm font-medium shadow-lg transition-colors duration-300`}
      >
        <svg
          className="w-4 h-4 shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d={feedback.icon}
          />
        </svg>
        <span>{feedback.label}</span>
      </div>
    </div>
  );
}
