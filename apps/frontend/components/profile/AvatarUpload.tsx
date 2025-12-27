"use client";

import { useState, useRef, useCallback } from "react";
import { useLazyQuery, useMutation } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import Image from "next/image";
import {
  GET_AVATAR_UPLOAD_URL,
  UPDATE_AVATAR_STORAGE_KEY,
  type AvatarUploadUrlData,
  type UpdateAvatarStorageKeyData,
} from "@/lib/graphql/profile";

interface AvatarUploadProps {
  readonly currentAvatarUrl?: string;
  readonly onAvatarUpdated?: (newUrl: string) => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function AvatarUpload({
  currentAvatarUrl,
  onAvatarUpdated,
}: AvatarUploadProps) {
  const { t } = useTranslation("settings");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [getUploadUrl] = useLazyQuery<AvatarUploadUrlData>(
    GET_AVATAR_UPLOAD_URL,
  );

  const [updateStorageKey] = useMutation<UpdateAvatarStorageKeyData>(
    UPDATE_AVATAR_STORAGE_KEY,
  );

  const validateFile = useCallback(
    (file: File): string | null => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        return t(
          "profile.avatar.errorInvalidType",
          "Please select a JPEG, PNG, or WebP image",
        );
      }
      if (file.size > MAX_FILE_SIZE) {
        return t("profile.avatar.errorTooLarge", "Image must be less than 5MB");
      }
      return null;
    },
    [t],
  );

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setError(null);

      // Validate file
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      // Show preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewUrl(e.target?.result as string);
      };
      reader.readAsDataURL(file);

      // Upload file
      setIsUploading(true);
      try {
        // Get presigned upload URL
        const { data: urlData, error: urlError } = await getUploadUrl({
          variables: { filename: file.name },
        });

        if (urlError || !urlData?.avatarUploadUrl) {
          throw new Error(
            t("profile.avatar.errorUploadUrl", "Failed to get upload URL"),
          );
        }

        // Upload to storage
        const uploadResponse = await fetch(urlData.avatarUploadUrl, {
          method: "PUT",
          body: file,
          headers: {
            "Content-Type": file.type,
          },
        });

        if (!uploadResponse.ok) {
          throw new Error(
            t("profile.avatar.errorUpload", "Failed to upload image"),
          );
        }

        // Extract storage key from URL path
        const url = new URL(urlData.avatarUploadUrl);
        const pathParts = url.pathname.split("/");
        const storageKey = pathParts.slice(-2).join("/"); // avatars/userId/filename

        // Update profile with storage key
        const { data: updateData } = await updateStorageKey({
          variables: { storageKey },
        });

        if (!updateData?.updateAvatarStorageKey) {
          throw new Error(
            t("profile.avatar.errorSave", "Failed to save avatar"),
          );
        }

        // Notify parent of new avatar URL
        if (onAvatarUpdated && updateData.updateAvatarStorageKey.avatarUrl) {
          onAvatarUpdated(updateData.updateAvatarStorageKey.avatarUrl);
        }

        setPreviewUrl(null);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t("profile.avatar.errorGeneric", "An error occurred"),
        );
        setPreviewUrl(null);
      } finally {
        setIsUploading(false);
        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [getUploadUrl, updateStorageKey, validateFile, onAvatarUpdated, t],
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const displayUrl = previewUrl || currentAvatarUrl;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Avatar Display */}
      <button
        type="button"
        onClick={handleClick}
        disabled={isUploading}
        className="relative group w-24 h-24 rounded-full overflow-hidden bg-gray-100 border-2 border-gray-200 hover:border-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={t("profile.avatar.change", "Change profile photo")}
      >
        {displayUrl ? (
          <Image
            src={displayUrl}
            alt={t("profile.avatar.alt", "Profile photo")}
            className="w-full h-full object-cover"
            width={96}
            height={96}
            unoptimized
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-200">
            <svg
              className="w-10 h-10 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </div>
        )}

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          {isUploading ? (
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          )}
        </div>
      </button>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        onChange={handleFileSelect}
        className="sr-only"
        aria-label={t("profile.avatar.upload", "Upload profile photo")}
      />

      {/* Upload Label */}
      <p className="text-sm text-[#64748b]">
        {t("profile.avatar.hint", "Click to upload a photo")}
      </p>

      {/* Error Message */}
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
