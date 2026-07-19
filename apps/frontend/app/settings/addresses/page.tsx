"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_MY_ADDRESSES,
  CREATE_ADDRESS,
  UPDATE_ADDRESS,
  DELETE_ADDRESS,
  SET_PRIMARY_ADDRESS,
  MyAddressesData,
  CreateAddressData,
  UpdateAddressData,
  DeleteAddressData,
  SetPrimaryAddressData,
  UserAddress,
  CreateAddressInput,
  AddressType,
} from "@/lib/graphql/profile";
import { SettingsLoadingSkeleton } from "@/components/settings/SettingsLoadingSkeleton";
import { StatusPill } from "@/components/StatusPill";
import { US_STATES } from "@/lib/us-states";

// Values are uppercase to match the GraphQL `AddressType` enum's wire format.
// labelKeys stay lowercase since the i18n translation files key by the
// lowercase value (`addresses.types.residential` etc.) — no need to migrate
// every locale's translation key when only the wire format changed.
const ADDRESS_TYPES: { value: AddressType; labelKey: string }[] = [
  { value: "RESIDENTIAL", labelKey: "addresses.types.residential" },
  { value: "MAILING", labelKey: "addresses.types.mailing" },
  { value: "BUSINESS", labelKey: "addresses.types.business" },
  { value: "VOTING", labelKey: "addresses.types.voting" },
];

const emptyAddress: CreateAddressInput = {
  addressType: "RESIDENTIAL",
  isPrimary: false,
  label: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
};

