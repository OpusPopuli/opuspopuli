"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_MY_NOTIFICATION_PREFERENCES,
  UPDATE_NOTIFICATION_PREFERENCES,
  UNSUBSCRIBE_FROM_ALL,
  MyNotificationPreferencesData,
  UpdateNotificationPreferencesData,
  UnsubscribeFromAllData,
  UpdateNotificationPreferencesInput,
  NotificationFrequency,
  NotificationPreferences,
} from "@/lib/graphql/profile";

interface ToggleProps {
  readonly enabled: boolean;
  readonly onChange: (enabled: boolean) => void;
  readonly disabled?: boolean;
}

function Toggle({ enabled, onChange, disabled }: Readonly<ToggleProps>) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#222222] focus:ring-offset-2 ${
        enabled ? "bg-[#222222]" : "bg-gray-200"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

const FREQUENCY_OPTIONS: { value: NotificationFrequency; labelKey: string }[] =
  [
    { value: "immediate", labelKey: "notifications.frequency.immediate" },
    { value: "daily_digest", labelKey: "notifications.frequency.daily_digest" },
    {
      value: "weekly_digest",
      labelKey: "notifications.frequency.weekly_digest",
    },
    { value: "never", labelKey: "notifications.frequency.never" },
  ];

interface NotificationFormProps {
  readonly preferences: NotificationPreferences;
  readonly onSave: () => void;
  readonly onUnsubscribeAll: () => Promise<void>;
  readonly unsubscribing: boolean;
}

