"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";

interface UseWebAuthnRegistrationResult {
  success: boolean;
  isLoading: boolean;
  error: string | null;
  register: (email: string, friendlyName?: string) => Promise<void>;
  clearError: () => void;
}

/**
 * Encapsulates the passkey registration flow shared between the
 * auth/callback prompt and the register/add-passkey page.
 *
 * Callers should check `supportsPasskeys` from `useAuth` before
 * rendering a UI that calls `register`.
 */
export function useWebAuthnRegistration(): UseWebAuthnRegistrationResult {
  const { registerPasskey, isLoading, error, clearError } = useAuth();
  const [success, setSuccess] = useState(false);

  const register = async (email: string, friendlyName?: string) => {
    clearError();
    const result = await registerPasskey(email, friendlyName || undefined);
    if (result) {
      setSuccess(true);
    }
  };

  return { success, isLoading, error, register, clearError };
}
