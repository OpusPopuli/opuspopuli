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
      <p className="text-[#555555]">{subtitle}</p>
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
        className="block text-xs font-semibold text-[#555555] uppercase tracking-wider mb-2"
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

/* ── Divider ("or") ─────────────────────────────────────── */

export function AuthDivider() {
  return (
    <div className="my-8 flex items-center">
      <div className="flex-1 border-t border-[#DDDDDD]" />
      <span className="px-4 text-sm text-[#555555]">or</span>
      <div className="flex-1 border-t border-[#DDDDDD]" />
    </div>
  );
}
