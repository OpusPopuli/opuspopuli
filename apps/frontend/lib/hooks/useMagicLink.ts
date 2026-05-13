"use client";

import { useState, useCallback } from "react";
import { useMutation } from "@apollo/client/react";

import {
  SEND_MAGIC_LINK,
  VERIFY_MAGIC_LINK,
  REGISTER_WITH_MAGIC_LINK,
  SendMagicLinkData,
  VerifyMagicLinkData,
  RegisterWithMagicLinkData,
  AuthTokens,
} from "@/lib/graphql/auth";

interface UseMagicLinkResult {
  // State
  isLoading: boolean;
  error: string | null;
  emailSent: boolean;

  // Actions
  sendMagicLink: (email: string, redirectTo?: string) => Promise<boolean>;
  verifyMagicLink: (email: string, token: string) => Promise<AuthTokens | null>;
  registerWithMagicLink: (
    email: string,
    redirectTo?: string,
  ) => Promise<boolean>;
  clearError: () => void;
  resetEmailSent: () => void;
}

export function useMagicLink(): UseMagicLinkResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  // GraphQL mutations
  const [sendMagicLinkMutation] =
    useMutation<SendMagicLinkData>(SEND_MAGIC_LINK);
  const [verifyMagicLinkMutation] =
    useMutation<VerifyMagicLinkData>(VERIFY_MAGIC_LINK);
  const [registerWithMagicLinkMutation] =
    useMutation<RegisterWithMagicLinkData>(REGISTER_WITH_MAGIC_LINK);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const resetEmailSent = useCallback(() => {
    setEmailSent(false);
  }, []);

  /**
   * Send a magic link email for login
   */
  const sendMagicLink = useCallback(
    async (email: string, redirectTo?: string): Promise<boolean> => {
      setIsLoading(true);
      setError(null);
      setEmailSent(false);

      try {
        const { data } = await sendMagicLinkMutation({
          variables: { input: { email, redirectTo } },
        });

        if (!data?.sendMagicLink) {
          throw new Error("Failed to send magic link");
        }

        setEmailSent(true);
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to send magic link";
        setError(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [sendMagicLinkMutation],
  );

  /**
   * Verify a magic link token and get auth tokens
   */
  const verifyMagicLink = useCallback(
    async (email: string, token: string): Promise<AuthTokens | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const { data } = await verifyMagicLinkMutation({
          variables: { input: { email, token } },
        });

        const tokens = data?.verifyMagicLink;

        if (!tokens) {
          throw new Error("Invalid or expired magic link");
        }

        return tokens;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to verify magic link";
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [verifyMagicLinkMutation],
  );

  /**
   * Register a new user with magic link (email-first flow)
   */
  const registerWithMagicLink = useCallback(
    async (email: string, redirectTo?: string): Promise<boolean> => {
      setIsLoading(true);
      setError(null);
      setEmailSent(false);

      try {
        const { data } = await registerWithMagicLinkMutation({
          variables: { input: { email, redirectTo } },
        });

        if (!data?.registerWithMagicLink) {
          throw new Error("Failed to send registration link");
        }

        setEmailSent(true);
        return true;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to send registration link";
        setError(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [registerWithMagicLinkMutation],
  );

  return {
    isLoading,
    error,
    emailSent,
    sendMagicLink,
    verifyMagicLink,
    registerWithMagicLink,
    clearError,
    resetEmailSent,
  };
}
