"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import { ChipPicker } from "../ChipPicker";
import { StepFooter } from "../StepFooter";
import {
  GET_MY_SIGNAL_PROFILE,
  UPDATE_MY_SIGNAL_PROFILE,
  type MySignalProfileData,
  type SignalProfile,
  type UpdateMySignalProfileData,
  type UpdateSignalProfileInput,
} from "@/lib/graphql/personalization";

interface LifeContextStepProps {
  readonly onComplete: () => void;
  readonly isLastStep: boolean;
}

export interface LifeContextState {
  housing: string | null;
  family: readonly string[];
  workStatus: string | null;
  workExtras: readonly string[];
  education: readonly string[];
  transit: string | null;
}

const emptyState: LifeContextState = {
  housing: null,
  family: [],
  workStatus: null,
  workExtras: [],
  education: [],
  transit: null,
};

const isEmpty = (s: LifeContextState): boolean =>
  s.housing === null &&
  s.family.length === 0 &&
  s.workStatus === null &&
  s.workExtras.length === 0 &&
  s.education.length === 0 &&
  s.transit === null;

export const sameLifeContext = (
  a: LifeContextState,
  b: LifeContextState,
): boolean =>
  a.housing === b.housing &&
  a.workStatus === b.workStatus &&
  a.transit === b.transit &&
  a.family.length === b.family.length &&
  a.family.every((v) => b.family.includes(v)) &&
  a.workExtras.length === b.workExtras.length &&
  a.workExtras.every((v) => b.workExtras.includes(v)) &&
  a.education.length === b.education.length &&
  a.education.every((v) => b.education.includes(v));

// Inverse of `toSignalInput` for pre-populating the chips when a
// returning user re-enters onboarding. Booleans + lone string fields
// map back to chip selections; multi-select chip groups are rebuilt
// from the granular fields. Edge case: studentLevel may be any of
// K12/college/grad — we collapse all of them to the single
// "I'm a student" chip since onboarding only offers that one.
export function fromSignalProfile(sp: SignalProfile | null): LifeContextState {
  if (!sp) return emptyState;
  const family: string[] = [];
  if (sp.parentOfStudent && sp.parentOfStudent.length > 0)
    family.push("parent");
  if (sp.hasEldercareDependents) family.push("caregiver");
  const education: string[] = [];
  if (sp.studentLevel) education.push("student");
  if (sp.educator) education.push("educator");
  return {
    housing: sp.housingTenure ?? null,
    family,
    workStatus: sp.employmentStatus ?? null,
    workExtras: sp.unionMember ? ["union"] : [],
    education,
    transit: sp.primaryTransitMode ?? null,
  };
}

// Maps chip selections onto granular SignalProfile fields. Cross-service
// contract — the ranker's WHO_TO_FLAG table consumes the same fields.
// Keep this in lockstep with `scoring.service.ts` in the knowledge svc.
export function toSignalInput(
  state: LifeContextState,
): UpdateSignalProfileInput {
  const input: UpdateSignalProfileInput = {};
  if (state.housing) input.housingTenure = state.housing;
  if (state.family.includes("parent")) input.parentOfStudent = ["public"];
  if (state.family.includes("caregiver")) input.hasEldercareDependents = true;
  if (state.workStatus) input.employmentStatus = state.workStatus;
  if (state.workExtras.includes("union")) input.unionMember = true;
  // The chip says "I'm a student" — default to college since that's the
  // dominant adult-civic-platform user. Model-of-me edit page exposes
  // K12/grad granularity if the user wants it.
  if (state.education.includes("student")) input.studentLevel = "college";
  if (state.education.includes("educator")) input.educator = true;
  if (state.transit) input.primaryTransitMode = state.transit;
  return input;
}

