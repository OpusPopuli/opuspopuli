"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import { ChipPicker, type ChipOption } from "../ChipPicker";
import { StepFooter } from "../StepFooter";
import {
  GET_MY_SIGNAL_PROFILE,
  UPDATE_MY_SIGNAL_PROFILE,
  type MySignalProfileData,
  type UpdateMySignalProfileData,
  type UpdateSignalProfileInput,
} from "@/lib/graphql/personalization";

const sameStringSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
};

interface TopicsStepProps {
  readonly onComplete: () => void;
  readonly isLastStep: boolean;
}

// Focus is the whole point of personalized civics — citizens engage
// meaningfully with a small number of issues, not a list of all 12.
// Hard-cap at 3 here so the onboarding signals priority, not breadth.
// Users can broaden later from the model-of-me settings (#752).
//
// Rationale + copy live in the "Why just 3?" explainer card below and
// in planning doc §1.2 (civic-attention finite-resource framing). If
// you change this number, update the i18n `topics.subtitle` and
// `topics.reasonBody` keys too.
const MAX_TOPICS = 3;

// Canonical topic slugs map to `SignalProfile.interestTags` (free-form
// string[]). When the shared `@opuspopuli/personalization-vocab` package
// (#762) lands, these slugs move there so backend ranker + frontend
// chip vocab stay in lockstep.
const TOPIC_KEYS = [
  "housing",
  "jobs",
  "healthcare",
  "education",
  "transit",
  "environment",
  "public_safety",
  "taxes",
  "immigration",
  "voting_rights",
  "justice",
  "family",
] as const;

export function TopicsStep({ onComplete, isLastStep }: TopicsStepProps) {
  const { t } = useTranslation("onboarding");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from existing SignalProfile.interestTags when the user
  // re-enters onboarding. Cap at MAX_TOPICS so a previously-stored
  // larger set still fits the new contract (focus over breadth).
  //
  // Caveat: if a future user (after #752 model-of-me ships) has >3
  // stored tags and edits the chips here, the trimmed selection
  // replaces the full set on save. We mitigate the common case
  // (no-change re-submit) with the skip-write-if-unchanged guard in
  // `submit()`; the destructive-edit case will be addressed when
  // #752 lands a "broaden" UI.
  const { data: signalData } = useQuery<MySignalProfileData>(
    GET_MY_SIGNAL_PROFILE,
    { fetchPolicy: "cache-and-network" },
  );
  const prefilledRef = useRef(false);
  const initialSelectedRef = useRef<readonly string[] | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot
     initialization from async query data; ref guard prevents
     re-runs. Standard pattern for hydrating form state from a
     useQuery result that resolves after mount. */
  useEffect(() => {
    const existing = signalData?.mySignalProfile?.interestTags;
    if (!existing || existing.length === 0 || prefilledRef.current) return;
    prefilledRef.current = true;
    const trimmed = existing.slice(0, MAX_TOPICS);
    initialSelectedRef.current = trimmed;
    setSelected(trimmed);
  }, [signalData?.mySignalProfile?.interestTags]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const [updateSignal, { loading }] = useMutation<
    UpdateMySignalProfileData,
    { input: UpdateSignalProfileInput }
  >(UPDATE_MY_SIGNAL_PROFILE);

  const options: ChipOption[] = TOPIC_KEYS.map((key) => ({
    value: key,
    label: t(`topics.options.${key}`),
  }));

  const submit = async () => {
    if (selected.length === 0) {
      onComplete();
      return;
    }
    // Skip-write-if-unchanged — protect against silent over-3
    // truncation when a returning user with more tags just clicks
    // through without editing.
    const initial = initialSelectedRef.current;
    if (initial && sameStringSet(initial, selected)) {
      onComplete();
      return;
    }
    try {
      await updateSignal({
        variables: { input: { interestTags: [...selected] } },
      });
      onComplete();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : t("topics.errors.saveFailed");
      setError(message);
    }
  };

  return (
    <div className="w-full max-w-md text-white">
      <h2 className="text-2xl font-bold mb-2">{t("topics.title")}</h2>
      <p className="text-white/80 text-sm mb-3">{t("topics.subtitle")}</p>
      <div className="bg-white/5 border border-white/10 rounded-lg p-3 mb-3 text-xs text-white/70">
        <span className="font-medium text-white/85">
          {t("topics.reasonHeading")}{" "}
        </span>
        {t("topics.reasonBody")}
      </div>
      <p aria-live="polite" className="text-white/60 text-xs mb-5">
        {t("topics.counter", { count: selected.length, max: MAX_TOPICS })}
      </p>

      <ChipPicker
        mode="multi"
        groupLabel={t("topics.groupLabel")}
        options={options}
        selected={selected}
        columns={3}
        maxSelections={MAX_TOPICS}
        onChange={(values) => {
          setSelected(values);
          setError(null);
        }}
      />

      {error && (
        <p role="alert" className="text-red-200 text-sm pt-3">
          {error}
        </p>
      )}

      <StepFooter
        onSkip={() => {
          setSelected([]);
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
