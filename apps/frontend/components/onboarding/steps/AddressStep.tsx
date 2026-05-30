"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  CREATE_ADDRESS,
  GET_MY_ADDRESSES,
  UPDATE_ADDRESS,
  type CreateAddressData,
  type CreateAddressInput,
  type MyAddressesData,
  type UpdateAddressData,
  type UpdateAddressInput,
  type UserAddress,
} from "@/lib/graphql/profile";
import { StepFooter } from "../StepFooter";
import { US_STATES } from "@/lib/us-states";

interface AddressStepProps {
  readonly onComplete: () => void;
  readonly isLastStep: boolean;
}

interface AddressForm {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
}

const emptyForm: AddressForm = {
  addressLine1: "",
  city: "",
  state: "",
  postalCode: "",
};

const hasAnyContent = (f: AddressForm) =>
  Boolean(f.addressLine1 || f.city || f.state || f.postalCode);

// Pick the row to update on retry: a primary residential first, then
// any residential, then any address at all. Onboarding only collects
// the user's home address, so we prefer residential rows.
export function pickExistingAddress(
  addresses: readonly UserAddress[] | undefined,
): UserAddress | null {
  if (!addresses || addresses.length === 0) return null;
  return (
    addresses.find((a) => a.addressType === "RESIDENTIAL" && a.isPrimary) ??
    addresses.find((a) => a.addressType === "RESIDENTIAL") ??
    addresses[0]
  );
}

export function AddressStep({ onComplete, isLastStep }: AddressStepProps) {
  const { t } = useTranslation("onboarding");
  const [form, setForm] = useState<AddressForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  // Look up any address the user already has so onboarding retries
  // UPDATE the existing row instead of stacking duplicates. Bypass the
  // Apollo cache so a stale persisted empty result doesn't fool us
  // into the CREATE path; the submit handler also refetches before
  // deciding, so the decision can never race the network response.
  const { data: addressesData, refetch: refetchAddresses } =
    useQuery<MyAddressesData>(GET_MY_ADDRESSES, {
      fetchPolicy: "cache-and-network",
    });
  const existing = useMemo(
    () => pickExistingAddress(addressesData?.myAddresses),
    [addressesData?.myAddresses],
  );

  // Pre-fill the form with the existing address once data arrives.
  // Tracked by a ref so the eslint react-hooks rule about setState in
  // an effect doesn't trip — this is a legitimate one-shot
  // initialization from async query data, not a render loop. We can't
  // use useState's initial value because `existing` resolves after
  // mount.
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot
     initialization from async query data; ref guard prevents
     re-runs. Standard pattern for hydrating form state from a
     useQuery result that resolves after mount. */
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (!existing || prefilledRef.current) return;
    prefilledRef.current = true;
    setForm({
      addressLine1: existing.addressLine1 ?? "",
      city: existing.city ?? "",
      state: existing.state ?? "",
      postalCode: existing.postalCode ?? "",
    });
  }, [existing]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const [createAddress, { loading: creating }] = useMutation<
    CreateAddressData,
    { input: CreateAddressInput }
  >(CREATE_ADDRESS);
  const [updateAddress, { loading: updating }] = useMutation<
    UpdateAddressData,
    { input: UpdateAddressInput }
  >(UPDATE_ADDRESS);
  const loading = creating || updating;

  const update =
    (key: keyof AddressForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
      setError(null);
    };

  const submit = async () => {
    if (!hasAnyContent(form)) {
      onComplete();
      return;
    }
    if (!form.addressLine1 || !form.city || !form.state || !form.postalCode) {
      setError(t("address.errors.allRequired"));
      return;
    }
    try {
      // Refetch right before the decision so a slow/stale initial
      // query result can't push us into the CREATE path.
      const fresh = await refetchAddresses();
      const liveExisting =
        pickExistingAddress(fresh.data?.myAddresses) ?? existing;
      if (liveExisting) {
        await updateAddress({
          variables: {
            input: {
              id: liveExisting.id,
              addressType: "RESIDENTIAL",
              isPrimary: true,
              addressLine1: form.addressLine1,
              city: form.city,
              state: form.state,
              postalCode: form.postalCode,
              country: "US",
            },
          },
        });
      } else {
        await createAddress({
          variables: {
            input: {
              addressType: "RESIDENTIAL",
              isPrimary: true,
              addressLine1: form.addressLine1,
              city: form.city,
              state: form.state,
              postalCode: form.postalCode,
              country: "US",
            },
          },
        });
      }
      onComplete();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : t("address.errors.saveFailed");
      setError(message);
    }
  };

  const handleSkip = () => {
    setForm(emptyForm);
    setError(null);
    onComplete();
  };

  return (
    <div className="w-full max-w-md">
      <h2 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
        {t("address.title")}
      </h2>
      <p className="text-gray-600 dark:text-gray-300 text-sm mb-6">
        {t("address.subtitle")}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-3"
      >
        <div>
          <label htmlFor="address-line1" className="sr-only">
            {t("address.fields.line1")}
          </label>
          <input
            id="address-line1"
            type="text"
            autoComplete="street-address"
            placeholder={t("address.fields.line1")}
            value={form.addressLine1}
            onChange={update("addressLine1")}
            className="w-full px-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sage-dark"
          />
        </div>
        <div>
          <label htmlFor="address-city" className="sr-only">
            {t("address.fields.city")}
          </label>
          <input
            id="address-city"
            type="text"
            autoComplete="address-level2"
            placeholder={t("address.fields.city")}
            value={form.city}
            onChange={update("city")}
            className="w-full px-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sage-dark"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="address-state" className="sr-only">
              {t("address.fields.state")}
            </label>
            <select
              id="address-state"
              autoComplete="address-level1"
              value={form.state}
              onChange={update("state")}
              className="w-full px-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sage-dark"
            >
              <option value="">{t("address.fields.statePlaceholder")}</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="address-postal" className="sr-only">
              {t("address.fields.postalCode")}
            </label>
            <input
              id="address-postal"
              type="text"
              autoComplete="postal-code"
              inputMode="numeric"
              maxLength={10}
              placeholder={t("address.fields.postalCode")}
              value={form.postalCode}
              onChange={update("postalCode")}
              className="w-full px-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sage-dark"
            />
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="text-red-600 dark:text-red-400 text-sm pt-1"
          >
            {error}
          </p>
        )}

        {/* Hidden submit input keeps Enter-to-submit working — the
            visible primary action lives in StepFooter as type=button. */}
        <button
          type="submit"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        >
          {t("saveAndContinue")}
        </button>
        <StepFooter
          onSkip={handleSkip}
          onSubmit={submit}
          loading={loading}
          isLastStep={isLastStep}
        />
      </form>
    </div>
  );
}