function NotificationForm({
  preferences,
  onSave,
  onUnsubscribeAll,
  unsubscribing,
}: Readonly<NotificationFormProps>) {
  const { t } = useTranslation("settings");
  const [updatePreferences, { loading: updating }] =
    useMutation<UpdateNotificationPreferencesData>(
      UPDATE_NOTIFICATION_PREFERENCES,
    );

  const [prefs, setPrefs] = useState<UpdateNotificationPreferencesInput>({
    emailEnabled: preferences.emailEnabled,
    emailProductUpdates: preferences.emailProductUpdates,
    emailSecurityAlerts: preferences.emailSecurityAlerts,
    emailMarketing: preferences.emailMarketing,
    emailFrequency: preferences.emailFrequency,
    pushEnabled: preferences.pushEnabled,
    pushProductUpdates: preferences.pushProductUpdates,
    pushSecurityAlerts: preferences.pushSecurityAlerts,
    pushMarketing: preferences.pushMarketing,
    smsEnabled: preferences.smsEnabled,
    smsSecurityAlerts: preferences.smsSecurityAlerts,
    smsMarketing: preferences.smsMarketing,
    civicElectionReminders: preferences.civicElectionReminders,
    civicVoterDeadlines: preferences.civicVoterDeadlines,
    civicBallotUpdates: preferences.civicBallotUpdates,
    civicLocalNews: preferences.civicLocalNews,
    civicRepresentativeUpdates: preferences.civicRepresentativeUpdates,
    civicFrequency: preferences.civicFrequency,
    quietHoursEnabled: preferences.quietHoursEnabled,
    quietHoursStart: preferences.quietHoursStart || "",
    quietHoursEnd: preferences.quietHoursEnd || "",
  });
  const [hasChanges, setHasChanges] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const updatePref = <K extends keyof UpdateNotificationPreferencesInput>(
    key: K,
    value: UpdateNotificationPreferencesInput[K],
  ) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
    setSaveSuccess(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    setSaveError(null);
    try {
      await updatePreferences({ variables: { input: prefs } });
      setSaveSuccess(true);
      setHasChanges(false);
      onSave();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : t("common:errors.saveFailed"),
      );
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#222222]">
            {t("notifications.title")}
          </h1>
          <p className="text-[#555555] mt-1">{t("notifications.subtitle")}</p>
        </div>
        <button
          onClick={onUnsubscribeAll}
          disabled={unsubscribing}
          className="text-sm text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
        >
          {t("notifications.unsubscribeAll")}
        </button>
      </div>

      {saveSuccess && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-600">
            {t("notifications.saveSuccess")}
          </p>
        </div>
      )}

      {saveError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{saveError}</p>
        </div>
      )}

      {/* Email Notifications */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#222222]">
            {t("notifications.email.title")}
          </h2>
          <Toggle
            enabled={prefs.emailEnabled ?? true}
            onChange={(v) => updatePref("emailEnabled", v)}
          />
        </div>
        <div className="space-y-4 pl-4 border-l-2 border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#222222]">
                {t("notifications.email.productUpdates")}
              </p>
              <p className="text-sm text-[#555555]">
                {t("notifications.email.productUpdatesDesc")}
              </p>
            </div>
            <Toggle
              enabled={prefs.emailProductUpdates ?? true}
              onChange={(v) => updatePref("emailProductUpdates", v)}
              disabled={!prefs.emailEnabled}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#222222]">
                {t("notifications.email.securityAlerts")}
              </p>
              <p className="text-sm text-[#555555]">
                {t("notifications.email.securityAlertsDesc")}
              </p>
            </div>
            <Toggle
              enabled={prefs.emailSecurityAlerts ?? true}
              onChange={(v) => updatePref("emailSecurityAlerts", v)}
              disabled={!prefs.emailEnabled}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#222222]">
                {t("notifications.email.marketing")}
              </p>
              <p className="text-sm text-[#555555]">
                {t("notifications.email.marketingDesc")}
              </p>
            </div>
            <Toggle
              enabled={prefs.emailMarketing ?? false}
              onChange={(v) => updatePref("emailMarketing", v)}
              disabled={!prefs.emailEnabled}
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            <p className="text-sm font-medium text-[#222222]">
              {t("notifications.email.frequency")}
            </p>
            <select
              value={prefs.emailFrequency || "immediate"}
              onChange={(e) =>
                updatePref(
                  "emailFrequency",
                  e.target.value as NotificationFrequency,
                )
              }
              disabled={!prefs.emailEnabled}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white disabled:opacity-50"
            >
              {FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Push Notifications */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#222222]">
            {t("notifications.push.title")}
          </h2>
          <Toggle
            enabled={prefs.pushEnabled ?? true}
            onChange={(v) => updatePref("pushEnabled", v)}
          />
        </div>
        <div className="space-y-4 pl-4 border-l-2 border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#222222]">
                {t("notifications.push.productUpdates")}
              </p>
              <p className="text-sm text-[#555555]">
                {t("notifications.push.productUpdatesDesc")}
              </p>
            </div>
            <Toggle
              enabled={prefs.pushProductUpdates ?? true}
              onChange={(v) => updatePref("pushProductUpdates", v)}
              disabled={!prefs.pushEnabled}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#222222]">
                {t("notifications.push.securityAlerts")}
              </p>
              <p className="text-sm text-[#555555]">
                {t("notifications.push.securityAlertsDesc")}
              </p>
            </div>
            <Toggle
              enabled={prefs.pushSecurityAlerts ?? true}
              onChange={(v) => updatePref("pushSecurityAlerts", v)}
              disabled={!prefs.pushEnabled}
            />
          </div>
        </div>
      </div>

      {/* Civic Notifications */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-[#222222] mb-4">
          {t("notifications.civic.title")}
        </h2>
        <div className="space-y-4 pl-4 border-l-2 border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#222222]">
                {t("notifications.civic.electionReminders")}
              </p>
              <p className="text-sm text-[#555555]">
                {t("notifications.civic.electionRemindersDesc")}
              </p>
            </div>
            <Toggle
              enabled={prefs.civicElectionReminders ?? true}
              onChange={(v) => updatePref("civicElectionReminders", v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#222222]">
                {t("notifications.civic.voterDeadlines")}
              </p>
              <p className="text-sm text-[#555555]">
                {t("notifications.civic.voterDeadlinesDesc")}
              </p>
            </div>
            <Toggle
              enabled={prefs.civicVoterDeadlines ?? true}
              onChange={(v) => updatePref("civicVoterDeadlines", v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#222222]">
                {t("notifications.civic.ballotUpdates")}
              </p>
              <p className="text-sm text-[#555555]">
                {t("notifications.civic.ballotUpdatesDesc")}
              </p>
            </div>
            <Toggle
              enabled={prefs.civicBallotUpdates ?? true}
              onChange={(v) => updatePref("civicBallotUpdates", v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#222222]">
                {t("notifications.civic.localNews")}
              </p>
              <p className="text-sm text-[#555555]">
                {t("notifications.civic.localNewsDesc")}
              </p>
            </div>
            <Toggle
              enabled={prefs.civicLocalNews ?? true}
              onChange={(v) => updatePref("civicLocalNews", v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#222222]">
                {t("notifications.civic.representativeUpdates")}
              </p>
              <p className="text-sm text-[#555555]">
                {t("notifications.civic.representativeUpdatesDesc")}
              </p>
            </div>
            <Toggle
              enabled={prefs.civicRepresentativeUpdates ?? true}
              onChange={(v) => updatePref("civicRepresentativeUpdates", v)}
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            <p className="text-sm font-medium text-[#222222]">
              {t("notifications.civic.frequency")}
            </p>
            <select
              value={prefs.civicFrequency || "daily_digest"}
              onChange={(e) =>
                updatePref(
                  "civicFrequency",
                  e.target.value as NotificationFrequency,
                )
              }
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
            >
              {FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Quiet Hours */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-[#222222]">
              {t("notifications.quietHours.title")}
            </h2>
            <p className="text-sm text-[#555555]">
              {t("notifications.quietHours.subtitle")}
            </p>
          </div>
          <Toggle
            enabled={prefs.quietHoursEnabled ?? false}
            onChange={(v) => updatePref("quietHoursEnabled", v)}
          />
        </div>
        {prefs.quietHoursEnabled && (
          <div className="flex items-center gap-4 pl-4">
            <div>
              <label className="block text-sm text-[#555555] mb-1">
                {t("notifications.quietHours.from")}
              </label>
              <input
                type="time"
                value={prefs.quietHoursStart || "22:00"}
                onChange={(e) => updatePref("quietHoursStart", e.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-[#555555] mb-1">
                {t("notifications.quietHours.to")}
              </label>
              <input
                type="time"
                value={prefs.quietHoursEnd || "08:00"}
                onChange={(e) => updatePref("quietHoursEnd", e.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="pt-4 border-t">
        <button
          onClick={handleSave}
          disabled={!hasChanges || updating}
          className="px-6 py-3 bg-[#222222] text-white rounded-lg font-medium hover:bg-[#333333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {updating ? t("common:buttons.saving") : t("common:buttons.save")}
        </button>
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  const { t } = useTranslation("settings");
  const { data, loading, error, refetch } =
    useQuery<MyNotificationPreferencesData>(GET_MY_NOTIFICATION_PREFERENCES);
  const [unsubscribeAll, { loading: unsubscribing }] =
    useMutation<UnsubscribeFromAllData>(UNSUBSCRIBE_FROM_ALL);

  const handleUnsubscribeAll = async () => {
    if (!confirm(t("notifications.unsubscribeConfirm"))) return;

    try {
      await unsubscribeAll();
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : t("common:errors.generic"));
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="space-y-3 mt-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
        <div className="text-center text-red-600">
          <p>{t("notifications.loadError")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data?.myNotificationPreferences && (
        <NotificationForm
          key={data.myNotificationPreferences.id}
          preferences={data.myNotificationPreferences}
          onSave={() => refetch()}
          onUnsubscribeAll={handleUnsubscribeAll}
          unsubscribing={unsubscribing}
        />
      )}
    </div>
  );
}
