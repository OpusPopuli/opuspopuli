"use client";

import { useMutation, useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_MY_CONSENTS,
  UPDATE_CONSENT,
  WITHDRAW_CONSENT,
  EXPORT_MY_DATA,
  MyConsentsData,
  UpdateConsentData,
  WithdrawConsentData,
  ExportMyDataData,
  UserConsent,
  ConsentType,
  ConsentStatus,
} from "@/lib/graphql/profile";

interface ConsentItemProps {
  readonly consent: UserConsent | undefined;
  readonly consentType: ConsentType;
  readonly required?: boolean;
  readonly onUpdate: (
    consentType: ConsentType,
    granted: boolean,
  ) => Promise<void>;
  readonly loading?: boolean;
}

function ConsentItem({
  consent,
  consentType,
  required,
  onUpdate,
  loading,
}: Readonly<ConsentItemProps>) {
  const { t } = useTranslation("settings");
  const isGranted = consent?.status === "granted";
  const statusDate =
    consent?.grantedAt || consent?.withdrawnAt || consent?.deniedAt;

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getStatusBadge = (status?: ConsentStatus) => {
    switch (status) {
      case "granted":
        return (
          <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
            {t("common:status.granted")}
          </span>
        );
      case "withdrawn":
        return (
          <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 rounded">
            {t("common:status.withdrawn")}
          </span>
        );
      case "denied":
        return (
          <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded">
            {t("common:status.denied")}
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded">
            {t("common:status.notSet")}
          </span>
        );
    }
  };

  return (
    <div className="flex items-start justify-between py-4 border-b border-gray-100 last:border-0">
      <div className="flex-1 pr-4">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-sm font-medium text-[#222222]">
            {t(`privacy.consents.${consentType}.title`)}
          </p>
          {required && (
            <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
              {t("common:status.required")}
            </span>
          )}
          {getStatusBadge(consent?.status)}
        </div>
        <p className="text-sm text-[#555555]">
          {t(`privacy.consents.${consentType}.description`)}
        </p>
        {statusDate && (
          <p className="text-xs text-[#888888] mt-1">
            {consent?.status === "granted"
              ? t("privacy.status.grantedOn")
              : t("privacy.status.updatedOn")}{" "}
            {formatDate(statusDate)}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {isGranted ? (
          <button
            onClick={() => onUpdate(consentType, false)}
            disabled={loading || required}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              required
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-red-50 text-red-600 hover:bg-red-100"
            }`}
          >
            {loading ? "..." : t("common:buttons.withdraw")}
          </button>
        ) : (
          <button
            onClick={() => onUpdate(consentType, true)}
            disabled={loading}
            className="px-3 py-1.5 text-sm font-medium bg-[#222222] text-white rounded-lg hover:bg-[#333333] transition-colors disabled:opacity-50"
          >
            {loading ? "..." : t("common:buttons.grant")}
          </button>
        )}
      </div>
    </div>
  );
}

const CONSENT_GROUPS: {
  groupKey: string;
  items: {
    consentType: ConsentType;
    required?: boolean;
  }[];
}[] = [
  {
    groupKey: "legal",
    items: [
      { consentType: "terms_of_service", required: true },
      { consentType: "privacy_policy", required: true },
    ],
  },
  {
    groupKey: "marketing",
    items: [
      { consentType: "marketing_email" },
      { consentType: "marketing_sms" },
      { consentType: "marketing_push" },
    ],
  },
  {
    groupKey: "data",
    items: [
      { consentType: "analytics" },
      { consentType: "personalization" },
      { consentType: "data_sharing" },
      { consentType: "location_tracking" },
    ],
  },
  {
    groupKey: "civic",
    items: [
      { consentType: "voter_data_collection" },
      { consentType: "civic_notifications" },
      { consentType: "representative_contact" },
    ],
  },
];

export default function PrivacyPage() {
  const { t } = useTranslation("settings");
  const { data, loading, error, refetch } =
    useQuery<MyConsentsData>(GET_MY_CONSENTS);
  const [updateConsent, { loading: updating }] =
    useMutation<UpdateConsentData>(UPDATE_CONSENT);
  const [withdrawConsent, { loading: withdrawing }] =
    useMutation<WithdrawConsentData>(WITHDRAW_CONSENT);
  const [exportMyData, { loading: exporting }] =
    useMutation<ExportMyDataData>(EXPORT_MY_DATA);

  const consents = data?.myConsents || [];
  const getConsent = (type: ConsentType) =>
    consents.find((c) => c.consentType === type);

  const handleConsentUpdate = async (
    consentType: ConsentType,
    granted: boolean,
  ) => {
    try {
      if (granted) {
        await updateConsent({
          variables: { input: { consentType, granted: true } },
        });
      } else {
        await withdrawConsent({
          variables: { input: { consentType } },
        });
      }
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : t("common:errors.generic"));
    }
  };

  const handleExportData = async () => {
    try {
      const { data: exportData } = await exportMyData();
      if (exportData?.exportMyData) {
        const json = JSON.stringify(exportData.exportMyData.data, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const date = new Date().toISOString().split("T")[0];
        a.href = url;
        a.download = `opuspopuli-data-export-${date}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
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
              <div key={i} className="h-20 bg-gray-200 rounded"></div>
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
          <p>{t("privacy.loadError")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#222222]">
            {t("privacy.title")}
          </h1>
          <p className="text-[#555555] mt-1">{t("privacy.subtitle")}</p>
        </div>

        {/* GDPR/CCPA Notice */}
        <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-blue-800">
                {t("privacy.rightsTitle")}
              </p>
              <p className="text-sm text-blue-700 mt-1">
                {t("privacy.rightsDescription")}
              </p>
            </div>
          </div>
        </div>

        {/* Consent Groups */}
        {CONSENT_GROUPS.map((group) => (
          <div key={group.groupKey} className="mb-8 last:mb-0">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-[#222222]">
                {t(`privacy.groups.${group.groupKey}.title`)}
              </h2>
              <p className="text-sm text-[#555555]">
                {t(`privacy.groups.${group.groupKey}.description`)}
              </p>
            </div>
            <div className="pl-4 border-l-2 border-gray-100">
              {group.items.map((item) => (
                <ConsentItem
                  key={item.consentType}
                  consent={getConsent(item.consentType)}
                  consentType={item.consentType}
                  required={item.required}
                  onUpdate={handleConsentUpdate}
                  loading={updating || withdrawing}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Data Export Section */}
      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
        <h2 className="text-lg font-semibold text-[#222222] mb-6">
          {t("privacy.dataManagement.title")}
        </h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between py-4 border-b border-gray-100">
            <div>
              <p className="text-sm font-medium text-[#222222]">
                {t("privacy.dataManagement.exportTitle")}
              </p>
              <p className="text-sm text-[#555555]">
                {t("privacy.dataManagement.exportDesc")}
              </p>
            </div>
            <button
              onClick={handleExportData}
              disabled={exporting}
              className="px-4 py-2 text-sm font-medium border border-gray-200 text-[#222222] rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {exporting ? "..." : t("privacy.dataManagement.exportButton")}
            </button>
          </div>

          <div className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm font-medium text-[#222222]">
                {t("privacy.dataManagement.deleteTitle")}
              </p>
              <p className="text-sm text-[#555555]">
                {t("privacy.dataManagement.deleteDesc")}
              </p>
            </div>
            <button className="px-4 py-2 text-sm font-medium bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors">
              {t("privacy.dataManagement.deleteButton")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
