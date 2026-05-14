"use client";

import { ReactNode } from "react";
import { LoadingSpinner } from "@/components/LoadingSpinner";

/* ── Card wrapper ───────────────────────────────────────── */

export function AuthCard({
  children,
  className = "",
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <div
      className={`bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8 ${className}`}
    >
      {children}
    </div>
  );
}

/* ── Page header (title + subtitle) ─────────────────────── */

export function AuthHeader({
  title,
  subtitle,
}: Readonly<{ title: string; subtitle: string }>) {
  return (
    <div className="text-center mb-8">
      <h1 className="text-2xl font-bold text-[#222222] mb-2">{title}</h1>
      <p className="text-[#4d4d4d]">{subtitle}</p>
    </div>
  );
}

/* ── Error alert ────────────────────────────────────────── */

export function AuthErrorAlert({
  error,
}: Readonly<{ error: string | null | undefined }>) {
  if (!error) return null;
  return (
    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
      <p className="text-sm text-red-600">{error}</p>
    </div>
  );
}

/* ── Styled input with label ────────────────────────────── */

interface AuthInputProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
  className?: string;
}

export function AuthInput({
  id,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
  autoComplete,
  autoFocus,
  className = "",
}: Readonly<AuthInputProps>) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-semibold text-[#4d4d4d] uppercase tracking-wider mb-2"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-4 py-3 bg-[#FFFFFF] border border-[#DDDDDD] rounded-lg
                   text-[#222222] placeholder-[#888888]
                   focus:outline-none focus:ring-2 focus:ring-[#222222] focus:border-transparent
                   transition-all duration-200 ${className}`}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
      />
    </div>
  );
}

/* ── Primary submit button with loading state ───────────── */

interface AuthSubmitButtonProps {
  disabled?: boolean;
  loading?: boolean;
  loadingText: string;
  children: ReactNode;
  type?: "submit" | "button";
  onClick?: () => void;
  className?: string;
}

export function AuthSubmitButton({
  disabled,
  loading,
  loadingText,
  children,
  type = "submit",
  onClick,
  className = "",
}: Readonly<AuthSubmitButtonProps>) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`w-full py-3 px-4 bg-[#222222] text-white font-semibold rounded-lg
               hover:bg-[#333333] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#222222]
               disabled:opacity-50 disabled:cursor-not-allowed
               transition-all duration-200 flex items-center justify-center gap-2 ${className}`}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <LoadingSpinner />
          {loadingText}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

/* ── Password input with show/hide toggle ───────────────── */

interface PasswordInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  showPassword: boolean;
  onToggleShow: () => void;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  ariaLabel?: string;
}

/**
 * Password input with a show/hide toggle button. Shared by login/page.tsx
 * and reset-password/page.tsx to eliminate the duplicated input+toggle block.
 */
export function PasswordInput({
  id,
  label,
  value,
  onChange,
  showPassword,
  onToggleShow,
  placeholder = "Enter your password",
  required,
  autoComplete = "current-password",
  ariaLabel,
}: Readonly<PasswordInputProps>) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-semibold text-[#4d4d4d] uppercase tracking-wider mb-2"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={showPassword ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3 bg-[#FFFFFF] border border-[#DDDDDD] rounded-lg
                   text-[#222222] placeholder-[#888888]
                   focus:outline-none focus:ring-2 focus:ring-[#222222] focus:border-transparent
                   transition-all duration-200 pr-12"
          placeholder={placeholder}
          required={required}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          onClick={onToggleShow}
          aria-label={
            ariaLabel || (showPassword ? "Hide password" : "Show password")
          }
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4d4d4d] hover:text-[#222222] transition-colors"
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
  );
}

/* ── Green checkmark icon used in success states ────────── */

export function AuthCheckIcon() {
  return (
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
  );
}

/* ── Divider ("or") ─────────────────────────────────────── */

export function AuthDivider() {
  return (
    <div className="my-8 flex items-center">
      <div className="flex-1 border-t border-[#DDDDDD]" />
      <span className="px-4 text-sm text-[#4d4d4d]">or</span>
      <div className="flex-1 border-t border-[#DDDDDD]" />
    </div>
  );
}