export default function AddressesPage() {
  const { t } = useTranslation("settings");
  const { data, loading, error, refetch } =
    useQuery<MyAddressesData>(GET_MY_ADDRESSES);
  const [createAddress, { loading: creating }] =
    useMutation<CreateAddressData>(CREATE_ADDRESS);
  const [updateAddress, { loading: updating }] =
    useMutation<UpdateAddressData>(UPDATE_ADDRESS);
  const [deleteAddress, { loading: deleting }] =
    useMutation<DeleteAddressData>(DELETE_ADDRESS);
  const [setPrimaryAddress] =
    useMutation<SetPrimaryAddressData>(SET_PRIMARY_ADDRESS);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateAddressInput>(emptyAddress);
  const [formError, setFormError] = useState<string | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setFormError(null);
  };

  const handleEdit = (address: UserAddress) => {
    setEditingId(address.id);
    setFormData({
      addressType: address.addressType,
      isPrimary: address.isPrimary,
      label: address.label || "",
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 || "",
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
    });
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(emptyAddress);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (
      !formData.addressLine1 ||
      !formData.city ||
      !formData.state ||
      !formData.postalCode
    ) {
      setFormError(t("addresses.requiredFields"));
      return;
    }

    try {
      if (editingId) {
        await updateAddress({
          variables: { input: { id: editingId, ...formData } },
        });
      } else {
        await createAddress({
          variables: { input: formData },
        });
      }
      handleCancel();
      refetch();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : t("addresses.saveError"),
      );
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("addresses.deleteConfirm"))) return;

    try {
      await deleteAddress({ variables: { id } });
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : t("common:errors.generic"));
    }
  };

  const handleSetPrimary = async (id: string) => {
    try {
      await setPrimaryAddress({ variables: { id } });
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : t("common:errors.generic"));
    }
  };

  if (loading) {
    return <SettingsLoadingSkeleton rows={2} rowHeight="h-24" />;
  }

  if (error) {
    return (
      <div className="bg-surface rounded-lg dark:border p-8">
        <div className="text-center text-red-600 dark:text-red-300">
          <p>{t("common:errors.loadFailed")}</p>
        </div>
      </div>
    );
  }

  const addresses = data?.myAddresses || [];

  const getSubmitButtonText = () => {
    if (creating || updating) {
      return t("common:buttons.saving");
    }
    if (editingId) {
      return t("addresses.updateAddress");
    }
    return t("addresses.addAddress");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-surface rounded-lg dark:border p-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-content">
              {t("addresses.title")}
            </h1>
            <p className="text-content-dim mt-1">{t("addresses.subtitle")}</p>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-inverse-surface text-on-inverse rounded-lg font-medium hover:bg-inverse-surface transition-colors"
            >
              {t("addresses.addAddress")}
            </button>
          )}
        </div>

        {/* Add/Edit Form */}
        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="mt-8 border-t border-line pt-8"
          >
            <h2 className="text-lg font-semibold text-content mb-6">
              {editingId
                ? t("addresses.editAddress")
                : t("addresses.addNewAddress")}
            </h2>

            {formError && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-300">
                  {formError}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-content mb-2">
                  {t("addresses.addressType")}
                </label>
                <select
                  name="addressType"
                  value={formData.addressType}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-lg border border-line bg-surface text-content focus:border-line focus:ring-1 focus:ring-accent outline-none"
                >
                  {ADDRESS_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {t(type.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-content mb-2">
                  {t("addresses.label")}
                </label>
                <input
                  type="text"
                  name="label"
                  value={formData.label}
                  onChange={handleChange}
                  placeholder={t("addresses.labelPlaceholder")}
                  className="w-full px-4 py-3 rounded-lg border border-line bg-surface text-content placeholder-gray-500 focus:border-line focus:ring-1 focus:ring-accent outline-none"
                />
              </div>
            </div>

            <div className="mt-6">
              <label className="block text-sm font-medium text-content mb-2">
                {t("addresses.streetAddress")} *
              </label>
              <input
                type="text"
                name="addressLine1"
                value={formData.addressLine1}
                onChange={handleChange}
                placeholder={t("addresses.streetAddressPlaceholder")}
                className="w-full px-4 py-3 rounded-lg border border-line bg-surface text-content placeholder-gray-500 focus:border-line focus:ring-1 focus:ring-accent outline-none"
                required
              />
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-content mb-2">
                {t("addresses.aptSuite")}
              </label>
              <input
                type="text"
                name="addressLine2"
                value={formData.addressLine2}
                onChange={handleChange}
                placeholder={t("addresses.aptSuitePlaceholder")}
                className="w-full px-4 py-3 rounded-lg border border-line bg-surface text-content placeholder-gray-500 focus:border-line focus:ring-1 focus:ring-accent outline-none"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-content mb-2">
                  {t("addresses.city")} *
                </label>
                <input
                  type="text"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  placeholder={t("addresses.cityPlaceholder")}
                  className="w-full px-4 py-3 rounded-lg border border-line bg-surface text-content placeholder-gray-500 focus:border-line focus:ring-1 focus:ring-accent outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-content mb-2">
                  {t("addresses.state")} *
                </label>
                <select
                  name="state"
                  value={formData.state}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-lg border border-line bg-surface text-content focus:border-line focus:ring-1 focus:ring-accent outline-none"
                  required
                >
                  <option value="">{t("addresses.selectState")}</option>
                  {US_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-content mb-2">
                  {t("addresses.zipCode")} *
                </label>
                <input
                  type="text"
                  name="postalCode"
                  value={formData.postalCode}
                  onChange={handleChange}
                  placeholder={t("addresses.zipCodePlaceholder")}
                  className="w-full px-4 py-3 rounded-lg border border-line bg-surface text-content placeholder-gray-500 focus:border-line focus:ring-1 focus:ring-accent outline-none"
                  required
                />
              </div>
            </div>

            <div className="flex gap-4 mt-8">
              <button
                type="submit"
                disabled={creating || updating}
                className="px-6 py-3 bg-inverse-surface text-on-inverse rounded-lg font-medium hover:bg-inverse-surface transition-colors disabled:opacity-50"
              >
                {getSubmitButtonText()}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-6 py-3 border border-line text-content-dim rounded-lg font-medium hover:bg-surface-alt transition-colors"
              >
                {t("common:buttons.cancel")}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Address List */}
      {addresses.length > 0 ? (
        <div className="space-y-4">
          {addresses.map((address) => (
            <div
              key={address.id}
              className="bg-surface rounded-lg dark:border p-6"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-medium text-content capitalize">
                      {address.label ||
                        t(
                          `addresses.types.${address.addressType.toLowerCase()}`,
                        )}
                    </span>
                    {address.isPrimary && (
                      <StatusPill tone="sage-filled">
                        {t("common:status.primary")}
                      </StatusPill>
                    )}
                    {address.isVerified && (
                      <StatusPill tone="sage-outline">
                        {t("common:status.verified")}
                      </StatusPill>
                    )}
                    {/* Civic-data resolution surface (#802). Visible only
                        when status isn't 'resolved' — silent for the happy
                        path. Gives users a real signal when their
                        representatives list would otherwise be mysteriously
                        empty. Tooltips use sanitized i18n strings — the raw
                        civicResolutionError is logged server-side for ops,
                        never surfaced to end users. */}
                    {address.civicResolutionStatus === "pending" && (
                      <StatusPill tone="warning">
                        {t("addresses.civicResolution.pending")}
                      </StatusPill>
                    )}
                    {address.civicResolutionStatus === "no_match" && (
                      <span
                        title={t("addresses.civicResolution.noMatchTooltip")}
                        aria-label={t(
                          "addresses.civicResolution.noMatchTooltip",
                        )}
                      >
                        <StatusPill tone="warning">
                          {t("addresses.civicResolution.noMatch")}
                        </StatusPill>
                      </span>
                    )}
                    {address.civicResolutionStatus === "failed" && (
                      <span
                        title={t("addresses.civicResolution.failedTooltip")}
                        aria-label={t(
                          "addresses.civicResolution.failedTooltip",
                        )}
                      >
                        <StatusPill tone="danger">
                          {t("addresses.civicResolution.failed")}
                        </StatusPill>
                      </span>
                    )}
                  </div>
                  <p className="text-content">
                    {address.addressLine1}
                    {address.addressLine2 && `, ${address.addressLine2}`}
                  </p>
                  <p className="text-content-dim">
                    {address.city}, {address.state} {address.postalCode}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!address.isPrimary && (
                    <button
                      onClick={() => handleSetPrimary(address.id)}
                      className="text-sm text-content-dim hover:text-content transition-colors"
                    >
                      {t("addresses.setPrimary")}
                    </button>
                  )}
                  <button
                    onClick={() => handleEdit(address)}
                    className="p-2 text-content-dim hover:text-content transition-colors"
                    aria-label={t("common:buttons.edit")}
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(address.id)}
                    disabled={deleting}
                    className="p-2 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors disabled:opacity-50"
                    aria-label={t("common:buttons.delete")}
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        !showForm && (
          <div className="bg-surface rounded-lg dark:border p-8 text-center">
            <div className="text-content-dim">
              <svg
                className="w-12 h-12 mx-auto mb-4 opacity-50"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <p>{t("addresses.noAddresses")}</p>
              <p className="text-sm mt-1">{t("addresses.noAddressesHint")}</p>
            </div>
          </div>
        )
      )}
    </div>
  );
}