export function LifeContextStep({
  onComplete,
  isLastStep,
}: LifeContextStepProps) {
  const { t } = useTranslation("onboarding");
  const [state, setState] = useState<LifeContextState>(emptyState);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill chips from the existing SignalProfile on retry.
  //
  // Caveat: studentLevel ∈ {K12, college, grad} collapses to the
  // single "I'm a student" chip; toSignalInput always writes
  // 'college'. So a returning K12 student who *edits* anything else
  // and re-saves would have studentLevel flipped to 'college'. The
  // common case — no edits — is protected by the skip-write-if-
  // unchanged guard in `submit()`. The full vocabulary lives in
  // #752's model-of-me edit page.
  const { data: signalData } = useQuery<MySignalProfileData>(
    GET_MY_SIGNAL_PROFILE,
    { fetchPolicy: "cache-and-network" },
  );
  const prefilledRef = useRef(false);
  const initialStateRef = useRef<LifeContextState | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot
     initialization from async query data; ref guard prevents
     re-runs. Standard pattern for hydrating form state from a
     useQuery result that resolves after mount. */
  useEffect(() => {
    const sp = signalData?.mySignalProfile;
    if (!sp || prefilledRef.current) return;
    prefilledRef.current = true;
    const initial = fromSignalProfile(sp);
    initialStateRef.current = initial;
    setState(initial);
  }, [signalData?.mySignalProfile]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const [updateSignal, { loading }] = useMutation<
    UpdateMySignalProfileData,
    { input: UpdateSignalProfileInput }
  >(UPDATE_MY_SIGNAL_PROFILE);

  const submit = async () => {
    if (isEmpty(state)) {
      onComplete();
      return;
    }
    // Skip-write-if-unchanged — onboarding-only "student" chip
    // collapses K12/college/grad to one option; without this guard a
    // returning K12 student would silently flip to 'college' on a
    // no-edit re-submit.
    const initial = initialStateRef.current;
    if (initial && sameLifeContext(initial, state)) {
      onComplete();
      return;
    }
    try {
      await updateSignal({ variables: { input: toSignalInput(state) } });
      onComplete();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : t("lifeContext.errors.saveFailed");
      setError(message);
    }
  };

  const setKey = <K extends keyof LifeContextState>(
    key: K,
    value: LifeContextState[K],
  ) => {
    setState((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  return (
    <div className="w-full max-w-lg">
      <h2 className="text-2xl font-bold mb-2 text-content">
        {t("lifeContext.title")}
      </h2>
      <p className="text-content-dim text-sm mb-6">
        {t("lifeContext.subtitle")}
      </p>

      <div className="space-y-5 max-h-[55vh] overflow-y-auto pr-1">
        <ChipPicker
          mode="single"
          groupLabel={t("lifeContext.groups.housing")}
          columns={2}
          selected={state.housing}
          onChange={(v) => setKey("housing", v)}
          options={[
            { value: "renter", label: t("lifeContext.chips.housing.renter") },
            { value: "owner", label: t("lifeContext.chips.housing.owner") },
          ]}
        />

        <ChipPicker
          mode="multi"
          groupLabel={t("lifeContext.groups.family")}
          columns={2}
          selected={state.family}
          onChange={(v) => setKey("family", v)}
          options={[
            { value: "parent", label: t("lifeContext.chips.family.parent") },
            {
              value: "caregiver",
              label: t("lifeContext.chips.family.caregiver"),
            },
          ]}
        />

        <ChipPicker
          mode="single"
          groupLabel={t("lifeContext.groups.work")}
          columns={3}
          selected={state.workStatus}
          onChange={(v) => setKey("workStatus", v)}
          options={[
            { value: "employed", label: t("lifeContext.chips.work.employed") },
            { value: "gig", label: t("lifeContext.chips.work.gig") },
            {
              value: "business_owner",
              label: t("lifeContext.chips.work.businessOwner"),
            },
          ]}
        />

        <ChipPicker
          mode="multi"
          groupLabel={t("lifeContext.groups.workExtras")}
          columns={2}
          selected={state.workExtras}
          onChange={(v) => setKey("workExtras", v)}
          options={[
            { value: "union", label: t("lifeContext.chips.workExtras.union") },
          ]}
        />

        <ChipPicker
          mode="multi"
          groupLabel={t("lifeContext.groups.education")}
          columns={2}
          selected={state.education}
          onChange={(v) => setKey("education", v)}
          options={[
            {
              value: "student",
              label: t("lifeContext.chips.education.student"),
            },
            {
              value: "educator",
              label: t("lifeContext.chips.education.educator"),
            },
          ]}
        />

        <ChipPicker
          mode="single"
          groupLabel={t("lifeContext.groups.transit")}
          columns={3}
          selected={state.transit}
          onChange={(v) => setKey("transit", v)}
          options={[
            { value: "transit", label: t("lifeContext.chips.transit.transit") },
            { value: "car", label: t("lifeContext.chips.transit.car") },
            { value: "active", label: t("lifeContext.chips.transit.active") },
          ]}
        />
      </div>

      {error && (
        <p role="alert" className="text-red-600 dark:text-red-400 text-sm pt-3">
          {error}
        </p>
      )}

      <StepFooter
        onSkip={() => {
          setState(emptyState);
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
