"use client";

import { useState } from "react";

interface UseSettingsFormResult {
  saveSuccess: boolean;
  saveError: string | null;
  hasChanges: boolean;
  markChanged: () => void;
  handleSuccess: () => void;
  handleError: (err: unknown, fallback?: string) => void;
  clearStatus: () => void;
}

/**
 * Shared form state for settings pages (notifications, privacy, addresses).
 * Tracks dirty/clean state, success feedback, and error messages in one place
 * so each settings page doesn't duplicate the same useState quartet.
 */
export function useSettingsForm(): UseSettingsFormResult {
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const markChanged = () => {
    setHasChanges(true);
    setSaveSuccess(false);
    setSaveError(null);
  };

  const handleSuccess = () => {
    setSaveSuccess(true);
    setHasChanges(false);
    setSaveError(null);
  };

  const handleError = (err: unknown, fallback = "Failed to save changes.") => {
    setSaveError(err instanceof Error ? err.message : fallback);
  };

  const clearStatus = () => {
    setSaveSuccess(false);
    setSaveError(null);
  };

  return {
    saveSuccess,
    saveError,
    hasChanges,
    markChanged,
    handleSuccess,
    handleError,
    clearStatus,
  };
}
