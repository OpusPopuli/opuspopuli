"use client";

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface ProfileVisibilityToggleProps {
  readonly isPublic: boolean;
  readonly onChange: (isPublic: boolean) => void;
  readonly disabled?: boolean;
}

export function ProfileVisibilityToggle({
  isPublic,
  onChange,
  disabled = false,
}: ProfileVisibilityToggleProps) {
  const { t } = useTranslation("settings");
  const [showTooltip, setShowTooltip] = useState(false);

  const handleToggle = useCallback(() => {
    if (!disabled) {
      onChange(!isPublic);
    }
  }, [isPublic, onChange, disabled]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleToggle();
      }
    },
    [handleToggle],
  );

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-[#1e293b]">
          {t("profile.visibility.label", "Profile Visibility")}
        </span>

        {/* Info Tooltip */}
        <div className="relative">
          <button
            type="button"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onFocus={() => setShowTooltip(true)}
            onBlur={() => setShowTooltip(false)}
            className="text-gray-400 hover:text-gray-600 focus:outline-none focus:text-gray-600"
            aria-label={t(
              "profile.visibility.infoLabel",
              "Visibility information",
            )}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>

          {showTooltip && (
            <div
              role="tooltip"
              className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-10"
            >
              <p>
                {t(
                  "profile.visibility.hint",
                  "Public profiles can be discovered by other users. Private profiles are only visible to you.",
                )}
              </p>
              <div className="absolute left-3 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Status Label */}
        <span
          className={`text-sm ${isPublic ? "text-green-600" : "text-gray-500"}`}
        >
          {isPublic
            ? t("profile.visibility.public", "Public")
            : t("profile.visibility.private", "Private")}
        </span>

        {/* Toggle Switch */}
        <button
          type="button"
          role="switch"
          aria-checked={isPublic}
          onClick={handleToggle}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className={`
            relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full
            border-2 border-transparent transition-colors duration-200 ease-in-out
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
            ${isPublic ? "bg-green-500" : "bg-gray-300"}
            ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          `}
        >
          <span className="sr-only">
            {t("profile.visibility.toggle", "Toggle profile visibility")}
          </span>
          <span
            aria-hidden="true"
            className={`
              pointer-events-none inline-block h-5 w-5 transform rounded-full
              bg-white shadow ring-0 transition duration-200 ease-in-out
              ${isPublic ? "translate-x-5" : "translate-x-0"}
            `}
          >
            {/* Icon inside toggle */}
            {isPublic ? (
              <svg
                className="absolute inset-0 h-full w-full p-1 text-green-500"
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
            ) : (
              <svg
                className="absolute inset-0 h-full w-full p-1 text-gray-400"
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
            )}
          </span>
        </button>
      </div>
    </div>
  );
}
