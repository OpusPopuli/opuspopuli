"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_MY_SENSITIVE_PROFILE,
  GET_MY_SIGNAL_PROFILE,
  SET_MY_NO_FIELDS_MODE,
  UPDATE_MY_SENSITIVE_PROFILE,
  UPDATE_MY_SIGNAL_PROFILE,
  type MySensitiveProfileData,
  type MySignalProfileData,
  type SetMyNoFieldsModeData,
  type UpdateMySensitiveProfileData,
  type UpdateMySignalProfileData,
} from "@/lib/graphql/personalization";
import { ALL_FIELDS, type FieldDescriptor } from "@/lib/personalization/vocab";
import {
  getCategoryPresentations,
  partitionByTier,
} from "@/lib/personalization/categories";
import { CategorySection } from "./CategorySection";
import { NoFieldsModePanel } from "./NoFieldsModePanel";
import {
  BehavioralSignalsPlaceholder,
  EventLogPlaceholder,
  RelevanceWeightsPlaceholder,
} from "./Placeholders";

const FIELD_BY_NAME: Record<string, FieldDescriptor> = ALL_FIELDS.reduce(
  (acc, f) => {
    acc[f.name] = f;
    return acc;
  },
  {} as Record<string, FieldDescriptor>,
);

function isArrayType(d: FieldDescriptor): boolean {
  return (
    d.inputType === "multi-select-chips" || d.inputType === "multi-tag-input"
  );
}

function clearedValueFor(d: FieldDescriptor): unknown {
  return isArrayType(d) ? [] : null;
}

export function ModelOfMePage() {
  const { t } = useTranslation("profile");
  const signalQuery = useQuery<MySignalProfileData>(GET_MY_SIGNAL_PROFILE, {
    fetchPolicy: "cache-and-network",
  });
  const sensitiveQuery = useQuery<MySensitiveProfileData>(
    GET_MY_SENSITIVE_PROFILE,
    { fetchPolicy: "cache-and-network" },
  );

  const [updateSignal] = useMutation<UpdateMySignalProfileData>(
    UPDATE_MY_SIGNAL_PROFILE,
  );
  // SensitiveProfile has no `id` field — Apollo can't normalize the
  // mutation result into the `mySensitiveProfile` query cache by
  // itself. Write the mutation result back into the query cache
  // explicitly so the page re-renders with the new value (used by the
  // no-fields-mode toggle + any T3 field edit).
  const [updateSensitive] = useMutation<UpdateMySensitiveProfileData>(
    UPDATE_MY_SENSITIVE_PROFILE,
    {
      update: (cache, { data }) => {
        if (!data) return;
        cache.writeQuery({
          query: GET_MY_SENSITIVE_PROFILE,
          data: { mySensitiveProfile: data.updateMySensitiveProfile },
        });
      },
    },
  );
  const [setNoFieldsMode, { loading: togglingNoFields }] =
    useMutation<SetMyNoFieldsModeData>(SET_MY_NO_FIELDS_MODE, {
      update: (cache, { data }) => {
        if (!data) return;
        cache.writeQuery({
          query: GET_MY_SENSITIVE_PROFILE,
          data: { mySensitiveProfile: data.setMyNoFieldsMode },
        });
      },
    });

  const signal = signalQuery.data?.mySignalProfile ?? null;
  const sensitive = sensitiveQuery.data?.mySensitiveProfile ?? null;
  const noFieldsMode = sensitive?.noFieldsMode ?? false;
  // Both queries kick off in parallel; show the skeleton until at
  // least the first network resolve so we don't render a page full
  // of "Not set" placeholders to a user who actually has data.
  const showSkeleton =
    (signalQuery.loading && !signal) || (sensitiveQuery.loading && !sensitive);
  const queryError = signalQuery.error ?? sensitiveQuery.error;

  const getCurrentValue = useCallback(
    (name: string): unknown => {
      const descriptor = FIELD_BY_NAME[name];
      if (!descriptor) return undefined;
      if (descriptor.profile === "signal") {
        return (signal as Record<string, unknown> | null)?.[name];
      }
      return (sensitive as Record<string, unknown> | null)?.[name];
    },
    [signal, sensitive],
  );

  const handleSaveField = useCallback(
    async (name: string, value: unknown) => {
      const descriptor = FIELD_BY_NAME[name];
      if (!descriptor) return;
      const input = { [name]: value } as Record<string, unknown>;
      if (descriptor.profile === "signal") {
        await updateSignal({ variables: { input } });
      } else {
        await updateSensitive({ variables: { input } });
      }
    },
    [updateSignal, updateSensitive],
  );

  const handleClearField = useCallback(
    async (name: string) => {
      const descriptor = FIELD_BY_NAME[name];
      if (!descriptor) return;
      const input = { [name]: clearedValueFor(descriptor) } as Record<
        string,
        unknown
      >;
      if (descriptor.profile === "signal") {
        await updateSignal({ variables: { input } });
      } else {
        await updateSensitive({ variables: { input } });
      }
    },
    [updateSignal, updateSensitive],
  );

  const handleToggleNoFields = useCallback(
    async (next: boolean) => {
      await setNoFieldsMode({ variables: { on: next } });
    },
    [setNoFieldsMode],
  );

  const { nonSensitive, sensitive: sensitiveCats } = useMemo(
    () => partitionByTier(getCategoryPresentations()),
    [],
  );

  if (showSkeleton) {
    return (
      <main className="max-w-3xl mx-auto space-y-6">
        <div className="space-y-3 animate-pulse">
          <div className="h-8 w-2/3 bg-surface-sunk rounded" />
          <div className="h-4 w-full bg-surface-sunk rounded" />
          <div className="h-4 w-1/2 bg-surface-sunk rounded" />
        </div>
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse h-16 bg-surface-alt rounded-lg border border-line"
            />
          ))}
        </div>
      </main>
    );
  }

  if (queryError) {
    return (
      <main className="max-w-3xl mx-auto py-12 text-center">
        <p role="alert" className="text-base text-red-700">
          {t("field.errorPrefix")} {queryError.message}
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-content">{t("page.title")}</h1>
        <p className="text-base text-content mt-3">{t("page.subtitle")}</p>
        <p className="text-sm text-content-dim mt-2 italic">
          {t("page.ownYouCallout")}
        </p>
      </header>

      <div className="space-y-4">
        {nonSensitive.map((p) => (
          <CategorySection
            key={p.category}
            presentation={p}
            getCurrentValue={getCurrentValue}
            onSaveField={handleSaveField}
            onClearField={handleClearField}
          />
        ))}
      </div>

      <NoFieldsModePanel
        noFieldsMode={noFieldsMode}
        onToggle={handleToggleNoFields}
        loading={togglingNoFields}
      />

      <div className="space-y-4">
        {sensitiveCats.map((p) => (
          <CategorySection
            key={p.category}
            presentation={p}
            getCurrentValue={getCurrentValue}
            onSaveField={handleSaveField}
            onClearField={handleClearField}
            locked={noFieldsMode}
          />
        ))}
      </div>

      <div className="space-y-4">
        <BehavioralSignalsPlaceholder />
        <RelevanceWeightsPlaceholder />
        <EventLogPlaceholder />
      </div>
    </main>
  );
}
