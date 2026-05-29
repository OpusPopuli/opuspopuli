"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import { StepFooter } from "../StepFooter";
import {
  GET_MY_SENSITIVE_PROFILE,
  UPDATE_MY_SENSITIVE_PROFILE,
  SET_MY_NO_FIELDS_MODE,
  type MySensitiveProfileData,
  type UpdateMySensitiveProfileData,
  type UpdateSensitiveProfileInput,
  type SetMyNoFieldsModeData,
} from "@/lib/graphql/personalization";

interface VeteranStepProps {
  readonly onComplete: () => void;
  readonly isLastStep: boolean;
}

export function VeteranStep({ onComplete, isLastStep }: VeteranStepProps) {
  const { t } = useTranslation("onboarding");
  const [isVeteran, setIsVeteran] = useState(false);
  const [noFieldsMode, setNoFieldsMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The initial server-side state is held in state (not refs) so we
  // can read it during render — required for the `veteranLocked`
  // derivation below — and for the "did this change?" diff in
  // submit() that drives the privacy-contract sync.
  const [initialNoFieldsMode, setInitialNoFieldsMode] = useState<
    boolean | null
  >(null);
  const [initialIsVeteran, setInitialIsVeteran] = useState<boolean | null>(
    null,
  );

  // Pre-populate from the existing SensitiveProfile state. When
  // noFieldsMode is on, the resolver returns only that flag and elides
  // every other field — that's the privacy contract — so we toggle the
  // switch but leave the veteran chip unchecked + disabled.
  const { data: sensitiveData } = useQuery<MySensitiveProfileData>(
    GET_MY_SENSITIVE_PROFILE,
    { fetchPolicy: "cache-and-network" },
  );
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot
     initialization from async query data; the initialNoFieldsMode
     guard prevents re-runs. Standard pattern for hydrating form
     state from a useQuery result that resolves after mount. */
  useEffect(() => {
    const sp = sensitiveData?.mySensitiveProfile;
    if (!sp || initialNoFieldsMode !== null) return;
    const wasVeteran = sp.veteranStatus === "veteran";
    setInitialNoFieldsMode(sp.noFieldsMode);
    setInitialIsVeteran(wasVeteran);
    if (sp.noFieldsMode) {
      setNoFieldsMode(true);
    } else if (wasVeteran) {
      setIsVeteran(true);
    }
  }, [sensitiveData?.mySensitiveProfile, initialNoFieldsMode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // We can flip OFF→ON for veteran here, but clearing a T3 field
  // (ON→OFF) requires fine-grained delete semantics the backend
  // doesn't expose yet — `clearMySensitiveProfile` wipes *all* T3
  // fields, which is wrong for a single-chip uncheck. The full
  // privacy edit story lives in #752's model-of-me page. So when the
  // veteran chip is already set from a prior visit, we render it
  // locked with a redirect note.
  const veteranLocked = initialIsVeteran === true;
  const veteranChipChecked = veteranLocked ? true : isVeteran;
  const veteranChipDisabled = noFieldsMode || veteranLocked;

  const [updateSensitive, { loading: updating }] = useMutation<
    UpdateMySensitiveProfileData,
    { input: UpdateSensitiveProfileInput }
  >(UPDATE_MY_SENSITIVE_PROFILE);

  const [setMode, { loading: toggling }] = useMutation<
    SetMyNoFieldsModeData,
    { on: boolean }
  >(SET_MY_NO_FIELDS_MODE);

  const loading = updating || toggling;

  const submit = async () => {
    try {
      // 1. Sync no-fields-mode in either direction if it changed since
      //    pre-fill. This is the privacy contract — UI and server
      //    must agree on the user's stated intent.
      const prevNoFields = initialNoFieldsMode ?? false;
      if (noFieldsMode !== prevNoFields) {
        await setMode({ variables: { on: noFieldsMode } });
      }
      // 2. Veteran chip can only transition OFF→ON in onboarding
      //    (see `veteranLocked` above). Skip the write when no
      //    transition happened — protects against re-writing the
      //    same value and against the over-write data-loss risk
      //    for any future T3 fields that flow through this path.
      const prevIsVeteran = initialIsVeteran ?? false;
      if (!noFieldsMode && isVeteran && !prevIsVeteran) {
        await updateSensitive({
          variables: { input: { veteranStatus: "veteran" } },
        });
      }
      onComplete();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : t("veteran.errors.saveFailed");
      setError(message);
    }
  };

  return (
    <div className="w-full max-w-md">
      <h2 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
        {t("veteran.title")}
      </h2>
      <p className="text-gray-600 dark:text-gray-300 text-sm mb-4">
        {t("veteran.subtitle")}
      </p>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-5 text-sm">
        <div className="flex items-center gap-2 mb-2 font-medium text-sage-darker dark:text-sage-light">
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
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          {t("veteran.disclosure.encryptedBadge")}
        </div>
        <p className="text-gray-600 dark:text-gray-300">
          {t("veteran.disclosure.whyWeAsk")}
        </p>
      </div>

      <label
        className={[
          "flex items-center justify-between gap-3",
          "px-4 py-3 rounded-xl border transition-colors",
          "focus-within:ring-2 focus-within:ring-sage-dark",
          veteranChipChecked && !noFieldsMode
            ? "bg-sage-dark text-white border-sage-dark"
            : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700",
          veteranChipDisabled
            ? "opacity-60 cursor-not-allowed"
            : "cursor-pointer",
        ].join(" ")}
      >
        <span className="font-medium">{t("veteran.chip")}</span>
        <input
          type="checkbox"
          checked={veteranChipChecked}
          disabled={veteranChipDisabled}
          onChange={(e) => {
            setIsVeteran(e.target.checked);
            setError(null);
          }}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
            veteranChipChecked && !noFieldsMode
              ? "border-white"
              : "border-gray-400 dark:border-gray-500"
          }`}
        >
          {veteranChipChecked && !noFieldsMode && (
            <svg
              className="w-3 h-3 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
        </span>
      </label>
      {veteranLocked && (
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1 px-1">
          {t("veteran.lockedNote")}
        </p>
      )}

      <label className="flex items-center justify-between gap-3 mt-3 px-1 cursor-pointer text-sm text-gray-600 dark:text-gray-300">
        <span>{t("veteran.noFieldsToggle")}</span>
        <input
          type="checkbox"
          checked={noFieldsMode}
          onChange={(e) => {
            setNoFieldsMode(e.target.checked);
            if (e.target.checked) setIsVeteran(false);
            setError(null);
          }}
          className="w-4 h-4 accent-sage-dark"
        />
      </label>

      {error && (
        <p role="alert" className="text-red-600 dark:text-red-400 text-sm pt-3">
          {error}
        </p>
      )}

      <StepFooter
        onSkip={() => {
          // Skip restores the form to the server-side state but does
          // NOT call submit — `submit()` is what propagates intent.
          setIsVeteran(initialIsVeteran ?? false);
          setNoFieldsMode(initialNoFieldsMode ?? false);
          setError(null);
          onComplete();
        }}
        onSubmit={submit}
        loading={loading}
        isLastStep={isLastStep}
      />
    </div>
  );
}
